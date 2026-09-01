/**
 * Parser des pages de location de fr.foncia.com (réseau d'agences).
 *
 * CONFORMITÉ (revérifiée le 2026-08-15) : le `robots.txt` interdit les URLs à
 * paramètres (`/*?`, sauf `?datemaj` explicitement autorisé) et des pages
 * avancées ; les pages `/location/{ville}/appartement` n'y figurent pas. La
 * pagination à paramètres n'est PAS utilisée : une seule page (~60 annonces)
 * couvre Nice — excellent rapport information/requête (§6).
 *
 * VALEUR PARTICULIÈRE : le titre des cartes contient l'ADRESSE COMPLÈTE du
 * bien (« … - 260 BOULEVARD X Nice 06200 ») — signal de dédoublonnage très
 * fort (§14), rare chez les autres sources.
 *
 * ANCRAGE : classes sémantiques du design system Foncia (`foncia-card-*`,
 * `dpe-class-*`), stables contrairement aux attributs générés `_ngcontent-*`
 * qui changent à chaque build Angular et ne sont JAMAIS utilisés ici.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/** Forme d'une URL de fiche : `/location/{ville}-{dept}/{type}/{réf}.htm`. */
const LISTING_URL_PATTERN =
  /^https?:\/\/(?:fr\.)?foncia\.com\/location\/([a-z0-9-]+)\/([a-z0-9-]+)\/(\d{6,})\.htm(?:[?#].*)?$/i;

export interface ParsedListingUrl {
  readonly citySlug: string;
  readonly typeSlug: string;
  readonly reference: string;
  readonly canonicalUrl: string;
}

/** Analyse une URL de fiche. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string): ParsedListingUrl | null {
  const match = LISTING_URL_PATTERN.exec(href.trim());
  if (match === null) return null;
  const [, citySlug, typeSlug, reference] = match;
  if (citySlug === undefined || typeSlug === undefined || reference === undefined) return null;
  return {
    citySlug,
    typeSlug,
    reference,
    canonicalUrl: `https://fr.foncia.com/location/${citySlug}/${typeSlug}/${reference}.htm`,
  };
}

/**
 * Extrait l'adresse du titre Foncia :
 * « Location Appartement 2 pièces 40.1 m² - 260 BOULEVARD X Nice 06200 »
 * → « 260 BOULEVARD X ».
 * La ville et le CP terminent toujours le titre ; le premier tiret sépare
 * l'adresse. On prend TOUT ce qui suit ce premier tiret, car l'adresse peut
 * elle-même contenir un tiret (« 37 - 39 RUE CLEMENT ROASSAL »).
 */
export function extractAddress(title: string): string | undefined {
  const parts = title.split(' - ');
  if (parts.length < 2) return undefined;
  const afterDash = parts.slice(1).join(' - ');

  // Retire « {Ville} {CP} » en fin de chaîne (`\s*` : marche aussi quand il ne
  // reste QUE la ville et le code postal, qu'on veut alors écarter).
  const address = cleanText(afterDash.replace(/\s*[A-ZÀ-Ý][\wà-ÿ'’-]*\s+\d{5}\s*$/u, ''));

  // Une vraie adresse contient un numéro ou un type de voie ; à défaut, ce
  // n'était que la ville (ex. « Nice 06300 ») — on ne garde rien (§17).
  const hasStreet =
    /\d|\b(rue|bd|boulevard|av|avenue|chemin|impasse|place|all[ée]e|corniche|quai|route|mont[ée]e|traverse|promenade|square|voie)\b/i;
  return address !== '' && hasStreet.test(address) ? address : undefined;
}

/** Résultat du parsing d'une page de résultats. */
export interface ParsedPage {
  readonly listings: readonly RawListing[];
  readonly hasNextPage: boolean;
  readonly warnings: readonly string[];
}

/**
 * Analyse une page `/location/{ville}/appartement` et en extrait les annonces.
 *
 * @param html contenu HTML brut de la page
 * @param pageUrl URL de la page, pour résoudre les liens relatifs
 */
export function parseSearchPage(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const byReference = new Map<string, RawListing>();

  $('.foncia-card').each((_index, element) => {
    const card = $(element);

    let parsedUrl: ParsedListingUrl | null = null;
    card.find('a[href*="/location/"]').each((_i, anchor) => {
      if (parsedUrl !== null) return;
      const href = $(anchor).attr('href');
      if (href === undefined) return;
      const absolute = href.startsWith('http') ? href : new URL(href, pageUrl).toString();
      parsedUrl = parseListingUrl(absolute);
    });
    if (parsedUrl === null) return;
    const url: ParsedListingUrl = parsedUrl;
    if (byReference.has(url.reference)) return;

    const priceBlock = cleanText(card.find('.foncia-card-price').first().text());
    const title = cleanText(card.find('.foncia-card-title-small-title').first().text());
    const surfaceText = cleanText(card.find('.foncia-card-surface').first().text());
    const place = cleanText(card.find('.foncia-card-place').first().text());
    const description = cleanText(card.find('.foncia-card-description').first().text());
    const dpe = cleanText(card.find('.dpe-class').first().text());

    // « 795 € / mois CC » — le suffixe CC (charges comprises) est significatif
    // et transmis tel quel : c'est la normalisation qui l'interprète.
    const priceText = /\d/.test(priceBlock) ? priceBlock : undefined;

    const placeMatch = place.match(/^(.+?)\s*\((\d{5})\)/);
    const city = placeMatch?.[1] !== undefined ? cleanText(placeMatch[1]) : undefined;
    const postalCode = placeMatch?.[2];

    const address = extractAddress(title);
    const areaText =
      surfaceText !== ''
        ? surfaceText
        : (title.match(/[\d][\d\s.,]*\s*m\s*(?:²|2)(?!\d)/i)?.[0] ?? undefined);
    const roomsText = title.match(/\d+\s*pièces?/i)?.[0];

    const imageUrls = card
      .find('img[src^="http"]')
      .map((_i, img) => $(img).attr('src'))
      .get()
      .filter((src): src is string => typeof src === 'string');

    const extra: Record<string, string> = { reference: url.reference };
    if (dpe !== '') extra['dpe'] = dpe;

    const listing: RawListing = {
      sourceRef: url.reference,
      sourceUrl: url.canonicalUrl,
      ...(title !== '' ? { title } : {}),
      ...(description !== '' ? { description } : {}),
      ...(priceText !== undefined ? { priceText } : {}),
      ...(areaText !== undefined ? { areaText } : {}),
      ...(roomsText !== undefined ? { roomsText } : {}),
      propertyTypeText: title !== '' ? title : url.typeSlug,
      furnishedText: cleanText(`${title} ${description}`),
      ...(address !== undefined ? { addressText: address } : {}),
      ...(city !== undefined ? { cityText: city } : {}),
      ...(postalCode !== undefined ? { postalCodeText: postalCode } : {}),
      agencyName: 'Foncia',
      // §21 : pas de coordonnées directes en liste ; la fiche est le canal.
      contactFormUrl: url.canonicalUrl,
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      extra,
    };

    byReference.set(url.reference, listing);
  });

  const listings = [...byReference.values()];

  // §61 : détection d'anomalie structurelle.
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

  // Pas de pagination : le robots.txt interdit les URLs à paramètres, et une
  // page couvre déjà tout Nice. `hasNextPage` est donc toujours faux.
  return { listings, hasNextPage: false, warnings };
}

/** Coordonnées d'une agence Foncia, lues sur la page des agences d'une ville. */
export interface FonciaAgency {
  readonly name: string;
  readonly phone: string | undefined;
  readonly email: string | undefined;
}

/**
 * Associe chaque numéro d'agence à ses coordonnées.
 *
 * Les fiches Foncia ne publient AUCUN contact : candidater passe par un
 * formulaire web. Elles portent en revanche un `numeroAgence`, et la page des
 * agences de la ville publie, elle, le téléphone et une adresse dédiée à la
 * location. Une requête suffit pour toute la ville.
 *
 * L'état Angular est sérialisé avec `&q;` en guise de guillemet.
 */
export function parseAgencies(html: string): Map<string, FonciaAgency> {
  const decoded = html.replace(/&q;/g, '"');
  const agencies = new Map<string, FonciaAgency>();

  // Chaque agence est un objet portant nom, numéro, téléphone et e-mail. On
  // découpe sur le numéro, seul champ garanti présent.
  for (const block of decoded.split('"numeroAgence"').slice(1)) {
    const number = /^\s*:\s*"(\d{3,6})"/.exec(block)?.[1];
    if (number === undefined || agencies.has(number)) continue;
    // La fenêtre suivant le numéro contient les champs de CETTE agence.
    const window = block.slice(0, 4000);
    const name = /"nom"\s*:\s*"([^"]{3,60})"/.exec(window)?.[1];
    if (name === undefined) continue;
    agencies.set(number, {
      name,
      phone: /"tel"\s*:\s*"(\+?\d{9,15})"/.exec(window)?.[1],
      email: /"mail"\s*:\s*"([\w.%+-]+@[\w.-]+\.\w{2,})"/.exec(window)?.[1],
    });
  }

  return agencies;
}

/** Numéro d'agence porté par chaque annonce de la page de liste. */
export function parseAgencyByReference(html: string): Map<string, string> {
  const decoded = html.replace(/&q;/g, '"');
  const byReference = new Map<string, string>();
  // « "reference":"331706221", … "numeroAgence":"3443" » — les deux champs
  // appartiennent au même objet, séparés par quelques centaines d'octets.
  for (const match of decoded.matchAll(
    /"reference"\s*:\s*"(\d{6,})"[\s\S]{0,400}?"numeroAgence"\s*:\s*"(\d{3,6})"/g,
  )) {
    const [, reference, agency] = match;
    if (reference !== undefined && agency !== undefined && !byReference.has(reference)) {
      byReference.set(reference, agency);
    }
  }
  return byReference;
}
