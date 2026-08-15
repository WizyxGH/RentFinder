/**
 * Parser des pages « ville » de orpi.com (`/location-immobiliere-{ville}/`).
 *
 * STRATÉGIE D'ANCRAGE — à lire avant toute modification.
 *
 * Les cartes d'annonces sont des `<article data-test-estate
 * data-reference="…">` : on s'ancre sur ces attributs de données, posés pour
 * l'outillage du site lui-même, donc bien plus stables que les classes CSS.
 *
 * Chaque carte porte en plus, sur son bouton « favoris », un attribut
 * `data-eulerian-action` contenant un JSON riche (référence, prix, surface,
 * pièces, GPS, quartier, agence, date de création). C'est une AUBAINE pour le
 * dédoublonnage (§14 : les coordonnées GPS sont un signal très fort), mais
 * c'est un attribut de *tracking*, pas une API : il peut disparaître sans
 * préavis. Le parser le traite donc comme un ENRICHISSEMENT — le HTML visible
 * (prix en bannière, titre « N pièces X m² ») reste la source principale, et
 * chaque champ JSON n'est utilisé qu'en secours, champ par champ.
 *
 * EXCEPTION DOCUMENTÉE : le champ JSON `meuble` est ignoré. Observé le
 * 2026-08-15 : une annonce taguée « Meublé » à l'écran portait `"meuble":0`
 * dans son JSON. En cas de contradiction interne de la source, on se fie à ce
 * que le visiteur voit (les tags), pas au tracking (§17 : ne pas affirmer une
 * donnée douteuse).
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/**
 * Forme d'une URL d'annonce :
 * `/annonce-location-{type…}-{ville…}-{cp}-{référence}/`
 *
 * Le code postal est le PREMIER groupe de cinq chiffres délimité par des
 * tirets (quantificateur paresseux) : indispensable, car les références de
 * type UUID peuvent elles-mêmes contenir cinq chiffres consécutifs.
 */
const LISTING_URL_PATTERN =
  /^https?:\/\/(?:www\.)?orpi\.com\/annonce-location-(.+?)-(\d{5})-([a-z0-9-]+?)\/?(?:[?#].*)?$/i;

/**
 * Biens hors périmètre du projet (§1 : on cherche un logement, pas un garage).
 * Ce n'est pas un critère de recherche « artificiel » (§2) mais le périmètre
 * même du produit : un stationnement à 100 €/mois passerait tous les filtres
 * MVP (budget OK, surface inconnue donc non éliminatoire) et polluerait la
 * tête de liste.
 */
const NON_RESIDENTIAL_PREFIXES = [
  'stationnement',
  'parking',
  'garage',
  'box',
  'terrain',
  'local',
  'bureau',
  'commerce',
  'fonds',
  'immeuble',
  'cave',
] as const;

export interface ParsedListingUrl {
  /** Slug type + ville, ex. `appartement-t1-nice`. */
  readonly typeAndCitySlug: string;
  readonly postalCode: string;
  readonly reference: string;
  readonly canonicalUrl: string;
  /** `true` si le bien n'est pas un logement (stationnement, local…). */
  readonly nonResidential: boolean;
}

/**
 * Analyse une URL d'annonce.
 * @returns `null` si l'URL n'est pas une fiche d'annonce (lien de quartier,
 *          pagination, lien `?contact=true` inclus — il est canonisé).
 */
export function parseListingUrl(href: string): ParsedListingUrl | null {
  const match = LISTING_URL_PATTERN.exec(href.trim());
  if (match === null) return null;

  const [, typeAndCitySlug, postalCode, reference] = match;
  if (typeAndCitySlug === undefined || postalCode === undefined || reference === undefined) {
    return null;
  }

  const firstToken = typeAndCitySlug.split('-')[0] ?? '';
  const nonResidential = NON_RESIDENTIAL_PREFIXES.some((prefix) => firstToken === prefix);

  return {
    typeAndCitySlug,
    postalCode,
    reference,
    // Canonique sans query ni fragment : `?contact=true` désigne la même
    // annonce et ne doit pas produire un doublon.
    canonicalUrl: `https://www.orpi.com/annonce-location-${typeAndCitySlug}-${postalCode}-${reference}/`,
    nonResidential,
  };
}

/**
 * Sous-ensemble utile du JSON `data-eulerian-action`. Tous les champs sont
 * optionnels : le tracking peut changer de forme à tout moment.
 */
interface EulerianData {
  readonly prdref?: string;
  readonly prdamount?: number;
  readonly surfaceBien?: number;
  readonly nbPieces?: number;
  readonly nbChambres?: number;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly agenceNom?: string;
  readonly nomVille?: string;
  readonly codePostal?: string | null;
  readonly quartier?: string;
  readonly dateCreation?: string;
  readonly dpe?: string | null;
  readonly etage?: number | null;
  readonly ascenseur?: number;
  readonly nbBalcons?: number | string;
  readonly nbTerrasses?: number;
  readonly nbParking?: number | null;
  readonly meuble?: number;
}

/**
 * Décode le JSON de tracking d'une carte.
 * @returns `null` si l'attribut est absent, corrompu, ou ne concerne pas la
 *          référence attendue (garde contre un attribut déplacé dans le DOM).
 */
export function parseEulerianData(
  raw: string | undefined,
  expectedRef: string,
): EulerianData | null {
  if (raw === undefined || raw === '') return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const candidate = data as EulerianData;
    if (candidate.prdref !== expectedRef) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** Isole le fragment prix de la bannière, ex. « 1 280 € par mois ». */
export function extractPriceText(text: string): string | undefined {
  const match = text.match(/[\d][\d\s.,]*\s*€\s*par\s*mois/i);
  return match?.[0];
}

/** Isole la surface du titre, ex. « 13,50 m 2 » (le HTML écrit `m<sup>2</sup>`). */
export function extractAreaText(text: string): string | undefined {
  const match = text.match(/[\d][\d\s.,]*\s*m\s*(?:²|2)(?!\d)/i);
  return match?.[0];
}

/** Isole « 2 pièces » du titre. */
export function extractRoomsText(text: string): string | undefined {
  const match = text.match(/\d+\s*pièces?/i);
  return match?.[0];
}

/** Résultat du parsing d'une page de résultats. */
export interface ParsedPage {
  readonly listings: readonly RawListing[];
  readonly hasNextPage: boolean;
  readonly warnings: readonly string[];
}

/**
 * Analyse une page `/location-immobiliere-{ville}/` et en extrait les annonces.
 *
 * @param html contenu HTML brut de la page
 * @param pageUrl URL de la page, pour résoudre les liens relatifs
 */
export function parseSearchPage(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const byReference = new Map<string, RawListing>();

  $('article[data-reference]').each((_index, element) => {
    const card = $(element);

    // URL de la fiche : premier lien d'annonce de la carte, canonisé.
    let parsedUrl: ParsedListingUrl | null = null;
    card.find('a[href*="/annonce-location-"]').each((_i, anchor) => {
      if (parsedUrl !== null) return;
      const href = $(anchor).attr('href');
      if (href === undefined) return;
      const absolute = href.startsWith('http') ? href : new URL(href, pageUrl).toString();
      parsedUrl = parseListingUrl(absolute);
    });
    if (parsedUrl === null) return;
    const url: ParsedListingUrl = parsedUrl;

    if (url.nonResidential) return;

    // La référence de l'attribut fait foi ; l'URL sert de secours.
    const reference = card.attr('data-reference') ?? url.reference;
    if (byReference.has(reference)) return;

    // Texte aplati de la carte : les balises deviennent des espaces pour que
    // deux fragments voisins restent des mots distincts.
    const cardText = cleanText($.html(card).replace(/<[^>]*>/g, ' '));
    const titleText = cleanText(card.find('a.c-overlay__link').first().text());
    const tagsText = cleanText(
      card
        .find('.c-tag')
        .map((_i, tag) => $(tag).text())
        .get()
        .join(' '),
    );
    const description = cleanText(card.find('.text-sm').first().text());

    // Enrichissement optionnel par le JSON de tracking (voir en-tête).
    const eulerian = parseEulerianData(
      card.find('[data-eulerian-action*="prdref"]').first().attr('data-eulerian-action'),
      reference,
    );

    const priceText =
      extractPriceText(cardText) ??
      (eulerian?.prdamount !== undefined ? `${eulerian.prdamount} €` : undefined);
    const areaText =
      extractAreaText(titleText) ??
      // `surfaceBien` est documentée en m² par la structure même de la carte.
      (eulerian?.surfaceBien !== undefined ? `${eulerian.surfaceBien} m²` : undefined);
    // Pièces du titre (ou du JSON), chambres du JSON seul : la carte ne les
    // affiche pas. La convention « N pièces M chambres » est celle que la
    // normalisation sait lire.
    const roomsParts: string[] = [];
    const roomsFromTitle =
      extractRoomsText(titleText) ??
      (eulerian?.nbPieces !== undefined ? `${eulerian.nbPieces} pièces` : undefined);
    if (roomsFromTitle !== undefined) roomsParts.push(roomsFromTitle);
    if (eulerian?.nbChambres != null) roomsParts.push(`${eulerian.nbChambres} chambres`);
    const roomsText = roomsParts.length > 0 ? roomsParts.join(' ') : undefined;

    const imageUrls = card
      .find('img[data-src]')
      .map((_i, img) => $(img).attr('data-src'))
      .get()
      .filter((src): src is string => typeof src === 'string' && src.startsWith('http'));

    const extra: Record<string, string> = { reference };
    if (eulerian?.quartier !== undefined && eulerian.quartier !== '') {
      // Le quartier n'est PAS une adresse : le mettre dans `addressText`
      // ferait gagner à tort le signal « même adresse » (+30) à deux biens
      // distincts du même quartier lors du dédoublonnage (§14).
      extra['quartier'] = eulerian.quartier;
    }
    if (eulerian?.dpe != null && eulerian.dpe !== '') extra['dpe'] = eulerian.dpe;
    // Attributs structurés → alimentent la liste d'atouts en normalisation.
    if (eulerian?.etage != null) extra['etage'] = String(eulerian.etage);
    if (eulerian?.ascenseur != null) extra['ascenseur'] = String(eulerian.ascenseur);
    if (eulerian?.nbBalcons != null && eulerian.nbBalcons !== '') {
      extra['nbBalcons'] = String(eulerian.nbBalcons);
    }
    if (eulerian?.nbTerrasses != null) extra['nbTerrasses'] = String(eulerian.nbTerrasses);
    if (eulerian?.nbParking != null) extra['nbParking'] = String(eulerian.nbParking);

    const listing: RawListing = {
      sourceRef: reference,
      sourceUrl: url.canonicalUrl,
      ...(titleText !== '' ? { title: titleText } : {}),
      ...(description !== '' ? { description } : {}),
      ...(priceText !== undefined ? { priceText } : {}),
      ...(areaText !== undefined ? { areaText } : {}),
      ...(roomsText !== undefined ? { roomsText } : {}),
      // Le premier token du slug (« appartement », « maison », « studio »).
      propertyTypeText: url.typeAndCitySlug.split('-')[0] ?? '',
      // Meublé : tags + titre + description — jamais le champ JSON `meuble`.
      furnishedText: cleanText(`${tagsText} ${titleText} ${description}`),
      ...(eulerian?.nomVille !== undefined && eulerian.nomVille !== ''
        ? { cityText: eulerian.nomVille }
        : {}),
      postalCodeText:
        eulerian?.codePostal != null && eulerian.codePostal !== ''
          ? eulerian.codePostal
          : url.postalCode,
      ...(eulerian?.latitude !== undefined ? { latitude: eulerian.latitude } : {}),
      ...(eulerian?.longitude !== undefined ? { longitude: eulerian.longitude } : {}),
      agencyName:
        eulerian?.agenceNom !== undefined && eulerian.agenceNom !== ''
          ? `Orpi — ${eulerian.agenceNom}`
          : 'Orpi',
      // §21 : la liste ne publie pas de coordonnées directes. Le formulaire de
      // la fiche est le canal prévu ; on ne force aucune requête pour plus.
      contactFormUrl: url.canonicalUrl,
      ...(eulerian?.dateCreation !== undefined && eulerian.dateCreation !== ''
        ? { publishedAtText: eulerian.dateCreation }
        : {}),
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      extra,
    };

    byReference.set(reference, listing);
  });

  const listings = [...byReference.values()];

  // §61 : détection d'anomalie structurelle, sans requête supplémentaire.
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

  // Pagination : le lien `rel="next"` est la marque la plus fiable ; à défaut,
  // un lien vers la page numérotée suivante.
  const currentPage = Number.parseInt(new URL(pageUrl).searchParams.get('page') ?? '1', 10);
  const hasNextPage =
    $('a[rel="next"]').length > 0 || $(`a[href*="page=${currentPage + 1}"]`).length > 0;

  return { listings, hasNextPage, warnings };
}
