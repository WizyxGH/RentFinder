/**
 * Adaptateur générique des sites d'agences sur la plateforme « La Boîte
 * Immo » / Hektor (§5, §47) — un seul parser pour plusieurs agences niçoises.
 *
 * Signature de la plateforme (vérifiée le 2026-08-17 sur 6 sites) :
 *   - robots.txt permissif (interdits : /stats, /phpmv2, /fonctions,
 *     /templates, /admin, /images/clients) + sitemap déclaré ;
 *   - pages LISTE server-rendered (`/location/1`, `/a-louer/1`…) avec liens de
 *     fiches contenant `/{id}-{slug}` ;
 *   - fiches avec table clé/valeur `table-aria__tr--{clé}` (code postal,
 *     pièces, meublé, loyer CC, charges…), description
 *     `property-detail-v1__description__text`, photos sur `*.staticlbi.com` ;
 *   - DPE servi en IMAGE générée sous /admin (interdit par robots) → laissé
 *     inconnu, honnêtement (§17).
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';
import { compactListing } from '../shared/raw-listing.js';

/**
 * Identifiant d'une fiche dans une URL Hektor : dernier segment `{id}-{slug}`
 * (avec `.html` final sur certains sites). Les pages de liste (`/location/2`)
 * et les pages éditoriales (`/contact.html`) n'ont pas cette forme.
 */
const FICHE_SEGMENT = /\/(\d{1,7})-([a-z0-9][a-z0-9-]*)(?:\.html)?\/?$/i;

export interface ParsedHektorUrl {
  readonly reference: string;
  readonly canonicalUrl: string;
  /** Slug de ville si l'URL contient un segment `/1-{ville}/` (sites à zones). */
  readonly citySlug: string | null;
}

/** Analyse une URL de fiche. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string, baseUrl: string): ParsedHektorUrl | null {
  let resolved: URL;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return null;
  }
  // Jamais hors du site de l'agence.
  if (new URL(baseUrl).hostname !== resolved.hostname) return null;

  const match = FICHE_SEGMENT.exec(resolved.pathname);
  if (match?.[1] === undefined) return null;
  // Les listes paginées type `/location/2` ont un id mais pas de slug — le
  // motif exige le tiret, donc elles sont déjà écartées. Écarte aussi les
  // pages de zone `/location/1-nice/` sans fiche (le segment fiche est final).
  const citySlug = /\/\d{1,3}-([a-z-]+)\//i.exec(resolved.pathname)?.[1] ?? null;

  return {
    reference: match[1],
    canonicalUrl: `${resolved.origin}${resolved.pathname}`,
    citySlug: citySlug?.toLowerCase() ?? null,
  };
}

export interface ParsedList {
  readonly urls: readonly ParsedHektorUrl[];
  readonly warnings: readonly string[];
}

/** Extrait les liens de fiches d'une page de liste. */
export function parseListPage(html: string, pageUrl: string): ParsedList {
  const $ = cheerio.load(html);
  const seen = new Map<string, ParsedHektorUrl>();

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const parsed = parseListingUrl(href, pageUrl);
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

/** Lit la table clé/valeur `table-aria` de la fiche. */
function readAriaTable($: cheerio.CheerioAPI): Map<string, string> {
  const rows = new Map<string, string>();
  $('[class*="table-aria__tr--"]').each((_i, el) => {
    const className = $(el).attr('class') ?? '';
    const key = /table-aria__tr--([\w-]+)/.exec(className)?.[1];
    if (key === undefined || rows.has(key)) return;
    const cells = $(el).find('[role="cell"]');
    const value = cleanText($(cells.get(cells.length - 1)).text());
    if (value !== '') rows.set(key, value);
  });
  return rows;
}

/** Clés booléennes de la table promues en atouts quand elles valent OUI. */
const FEATURE_KEYS: Readonly<Record<string, string>> = {
  balcon: 'Balcon',
  terrasse: 'Terrasse',
  ASCENSEUR: 'Ascenseur',
  ascenseur: 'Ascenseur',
  interphone: 'Interphone',
  cave: 'Cave',
  parking: 'Parking',
  climatisation: 'Climatisation',
};

/** Analyse une fiche bien et en extrait l'annonce. */
/**
 * Type de bien et ville, depuis le `<title>` plateforme (« Location {type}
 * {Ville} … »), avec repli sur l'URL. Extrait pour alléger `parseDetailPage`.
 */
function parseTypeAndCity(
  pageTitle: string,
  parsedUrl: ParsedHektorUrl,
): { propertyTypeText: string; cityText: string | undefined } {
  const match =
    /^location\s+(appartement|studio|maison|villa|parking|garage|local|chambre|duplex|loft)\s+(.+?)(?:\s+\d|$)/i.exec(
      pageTitle,
    );
  return {
    propertyTypeText: match?.[1] ?? parsedUrl.canonicalUrl,
    cityText:
      match?.[2]?.trim() ??
      (parsedUrl.citySlug !== null ? parsedUrl.citySlug.replace(/-/g, ' ') : undefined),
  };
}

export function parseDetailPage(html: string, pageUrl: string, agencyName: string): ParsedDetail {
  const parsedUrl = parseListingUrl(pageUrl, pageUrl);
  if (parsedUrl === null) {
    return { listing: null, warnings: [`URL inattendue pour une fiche : ${pageUrl}`] };
  }

  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const table = readAriaTable($);

  // <title> « Location appartement Nice 3 pièces 54.25m² 1460€ | Agence » —
  // généré par la plateforme, riche ; le h1 est le titre libre de l'annonce.
  const pageTitle = cleanText($('title').first().text()).split('|')[0]?.trim() ?? '';
  const h1 = cleanText($('h1').first().text().replace(/\s+/g, ' '));
  const title = h1 !== '' ? h1 : pageTitle;

  const description = cleanText(
    $('[class*="description__text"]').first().text().replace(/\s+/g, ' '),
  );

  // Prix : la table (loyer CC) fait foi ; le <title> en secours.
  const loyerCc = table.get('loyer_cc');
  const priceText =
    loyerCc !== undefined ? `${loyerCc} CC` : (pageTitle.match(/[\d\s.,]+\s*€/)?.[0] ?? undefined);
  if (priceText === undefined) warnings.push(`Fiche sans prix : ${pageUrl}`);

  const areaText = `${pageTitle} ${h1}`.match(/\d+(?:[.,]\d+)?\s*m²/i)?.[0];
  const roomsFromTable = table.get('nbpiecees');
  const roomsText =
    roomsFromTable !== undefined
      ? `${roomsFromTable} pièces`
      : pageTitle.match(/\d+\s*pièces?/i)?.[0];

  // Meublé : la table est explicite (OUI/NON) — un texte fidèle à sa valeur,
  // jamais un « meublé » par défaut qui inverserait le sens (§17).
  const meuble = table.get('meuble');
  const furnishedText = meuble === undefined ? '' : /^oui$/i.test(meuble) ? 'meublé' : 'non meublé';

  const { propertyTypeText, cityText } = parseTypeAndCity(pageTitle, parsedUrl);

  const features = [...table.entries()]
    .filter(([key, value]) => FEATURE_KEYS[key] !== undefined && /^oui$/i.test(value))
    .map(([key]) => FEATURE_KEYS[key] as string);
  const vue = table.get('vue');
  const exposition = table.get('exposition');

  // Photos : CDN staticlbi de la plateforme, en pleine taille de préférence.
  const imageUrls: string[] = [];
  $('img[src*="staticlbi.com"]').each((_i, el) => {
    const src = ($(el).attr('src') ?? '').replace(/^\/\//, 'https://');
    const normalized = src.replace('/original/', '/1600xauto/');
    if (normalized.startsWith('https://') && !imageUrls.includes(normalized)) {
      imageUrls.push(normalized);
    }
  });

  const chargesValue = table.get('ChargesAnnonceLocation_forfaitaires_mensuelles');

  // Atouts consolidés (caractéristiques + vue + exposition), pour la liste
  // d'atouts en normalisation.
  const featureList = [
    ...features,
    ...(vue !== undefined ? [`Vue ${vue}`] : []),
    ...(exposition !== undefined ? [`Exposition ${exposition}`] : []),
  ];
  const extra: Record<string, string> = { reference: parsedUrl.reference };
  if (featureList.length > 0) extra['features'] = featureList.join(' · ');

  const listing = compactListing({
    sourceRef: parsedUrl.reference,
    sourceUrl: parsedUrl.canonicalUrl,
    title: title !== '' ? title : undefined,
    description: description !== '' ? description : undefined,
    priceText,
    chargesText: chargesValue !== undefined ? `${chargesValue} de charges` : undefined,
    areaText,
    roomsText,
    propertyTypeText,
    furnishedText,
    cityText,
    postalCodeText: table.get('cp'),
    agencyName,
    contactFormUrl: parsedUrl.canonicalUrl,
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    extra,
  });

  return { listing, warnings };
}
