/**
 * Source : Mirabello Immobilier (mirabello-immobilier.com) — agence niçoise
 * (11 bis rue du Congrès, 06000 Nice), backend Apimo mais frontend Symfony
 * « maison » (mention « Design by Apimo » en pied de page) — la structure HTML
 * n'est donc PAS celle du template Cello géré par `makeApimoScraper`.
 *
 * Vérifié le 2026-08-21 : robots.txt permissif (n'interdit que `/app_dev.php`),
 * sitemap déclaré. Chaque fiche `/fr/propriété/{id}` porte un JSON-LD
 * schema.org très complet (nœud `Apartment`/`House` : réf, prix, surface,
 * pièces, adresse de rue, géo, photos, dates) — on parse ce bloc structuré
 * plutôt que la mise en page. Le prix affiché (span `.price`) est le loyer
 * CHARGES COMPRISES ; le JSON-LD `offers.price` est le loyer hors charges, la
 * différence étant la « Provision sur charges » listée dans la fiche. On retient
 * le CC (ce que voit et paie le locataire), cohérent avec les autres sources.
 *
 * Pas de détection « déjà loué » : le seul signal structuré (`offers.availability`
 * = OutOfStock) est ambigu — il couvre aussi les baux étudiants à disponibilité
 * FUTURE (ex. « disponible du 1er oct. au 30 juin »), qui sont de vraies
 * annonces actives. La disparition d'une fiche est gérée par le cycle de vie.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';
import {
  collectJsonLdNodes,
  findJsonLdNode,
  jsonLdString as asString,
  jsonLdType as nodeType,
  type JsonLdNode,
} from '../shared/json-ld.js';
import { compactListing, type RawDraft } from '../shared/raw-listing.js';

/** URL de fiche : `/fr/propriété/{id}` (l'accent est souvent percent-encodé). */
const FICHE_PATTERN = /^\/fr\/propriété\/(\d+)\/?$/i;

/** @type schema.org d'un logement → libellé de type de bien français. */
const RESIDENTIAL_TYPES: Record<string, string> = {
  apartment: 'appartement',
  residence: 'appartement',
  house: 'maison',
  singlefamilyresidence: 'maison',
};

export interface ParsedMirabelloUrl {
  readonly reference: string;
  /** URL telle qu'elle sera requêtée (accents percent-encodés conservés). */
  readonly canonicalUrl: string;
}

/** Analyse une URL de fiche. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string, baseUrl: string): ParsedMirabelloUrl | null {
  let resolved: URL;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return null;
  }
  if (new URL(baseUrl).hostname !== resolved.hostname) return null;

  const match = FICHE_PATTERN.exec(decodeURIComponent(resolved.pathname));
  if (match?.[1] === undefined) return null;
  return { reference: match[1], canonicalUrl: `${resolved.origin}${resolved.pathname}` };
}

export interface ParsedList {
  readonly urls: readonly ParsedMirabelloUrl[];
  readonly warnings: readonly string[];
}

/** Extrait et dédoublonne les liens de fiches d'une page de liste. */
export function parseListPage(html: string, pageUrl: string): ParsedList {
  const $ = cheerio.load(html);
  const seen = new Map<string, ParsedMirabelloUrl>();

  $('a[href]').each((_i, el) => {
    const parsed = parseListingUrl($(el).attr('href') ?? '', pageUrl);
    if (parsed !== null && !seen.has(parsed.reference)) seen.set(parsed.reference, parsed);
  });

  const urls = [...seen.values()];
  return {
    urls,
    warnings: urls.length === 0 ? [`Aucune fiche trouvée sur la liste : ${pageUrl}`] : [],
  };
}

export interface ParsedDetail {
  readonly listing: RawListing | null;
  readonly warnings: readonly string[];
}

/**
 * Prix : le locataire paie le loyer CHARGES COMPRISES. Le span `.price` porte ce
 * total (« 950 € / Mois (Charges comprises) »), à préférer au `offers.price` du
 * JSON-LD qui est le loyer hors charges — la différence étant la provision de
 * charges, exposée à part.
 */
function priceFields($: cheerio.CheerioAPI, html: string, offer: JsonLdNode | undefined): RawDraft {
  const priceSpan = cleanText($('.price').first().text().replace(/\s+/g, ' '));
  const offerPrice = asString(offer?.['price']);
  const provision = html.match(/Provision sur charges[^<]*<span>\s*([\d\s.,]+)\s*€/i)?.[1];
  let priceText: string | undefined;
  if (priceSpan !== '') priceText = priceSpan;
  else if (offerPrice !== undefined) priceText = `${offerPrice} € par mois`;
  return {
    priceText,
    chargesText: provision === undefined ? undefined : `${provision.trim()} € de charges`,
  };
}

/** Localisation, depuis les nœuds `address` et `geo` du JSON-LD. */
function locationFields(address: JsonLdNode | undefined, geo: JsonLdNode | undefined): RawDraft {
  return {
    addressText: asString(address?.['streetAddress']),
    cityText: asString(address?.['addressLocality']),
    postalCodeText: asString(address?.['postalCode']),
    latitude: typeof geo?.['latitude'] === 'number' ? geo['latitude'] : undefined,
    longitude: typeof geo?.['longitude'] === 'number' ? geo['longitude'] : undefined,
  };
}

/** Photos : liste `image` du JSON-LD, dédoublonnée. */
function imageUrls(property: JsonLdNode): readonly string[] {
  const images = property['image'];
  if (!Array.isArray(images)) return [];
  const urls: string[] = [];
  for (const src of images) {
    const url = asString(src);
    if (url !== undefined && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** Analyse une fiche bien via son JSON-LD schema.org. */
export function parseDetailPage(html: string, pageUrl: string, agencyName: string): ParsedDetail {
  const parsedUrl = parseListingUrl(pageUrl, pageUrl);
  if (parsedUrl === null) {
    return { listing: null, warnings: [`URL inattendue pour une fiche : ${pageUrl}`] };
  }

  const $ = cheerio.load(html);
  const nodes = collectJsonLdNodes($);
  const property = findJsonLdNode(nodes, Object.keys(RESIDENTIAL_TYPES));
  if (property === undefined) {
    return { listing: null, warnings: [`Fiche sans JSON-LD logement : ${pageUrl}`] };
  }
  const agency = findJsonLdNode(nodes, ['realestateagent']);
  const description = asString(property['description']);
  const photos = imageUrls(property);
  const price = priceFields($, html, property['offers'] as JsonLdNode | undefined);
  // DPE : lettre portée par la classe CSS du bloc bilan (`dpe dpe-C`).
  const dpe = /class="dpe dpe-([A-G])"/i.exec(html)?.[1];

  const listing = compactListing({
    sourceRef: asString(property['identifier']) ?? parsedUrl.reference,
    sourceUrl: parsedUrl.canonicalUrl,
    title: asString(property['name'])?.replace(/["«»]/g, '').trim() || undefined,
    description,
    ...price,
    areaText: asString((property['floorSize'] as JsonLdNode | undefined)?.['value'])
      ? `${asString((property['floorSize'] as JsonLdNode | undefined)?.['value']) as string} m²`
      : undefined,
    roomsText: asString(property['numberOfRooms'])
      ? `${asString(property['numberOfRooms']) as string} pièces`
      : undefined,
    propertyTypeText: RESIDENTIAL_TYPES[nodeType(property)] ?? 'appartement',
    furnishedText: description,
    ...locationFields(
      property['address'] as JsonLdNode | undefined,
      property['geo'] as JsonLdNode | undefined,
    ),
    agencyName,
    phoneText: asString(agency?.['telephone']),
    emailText: asString(agency?.['email']),
    publishedAtText: asString(property['datePosted']),
    contactFormUrl: parsedUrl.canonicalUrl,
    imageUrls: photos.length > 0 ? photos : undefined,
    extra: { reference: parsedUrl.reference, ...(dpe !== undefined ? { dpe: `DPE ${dpe}` } : {}) },
  });

  const warnings = price.priceText === undefined ? [`Fiche sans loyer lisible : ${pageUrl}`] : [];
  return { listing, warnings };
}
