/**
 * Parser des pages « ville » de laforet.com.
 *
 * STRATÉGIE D'ANCRAGE — à lire avant toute modification.
 *
 * Le site est rendu côté serveur avec des classes Tailwind générées
 * (`text-tertiary font-bold ml-auto`). Ces classes changent au moindre
 * redéploiement : s'y accrocher garantirait un scraper cassé sous quinze jours.
 *
 * On s'ancre donc sur ce qui est stable parce que porteur de sens :
 *   1. la FORME DE L'URL des annonces, qui encode l'agence, la ville, le type
 *      et l'identifiant — c'est aussi la clé de déduplication ;
 *   2. le TEXTE de la carte, dont les unités (« €/mois », « m² », « pièces »)
 *      sont dictées par la langue, pas par le CSS.
 *
 * Le parser ne fait aucune conversion métier : il rend des chaînes brutes que
 * la normalisation typera (§12, §47).
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/**
 * Forme d'une URL d'annonce :
 * `/agence-immobiliere/{agence}/louer/{ville}/{type}-{n}-piece(s)-{id}`
 *
 * L'identifiant final est numérique et stable — c'est notre `sourceRef`.
 */
const LISTING_URL_PATTERN =
  /^https?:\/\/(?:www\.)?laforet\.com\/agence-immobiliere\/([^/]+)\/louer\/([^/]+)\/([^/?#]+?)-(\d{5,})(?:[?#].*)?$/;

export interface ParsedListingUrl {
  readonly agencySlug: string;
  readonly citySlug: string;
  readonly typeSlug: string;
  readonly reference: string;
  readonly canonicalUrl: string;
}

/**
 * Analyse une URL d'annonce.
 * @returns `null` si l'URL n'est pas une fiche d'annonce (lien d'agence,
 *          ancre `#section-video`, page de ville…).
 */
export function parseListingUrl(href: string): ParsedListingUrl | null {
  const match = LISTING_URL_PATTERN.exec(href.trim());
  if (match === null) return null;

  const [, agencySlug, citySlug, typeSlug, reference] = match;
  if (
    agencySlug === undefined ||
    citySlug === undefined ||
    typeSlug === undefined ||
    reference === undefined
  ) {
    return null;
  }

  return {
    agencySlug,
    citySlug,
    typeSlug,
    reference,
    // L'URL canonique exclut le fragment : `#section-video` désigne la même
    // annonce et ne doit pas produire un doublon.
    canonicalUrl: `https://www.laforet.com/agence-immobiliere/${agencySlug}/louer/${citySlug}/${typeSlug}-${reference}`,
  };
}

/** « Laforêt Nice Gambetta » à partir de `nice-gambetta`. */
export function agencyNameFromSlug(slug: string): string {
  const words = slug
    .split('-')
    .map((word) => (word.length === 0 ? word : word[0]?.toUpperCase() + word.slice(1)));
  return `Laforêt ${words.join(' ')}`;
}

/**
 * Extrait « NICE (06000) » → ville et code postal.
 *
 * La ville doit commencer par une majuscule : sans cette contrainte, le motif
 * capturerait le mot qui la précède dans le texte de la carte (« mois NICE »),
 * puisque l'espace fait partie des caractères acceptés dans un nom de commune
 * comme « Cagnes-sur-Mer ».
 */
const CITY_PATTERN = /([A-ZÀ-ÝŒ][A-Za-zÀ-ÿŒœ'’-]*(?:[ -][A-Za-zÀ-ÿŒœ'’-]+)*)\s*\((\d{5})\)/;

export function extractCity(text: string): { city: string | null; postalCode: string | null } {
  const match = CITY_PATTERN.exec(text);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return { city: cleanText(match[1]), postalCode: match[2] };
  }
  const postal = text.match(/\((\d{5})\)/);
  return { city: null, postalCode: postal?.[1] ?? null };
}

/** Isole le fragment « 1 890 €/mois » du texte d'une carte. */
export function extractPriceText(text: string): string | undefined {
  const match = text.match(/[\d][\d\s.,]*\s*€\s*\/\s*mois/);
  return match?.[0];
}

/** Isole le fragment « 67 m² ». */
export function extractAreaText(text: string): string | undefined {
  const match = text.match(/[\d][\d\s.,]*\s*m\s*²/);
  return match?.[0];
}

/** Isole « 3 pièces » et « 2 chambres ». */
export function extractRoomsText(text: string): string | undefined {
  const parts: string[] = [];
  const rooms = text.match(/\d+\s*pièces?/i);
  const bedrooms = text.match(/\d+\s*chambres?/i);
  if (rooms) parts.push(rooms[0]);
  if (bedrooms) parts.push(bedrooms[0]);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Isole le type de bien en tête de carte.
 * Le titre commence toujours par le type : « Appartement », « Maison »…
 */
export function extractPropertyTypeText(text: string): string | undefined {
  const match = text.match(/^\s*(Appartement|Maison|Studio|Villa|Loft|Duplex|Chambre)/i);
  return match?.[1];
}

/** Résultat du parsing d'une page de résultats. */
export interface ParsedPage {
  readonly listings: readonly RawListing[];
  /** `true` si une page suivante existe — pilote la pagination (§9). */
  readonly hasNextPage: boolean;
  /** Anomalies rencontrées, remontées pour la surveillance des sources (§61). */
  readonly warnings: readonly string[];
}

/**
 * Analyse une page de résultats et en extrait les annonces.
 *
 * @param html contenu HTML brut de la page
 * @param pageUrl URL de la page, pour résoudre les liens relatifs
 */
export function parseSearchPage(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const byReference = new Map<string, RawListing>();

  $('a[href*="/louer/"]').each((_index, element) => {
    const href = $(element).attr('href');
    if (href === undefined) return;

    // Résout les éventuels liens relatifs.
    const absolute = href.startsWith('http') ? href : new URL(href, pageUrl).toString();
    const parsed = parseListingUrl(absolute);
    if (parsed === null) return;

    // Extraction du texte via cheerio : `.text()` ne rend QUE les nœuds texte,
    // sans jamais laisser fuiter d'attribut (les cartes portent des attributs
    // de tracking `data-gtm-*`, et un « > » dans une URL cassait l'ancien
    // strip de balises par regex, polluant le titre). On remplace les <br> par
    // un espace pour ne pas coller deux fragments voisins (« …€/moisNICE »).
    const node = $(element).clone();
    node.find('br').replaceWith(' ');
    const text = cleanText(node.text().replace(/\s+/g, ' '));

    // Plusieurs liens pointent vers la même annonce (photo, titre, ancre vidéo).
    // Seul l'un d'eux porte le texte complet de la carte ; on garde le plus riche.
    const existing = byReference.get(parsed.reference);
    if (existing !== undefined && (existing.title?.length ?? 0) >= text.length) return;

    const { city, postalCode } = extractCity(text);

    const listing: RawListing = {
      sourceRef: parsed.reference,
      sourceUrl: parsed.canonicalUrl,
      title: text === '' ? undefined : text,
      ...(extractPriceText(text) !== undefined ? { priceText: extractPriceText(text) } : {}),
      ...(extractAreaText(text) !== undefined ? { areaText: extractAreaText(text) } : {}),
      ...(extractRoomsText(text) !== undefined ? { roomsText: extractRoomsText(text) } : {}),
      ...(extractPropertyTypeText(text) !== undefined
        ? { propertyTypeText: extractPropertyTypeText(text) }
        : {}),
      // Le meublé apparaît dans la ligne de caractéristiques de la carte.
      furnishedText: text,
      ...(city !== null ? { cityText: city } : {}),
      ...(postalCode !== null ? { postalCodeText: postalCode } : {}),
      agencyName: agencyNameFromSlug(parsed.agencySlug),
      // §21 : Laforêt ne publie pas les coordonnées directes sur la liste. On
      // n'invente rien et on ne force aucune page supplémentaire pour les
      // obtenir — le formulaire de l'annonce reste le canal prévu.
      contactFormUrl: parsed.canonicalUrl,
      extra: { reference: parsed.reference, agencySlug: parsed.agencySlug },
    };

    byReference.set(parsed.reference, listing);
  });

  const listings = [...byReference.values()];

  // §61 : détection d'anomalie. Une page qui rend des annonces sans aucun prix
  // signale presque toujours un changement de structure du site.
  if (listings.length > 0) {
    const withPrice = listings.filter((listing) => listing.priceText !== undefined).length;
    if (withPrice === 0) {
      warnings.push('Aucune annonce ne contient de prix — structure probablement modifiée');
    } else if (withPrice / listings.length < 0.5) {
      warnings.push(
        `Seules ${withPrice}/${listings.length} annonces contiennent un prix — parsing dégradé`,
      );
    }
  }

  // Pagination : présence d'un lien vers une page numérotée supérieure.
  const currentPage = Number.parseInt(new URL(pageUrl).searchParams.get('page') ?? '1', 10);
  const hasNextPage = $(`a[href*="page=${currentPage + 1}"]`).length > 0;

  return { listings, hasNextPage, warnings };
}
