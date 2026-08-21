/**
 * Source : In'li (inli.fr) — bailleur institutionnel de LOGEMENT INTERMÉDIAIRE
 * (filiale Action Logement). Loyers « à prix maîtrisé », nettement sous le
 * marché, mais réservés sous conditions (salariés du secteur privé, plafonds de
 * ressources) — une éligibilité que l'utilisateur vérifie lui-même (§17).
 *
 * Vérifié le 2026-08-21 : robots.txt permissif (seul `/espace-membre/` interdit).
 * Le catalogue est une liste paginée server-rendered `/locations/offres/?page=N`
 * (~22 pages, France entière) sans filtre serveur par ville exploitable — la
 * localisation passe par une autocomplétion JS non reproductible en HTTP. On
 * pagine donc et on ne RETIENT que les fiches de Nice ; on ne VISITE que les
 * nouvelles (§30, §32). Les pages liste bénéficient du cache conditionnel.
 *
 * Fiche sans JSON-LD mais SSR riche : `og:title` (surface), `og:description`
 * (loyer CC), et corps (pièces, chambres, charges, photos). Pas d'adresse de
 * rue (le logement intermédiaire ne la publie pas) : ville + code postal.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/** URL de fiche : `/location-{type}-{ville}-{cp}/{réf}`. */
const FICHE_PATTERN = /^\/location-([a-z]+)-([a-z-]+)-(\d{5})\/(.+)$/i;

export interface ParsedInliUrl {
  readonly reference: string;
  readonly canonicalUrl: string;
  readonly propertyType: string;
  readonly citySlug: string;
  readonly postalCode: string;
}

/** Analyse une URL de fiche. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string, baseUrl: string): ParsedInliUrl | null {
  let resolved: URL;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return null;
  }
  if (new URL(baseUrl).hostname !== resolved.hostname) return null;

  const match = FICHE_PATTERN.exec(decodeURIComponent(resolved.pathname));
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  return {
    reference: match[4] as string,
    canonicalUrl: `${resolved.origin}${resolved.pathname}`,
    propertyType: match[1].toLowerCase(),
    citySlug: match[2].toLowerCase(),
    postalCode: match[3],
  };
}

/** `true` si la fiche est un logement de Nice même (exclut Cannet, Menton…). */
export function isTargetListing(url: ParsedInliUrl): boolean {
  return url.citySlug === 'nice';
}

export interface ParsedList {
  readonly urls: readonly ParsedInliUrl[];
  /** Numéro de la dernière page de pagination (1 si page unique). */
  readonly lastPage: number;
  readonly warnings: readonly string[];
}

/** Extrait les liens de fiches et le nombre de pages d'une page de liste. */
export function parseListPage(html: string, pageUrl: string): ParsedList {
  const $ = cheerio.load(html);
  const seen = new Map<string, ParsedInliUrl>();
  let lastPage = 1;

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const parsed = parseListingUrl(href, pageUrl);
    if (parsed !== null && !seen.has(parsed.reference)) seen.set(parsed.reference, parsed);
    const pageMatch = /[?&]page=(\d+)/.exec(href);
    if (pageMatch?.[1] !== undefined) lastPage = Math.max(lastPage, Number(pageMatch[1]));
  });

  const urls = [...seen.values()];
  return {
    urls,
    lastPage,
    warnings: urls.length === 0 ? [`Aucune fiche trouvée sur la liste : ${pageUrl}`] : [],
  };
}

export interface ParsedDetail {
  readonly listing: RawListing | null;
  readonly warnings: readonly string[];
}

/** Analyse une fiche bien (SSR : balises og + corps). */
export function parseDetailPage(html: string, pageUrl: string, agencyName: string): ParsedDetail {
  const parsedUrl = parseListingUrl(pageUrl, pageUrl);
  if (parsedUrl === null) {
    return { listing: null, warnings: [`URL inattendue pour une fiche : ${pageUrl}`] };
  }

  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const ogTitle = $('meta[property="og:title"]').attr('content') ?? '';
  const ogDescription = $('meta[property="og:description"]').attr('content') ?? '';

  // Loyer charges comprises, annoncé proprement dans og:description
  // (« Loyer : 656€ CC »).
  const priceMatch = ogDescription.match(/loyer\s*:?\s*([\d\s.,]+)\s*€\s*(cc|c\.c\.)?/i);
  const priceText =
    priceMatch?.[1] !== undefined ? `${priceMatch[1].trim()} € par mois CC` : undefined;
  if (priceText === undefined) warnings.push(`Fiche sans loyer lisible : ${pageUrl}`);

  // Provision de charges, dans le corps (« Provisions de charges … 121 € »).
  const charges = html.match(/provisions? de charges[^€]*?([\d\s.,]+)\s*€/i)?.[1];

  // Surface : og:title (« … 55.5m² … »), sinon corps.
  const area =
    ogTitle.match(/([\d.,]+)\s*m²/)?.[1] ??
    cleanText($('body').text()).match(/([\d.,]+)\s*m²/)?.[1];

  const bodyText = cleanText($('body').text().replace(/\s+/g, ' '));
  const rooms = bodyText.match(/(\d+)\s*pi[eè]ces?/i)?.[1];

  const imageUrls: string[] = [];
  $('img[src]').each((_i, el) => {
    const src = $(el).attr('src') ?? '';
    if (!/\.(jpg|jpeg|png|webp)/i.test(src) || /logo|icon|placeholder/i.test(src)) return;
    try {
      const absolute = new URL(src, pageUrl).toString();
      if (!imageUrls.includes(absolute)) imageUrls.push(absolute);
    } catch {
      /* src illisible : photo ignorée */
    }
  });

  const listing: RawListing = {
    sourceRef: parsedUrl.reference,
    sourceUrl: parsedUrl.canonicalUrl,
    ...(ogTitle !== '' ? { title: cleanText(ogTitle) } : {}),
    ...(ogDescription !== '' ? { description: cleanText(ogDescription) } : {}),
    ...(priceText !== undefined ? { priceText } : {}),
    ...(charges !== undefined ? { chargesText: `${charges.trim()} € de charges` } : {}),
    ...(area !== undefined ? { areaText: `${area} m²` } : {}),
    ...(rooms !== undefined ? { roomsText: `${rooms} pièces` } : {}),
    propertyTypeText: parsedUrl.propertyType,
    cityText: parsedUrl.citySlug.replace(/-/g, ' '),
    postalCodeText: parsedUrl.postalCode,
    agencyName,
    contactFormUrl: parsedUrl.canonicalUrl,
    ...(imageUrls.length > 0 ? { imageUrls } : {}),
    extra: { reference: parsedUrl.reference, priceControlled: 'Loyer à prix maîtrisé (In’li)' },
  };

  return { listing, warnings };
}
