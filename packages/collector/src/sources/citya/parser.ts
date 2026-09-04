/**
 * Source : Citya Immobilier (citya.com) — grand réseau d'administration de
 * biens, demandé explicitement. Vérifié le 2026-08-19.
 *
 * robots.txt : `/annonces/*` est autorisé ; seuls `/recherche`, `/api`,
 * `/carte` et les URLs à PARAMÈTRES (prixMin, ville, meuble…) sont interdits.
 * On n'utilise donc que les pages SEO par commune `/annonces/location/{type}/
 * {ville-INSEE}` (Nice = 06088) et les fiches, toutes en SSR.
 *
 * Fiche : JSON-LD `RealEstateListing` → `mainEntity` (Offer + itemOffered),
 * qui porte prix, URL, type, nom (type/pièces/surface/ville) et description.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';
import { collectJsonLdNodes, findJsonLdNode } from '../shared/json-ld.js';

/**
 * URL de fiche : `/annonces/location/{type}/{ville-cp}/{réf}`, réf
 * alphanumérique (ex. `GES84550057-53`). Le dernier segment doit contenir un
 * chiffre pour distinguer d'une page de catégorie.
 */
const FICHE_PATTERN =
  /\/annonces\/location\/([a-z-]+)\/([a-z-]+-\d{5})\/([A-Z0-9][A-Z0-9-]*\d[A-Z0-9-]*)\/?$/i;

/** Types de biens résidentiels dont on veut les fiches (§30). */
const RESIDENTIAL_TYPES = /^(appartement|maison|studio|duplex|loft|villa)/i;

export interface ParsedCityaUrl {
  readonly reference: string;
  readonly canonicalUrl: string;
  readonly typeSlug: string;
  readonly citySlug: string;
}

/** Analyse une URL de fiche. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string, baseUrl: string): ParsedCityaUrl | null {
  let resolved: URL;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return null;
  }
  if (new URL(baseUrl).hostname !== resolved.hostname) return null;

  const match = FICHE_PATTERN.exec(resolved.pathname);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  return {
    typeSlug: match[1].toLowerCase(),
    citySlug: match[2].toLowerCase(),
    reference: match[3],
    canonicalUrl: `${resolved.origin}${resolved.pathname}`,
  };
}

/** `true` si la fiche est un logement (pas parking/terrain/local pro). */
export function isResidential(url: ParsedCityaUrl): boolean {
  return RESIDENTIAL_TYPES.test(url.typeSlug);
}

export interface ParsedList {
  readonly urls: readonly ParsedCityaUrl[];
  readonly warnings: readonly string[];
}

/** Extrait les liens de fiches d'une page de liste (cartes `property-card`). */
export function parseListPage(html: string, pageUrl: string): ParsedList {
  const $ = cheerio.load(html);
  const seen = new Map<string, ParsedCityaUrl>();

  $('a[href]').each((_i, el) => {
    const parsed = parseListingUrl($(el).attr('href') ?? '', pageUrl);
    if (parsed !== null && isResidential(parsed) && !seen.has(parsed.reference)) {
      seen.set(parsed.reference, parsed);
    }
  });

  const urls = [...seen.values()];
  return {
    urls,
    warnings: urls.length === 0 ? [`Aucune fiche trouvée sur la liste : ${pageUrl}`] : [],
  };
}

/** Sous-ensemble utile du JSON-LD RealEstateListing. */
interface CityaJsonLd {
  readonly price?: number;
  readonly name?: string;
  readonly description?: string;
  readonly propertyType?: string;
}

/** Décode le JSON-LD RealEstateListing d'une fiche. `null` si absent. */
function parseJsonLd($: cheerio.CheerioAPI): CityaJsonLd | null {
  const node = findJsonLdNode(collectJsonLdNodes($), ['realestatelisting']);
  const offer = node?.['mainEntity'] as
    { price?: unknown; itemOffered?: Record<string, unknown> } | undefined;
  if (offer === undefined) return null;
  const item = offer.itemOffered ?? {};
  return {
    ...(typeof offer.price === 'number' ? { price: offer.price } : {}),
    ...(typeof item['name'] === 'string' ? { name: item['name'] } : {}),
    ...(typeof item['description'] === 'string' ? { description: item['description'] } : {}),
    ...(typeof item['@type'] === 'string' ? { propertyType: item['@type'] } : {}),
  };
}

export interface ParsedDetail {
  readonly listing: RawListing | null;
  readonly warnings: readonly string[];
}

/** Analyse une fiche bien et en extrait l'annonce. */
export function parseDetailPage(html: string, pageUrl: string, agencyName: string): ParsedDetail {
  const parsedUrl = parseListingUrl(pageUrl, pageUrl);
  if (parsedUrl === null) {
    return { listing: null, warnings: [`URL inattendue pour une fiche : ${pageUrl}`] };
  }

  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const jsonLd = parseJsonLd($);

  // Titre plateforme « Appartement à louer 2 pièces 26.76m² - Nice (06) ».
  const pageTitle = cleanText($('title').first().text()).split('|')[0]?.trim() ?? '';
  const name = jsonLd?.name ?? pageTitle;
  const description = jsonLd?.description ?? '';

  const priceText = jsonLd?.price !== undefined ? `${jsonLd.price} €` : undefined;
  if (priceText === undefined) warnings.push(`Fiche sans prix : ${pageUrl}`);

  const areaText = name.match(/\d+(?:[.,]\d+)?\s*m²/i)?.[0];
  const roomsText = name.match(/\d+\s*pi[eè]ces?/i)?.[0];
  // Code postal réel : dans la description/titre (« 06100 ») — l'URL a l'INSEE.
  const postalCode = `${name} ${description}`.match(/\b(06\d{3})\b/)?.[1];

  // Photos du bien : elles sont sous `/media/images/agences/biens/…/location/`.
  // On exige `/biens/` pour écarter l'habillage de marque (ex.
  // `/assets/media/images/vesta-….webp`), qui matcherait sinon et serait envoyé
  // à tort comme photo d'annonce dans une alerte (§29).
  const imageUrls: string[] = [];
  $('img[src], img[data-src]').each((_i, el) => {
    const src = $(el).attr('src') ?? $(el).attr('data-src') ?? '';
    if (/\/biens\//i.test(src) && /\.(jpe?g|webp|png)/i.test(src)) {
      try {
        const absolute = new URL(src, pageUrl).toString();
        if (!imageUrls.includes(absolute)) imageUrls.push(absolute);
      } catch {
        /* src illisible */
      }
    }
  });

  const listing: RawListing = {
    sourceRef: parsedUrl.reference,
    sourceUrl: parsedUrl.canonicalUrl,
    ...(name !== '' ? { title: name } : {}),
    ...(description !== '' ? { description } : {}),
    ...(priceText !== undefined ? { priceText } : {}),
    ...(areaText !== undefined ? { areaText } : {}),
    ...(roomsText !== undefined ? { roomsText } : {}),
    propertyTypeText: `${parsedUrl.typeSlug} ${jsonLd?.propertyType ?? ''}`,
    furnishedText: `${name} ${description}`,
    cityText: 'nice',
    ...(postalCode !== undefined ? { postalCodeText: postalCode } : {}),
    agencyName,
    contactFormUrl: parsedUrl.canonicalUrl,
    ...(imageUrls.length > 0 ? { imageUrls: imageUrls.slice(0, 10) } : {}),
    extra: { reference: parsedUrl.reference },
  };

  return { listing, warnings };
}
