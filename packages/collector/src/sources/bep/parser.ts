/**
 * Parsers de bep-logement.com — première AGENCE LOCALE du projet (§3).
 *
 * MÉTHODE : SITEMAP, pas de pagination HTML.
 *
 * La page `/fr/locations` charge ses cartes en JavaScript (lazy-load) : la
 * parser exigerait un navigateur headless, coûteux et fragile. Mais le site
 * déclare un sitemap dans son robots.txt — une méthode d'accès PRÉVUE pour
 * l'automatisation, donc préférée d'office (§6) :
 *
 *   sitemap.xml (index) → sitemap-N.xml → URLs de fiches + <lastmod>
 *
 * Le `lastmod` permet de ne visiter QUE les fiches nouvelles ou récentes :
 * quelques requêtes par run suffisent (§30).
 *
 * FICHE : le HTML embarque un JSON-LD schema.org complet (plateforme
 * Cello/Apimo) : Apartment (pièces, surface, adresse, date de publication) et
 * RealEstateAgent (téléphone, e-mail — publiés volontairement, §21). C'est un
 * balisage SEO, donc STABLE par intérêt du site lui-même : ancrage principal.
 * Le bloc HTML `module-property-info` sert de secours.
 *
 * DIVERGENCE CONNUE : le prix affiché (« 690 € / Mois (Charges comprises) »)
 * peut différer du `offers.price` JSON (hors charges). On préfère le prix
 * AFFICHÉ : il porte la mention des charges, que la normalisation sait lire,
 * et c'est ce que verra l'utilisateur en ouvrant la fiche.
 *
 * NOTE ADAPTATEUR (§5, §47) : Cello/Apimo équipe de nombreuses agences. Si une
 * deuxième agence sur cette plateforme est ajoutée un jour, extraire ce parser
 * en adaptateur générique `sources/agencies/apimo.ts`.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/**
 * Forme d'une URL de fiche :
 * `/fr/propriete/{transaction}+{type}+{ville}+{slug…}+{référence}`
 * La référence finale est numérique ; les segments sont séparés par `+`.
 */
const LISTING_URL_PATTERN =
  /^https?:\/\/(?:www\.)?bep-logement\.com\/fr\/propriete\/(location|vente)\+([^+]+)\+([^+]+)\+(?:.*\+)?(\d{6,})\/?$/i;

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
  readonly datePosted?: string;
  readonly offerPrice?: string;
  readonly imageUrls?: readonly string[];
  readonly agencyName?: string;
  readonly agencyPhone?: string;
  readonly agencyEmail?: string;
}

/** Décode le graphe JSON-LD d'une fiche. `null` si absent ou corrompu. */
function parseJsonLd($: cheerio.CheerioAPI): JsonLdData | null {
  const raw = $('script[type="application/ld+json"]').first().text();
  if (raw.trim() === '') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    const graph = (parsed as { '@graph'?: unknown[] })['@graph'];
    if (!Array.isArray(graph)) return null;

    const agent = graph.find(
      (node) => (node as { '@type'?: string })['@type'] === 'RealEstateAgent',
    ) as Record<string, unknown> | undefined;
    const property = graph.find((node) => {
      const type = (node as { '@type'?: string })['@type'];
      return type === 'Apartment' || type === 'House' || type === 'Residence';
    }) as Record<string, unknown> | undefined;
    if (property === undefined) return null;

    const address = property['address'] as Record<string, unknown> | undefined;
    const floorSize = property['floorSize'] as Record<string, unknown> | undefined;
    const offers = property['offers'] as Record<string, unknown> | undefined;

    return {
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
      ...(typeof address?.['postalCode'] === 'string' ? { postalCode: address['postalCode'] } : {}),
      ...(typeof property['datePosted'] === 'string' ? { datePosted: property['datePosted'] } : {}),
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
    return null;
  }
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
 */
export function parseDetailPage(html: string, pageUrl: string): ParsedDetail {
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
    cityText: jsonLd?.city ?? parsedUrl.citySlug.replace(/-/g, ' '),
    ...(jsonLd?.postalCode !== undefined ? { postalCodeText: jsonLd.postalCode } : {}),
    // §21 : coordonnées d'agence publiées volontairement dans le JSON-LD.
    agencyName: jsonLd?.agencyName ?? 'BEP Logement',
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
