/**
 * Adaptateur générique des sites d'agences sur la plateforme Apimo/Cello
 * (§5, §47 : un seul parser pour de nombreuses agences).
 *
 * Ces sites partagent la même structure :
 *   - `robots.txt` permissif (seul `/app_dev.php` interdit) + sitemap déclaré ;
 *   - URLs de fiches `/fr/propriete/{transaction}+{type}+{ville}+…+{réf}` ;
 *   - fiche avec JSON-LD schema.org `@graph` (RealEstateAgent + bien).
 *
 * Le domaine n'est PAS ancré dans le motif d'URL : `parseListingUrl` ne reçoit
 * que des URLs issues du sitemap du site lui-même. Chaque agence est déclarée
 * comme une instance via `makeApimoScraper` (voir `scraper.ts`).
 *
 * Instances connues : BEP Logement, D'Azur Immobilier.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/**
 * Forme d'une URL de fiche, tout domaine Apimo confondu :
 * `/fr/propriete/{transaction}+{type}+{ville}+{slug…}+{référence}`.
 */
const LISTING_URL_PATTERN =
  /^https?:\/\/(?:www\.)?[a-z0-9.-]+\/fr\/propriete\/(location|vente)\+([^+]+)\+([^+]+)\+(?:.*\+)?(\d{6,})\/?$/i;

export interface ParsedListingUrl {
  readonly transaction: 'location' | 'vente';
  readonly typeSlug: string;
  readonly citySlug: string;
  readonly reference: string;
  readonly canonicalUrl: string;
}

/** Analyse une URL de fiche. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string): ParsedListingUrl | null {
  const match = LISTING_URL_PATTERN.exec(href.trim());
  if (match === null) return null;
  const [, transaction, typeSlug, citySlug, reference] = match;
  if (
    transaction === undefined ||
    typeSlug === undefined ||
    citySlug === undefined ||
    reference === undefined
  ) {
    return null;
  }
  return {
    transaction: transaction.toLowerCase() as 'location' | 'vente',
    typeSlug: typeSlug.toLowerCase(),
    citySlug: citySlug.toLowerCase(),
    reference,
    canonicalUrl: href.trim().replace(/[?#].*$/, ''),
  };
}

export interface SitemapEntry {
  readonly url: ParsedListingUrl;
  /** Date `lastmod` du sitemap (ISO simple `AAAA-MM-JJ`), sinon `null`. */
  readonly lastmod: string | null;
}

/**
 * Extrait les fiches de LOCATION d'un sitemap (les `<loc>` sont en CDATA).
 * Les fiches de vente et les pages éditoriales sont ignorées.
 */
export function parseSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];

  for (const block of urlBlocks) {
    const loc = /<loc>(?:<!\[CDATA\[)?([^\]<]+?)(?:\]\]>)?<\/loc>/.exec(block)?.[1];
    if (loc === undefined) continue;
    const url = parseListingUrl(loc.trim());
    if (url === null || url.transaction !== 'location') continue;

    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(block)?.[1]?.trim() ?? null;
    entries.push({ url, lastmod });
  }
  return entries;
}

/** Liste les sous-sitemaps d'un index (`<sitemapindex>`). */
export function parseSitemapIndex(xml: string): string[] {
  const blocks = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/g) ?? [];
  const urls: string[] = [];
  for (const block of blocks) {
    const loc = /<loc>(?:<!\[CDATA\[)?([^\]<]+?)(?:\]\]>)?<\/loc>/.exec(block)?.[1];
    if (loc !== undefined) urls.push(loc.trim());
  }
  return urls;
}

/** Sous-ensemble utile du JSON-LD d'une fiche. */
interface JsonLdData {
  readonly name?: string;
  readonly description?: string;
  readonly rooms?: number;
  readonly area?: number;
  readonly city?: string;
  readonly postalCode?: string;
  readonly streetAddress?: string;
  readonly datePosted?: string;
  readonly offerPrice?: string;
  readonly imageUrls?: readonly string[];
  readonly agencyName?: string;
  readonly agencyPhone?: string;
  readonly agencyEmail?: string;
}

/** Décode le graphe JSON-LD d'une fiche. `null` si absent ou corrompu. */
function parseJsonLd($: cheerio.CheerioAPI): JsonLdData | null {
  // Certaines fiches ont plusieurs blocs ld+json : on cherche celui qui porte
  // le bien, pas l'Organization ou le Product SEO générique.
  let result: JsonLdData | null = null;
  $('script[type="application/ld+json"]').each((_index, element) => {
    if (result !== null) return;
    const raw = $(element).text();
    if (raw.trim() === '') return;

    try {
      const parsed: unknown = JSON.parse(raw);
      const graph = (parsed as { '@graph'?: unknown[] })['@graph'];
      if (!Array.isArray(graph)) return;

      const agent = graph.find(
        (node) => (node as { '@type'?: string })['@type'] === 'RealEstateAgent',
      ) as Record<string, unknown> | undefined;
      const property = graph.find((node) => {
        const type = (node as { '@type'?: string })['@type'];
        return type === 'Apartment' || type === 'House' || type === 'Residence';
      }) as Record<string, unknown> | undefined;
      if (property === undefined) return;

      const address = property['address'] as Record<string, unknown> | undefined;
      const floorSize = property['floorSize'] as Record<string, unknown> | undefined;
      const offers = property['offers'] as Record<string, unknown> | undefined;

      result = {
        ...(typeof property['name'] === 'string' ? { name: property['name'].trim() } : {}),
        ...(typeof property['description'] === 'string'
          ? { description: property['description'] }
          : {}),
        ...(typeof property['numberOfRooms'] === 'number'
          ? { rooms: property['numberOfRooms'] }
          : {}),
        ...(typeof floorSize?.['value'] === 'number' ? { area: floorSize['value'] } : {}),
        ...(typeof address?.['addressLocality'] === 'string'
          ? { city: address['addressLocality'] }
          : {}),
        ...(typeof address?.['postalCode'] === 'string'
          ? { postalCode: address['postalCode'] }
          : {}),
        ...(typeof address?.['streetAddress'] === 'string'
          ? { streetAddress: address['streetAddress'] }
          : {}),
        ...(typeof property['datePosted'] === 'string'
          ? { datePosted: property['datePosted'] }
          : {}),
        ...(typeof offers?.['price'] === 'string' || typeof offers?.['price'] === 'number'
          ? { offerPrice: String(offers['price']) }
          : {}),
        ...(Array.isArray(property['image'])
          ? { imageUrls: property['image'].filter((u): u is string => typeof u === 'string') }
          : {}),
        ...(typeof agent?.['name'] === 'string' ? { agencyName: agent['name'] } : {}),
        ...(typeof agent?.['telephone'] === 'string' ? { agencyPhone: agent['telephone'] } : {}),
        ...(typeof agent?.['email'] === 'string' ? { agencyEmail: agent['email'] } : {}),
      };
    } catch {
      /* bloc illisible : on tente le suivant */
    }
  });
  return result;
}

export interface ParsedDetail {
  readonly listing: RawListing | null;
  readonly warnings: readonly string[];
}

/**
 * Analyse une fiche bien et en extrait l'annonce.
 *
 * @param html contenu HTML brut de la fiche
 * @param pageUrl URL de la fiche (déjà validée par `parseListingUrl`)
 * @param defaultAgencyName agence à afficher si le JSON-LD ne la nomme pas
 */
export function parseDetailPage(
  html: string,
  pageUrl: string,
  defaultAgencyName: string,
): ParsedDetail {
  const parsedUrl = parseListingUrl(pageUrl);
  if (parsedUrl === null) {
    return { listing: null, warnings: [`URL inattendue pour une fiche : ${pageUrl}`] };
  }

  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const jsonLd = parseJsonLd($);
  if (jsonLd === null) {
    warnings.push('JSON-LD absent ou illisible — repli sur le HTML seul');
  }

  // Prix : le bloc affiché d'abord (mention des charges), le JSON en secours.
  const htmlPrice = cleanText($('.module-property-info .price').first().text());
  const priceText =
    htmlPrice !== ''
      ? htmlPrice
      : jsonLd?.offerPrice !== undefined
        ? `${jsonLd.offerPrice} €`
        : undefined;

  const infoText = cleanText($('.module-property-info').first().text().replace(/\s+/g, ' '));
  const title =
    jsonLd?.name ?? cleanText($('.module-property-info .title').first().text()) ?? undefined;
  const description =
    jsonLd?.description ?? cleanText($('#description').first().text()) ?? undefined;

  const areaText =
    jsonLd?.area !== undefined
      ? `${jsonLd.area} m²`
      : (infoText.match(/[\d][\d\s.,]*\s*m\s*(?:²|2)(?!\d)/i)?.[0] ?? undefined);
  const roomsText =
    jsonLd?.rooms !== undefined
      ? `${jsonLd.rooms} pièces`
      : (infoText.match(/\d+\s*pièces?/i)?.[0] ?? undefined);

  if (priceText === undefined) {
    warnings.push(`Fiche sans prix : ${pageUrl}`);
  }

  const listing: RawListing = {
    sourceRef: parsedUrl.reference,
    sourceUrl: parsedUrl.canonicalUrl,
    ...(title !== undefined && title !== '' ? { title } : {}),
    ...(description !== undefined && description !== '' ? { description } : {}),
    ...(priceText !== undefined ? { priceText } : {}),
    ...(areaText !== undefined ? { areaText } : {}),
    ...(roomsText !== undefined ? { roomsText } : {}),
    propertyTypeText: parsedUrl.typeSlug,
    // Meublé : le titre et la description le disent quand c'est le cas.
    furnishedText: cleanText(`${title ?? ''} ${description ?? ''}`),
    // §21 : adresse exacte publiée dans le JSON-LD quand elle existe.
    ...(jsonLd?.streetAddress !== undefined ? { addressText: jsonLd.streetAddress } : {}),
    cityText: jsonLd?.city ?? parsedUrl.citySlug.replace(/-/g, ' '),
    ...(jsonLd?.postalCode !== undefined ? { postalCodeText: jsonLd.postalCode } : {}),
    // §21 : coordonnées d'agence publiées volontairement dans le JSON-LD.
    agencyName: jsonLd?.agencyName ?? defaultAgencyName,
    ...(jsonLd?.agencyPhone !== undefined ? { phoneText: jsonLd.agencyPhone } : {}),
    ...(jsonLd?.agencyEmail !== undefined ? { emailText: jsonLd.agencyEmail } : {}),
    contactFormUrl: parsedUrl.canonicalUrl,
    ...(jsonLd?.datePosted !== undefined ? { publishedAtText: jsonLd.datePosted } : {}),
    ...(jsonLd?.imageUrls !== undefined && jsonLd.imageUrls.length > 0
      ? { imageUrls: jsonLd.imageUrls }
      : {}),
    extra: { reference: parsedUrl.reference, citySlug: parsedUrl.citySlug },
  };

  return { listing, warnings };
}
