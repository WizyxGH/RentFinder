/**
 * Source : Lamy Immobilier (réseau national, agences à Nice).
 *
 * Site sur Ibexa (CMS open source), server-rendered — aucun JS requis.
 * robots.txt permissif (seuls /is_admin/ et /login/ interdits), sitemap déclaré
 * (vérifié le 2026-08-17). ~3 200 fiches de location dans le sitemap, dont une
 * douzaine dans les Alpes-Maritimes.
 *
 * URLs de fiche :
 *   /louer/louer-un-bien/annonces-de-biens-a-louer/{région}/{département}/
 *     {ville}-{CP}/{type}-{ville}-{CP}-{référence}
 * avec une référence `flXXXXXXX`. Fiche ancrée sur les classes `estate__*` :
 * titre, localisation, prix (« par mois / CC »), référence, description,
 * caractéristiques, DPE/GES.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';
import { htmlToText } from '../shared/html-text.js';

/** Forme d'une URL de fiche Lamy. Le CP capture le département via son préfixe. */
const LISTING_URL_PATTERN =
  /^https?:\/\/(?:www\.)?lamy-immobilier\.fr\/louer\/louer-un-bien\/annonces-de-biens-a-louer\/[a-z0-9-]+\/[a-z0-9-]+\/([a-z0-9-]+)-(\d{5})\/([a-z0-9-]+)-\2-(fl\d+)\/?$/i;

export interface ParsedLamyUrl {
  readonly citySlug: string;
  readonly postalCode: string;
  readonly reference: string;
  readonly canonicalUrl: string;
}

/** Analyse une URL de fiche de location. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string): ParsedLamyUrl | null {
  const match = LISTING_URL_PATTERN.exec(href.trim());
  if (match === null) return null;
  const [, citySlug, postalCode, , reference] = match;
  if (citySlug === undefined || postalCode === undefined || reference === undefined) return null;
  return {
    citySlug: citySlug.toLowerCase(),
    postalCode,
    reference: reference.toLowerCase(),
    canonicalUrl: href.trim().replace(/[?#].*$/, ''),
  };
}

export interface LamySitemapEntry {
  readonly url: ParsedLamyUrl;
  readonly lastmod: string | null;
}

/** Extrait les fiches de location d'un sitemap urlset. */
export function parseSitemap(xml: string): LamySitemapEntry[] {
  const entries: LamySitemapEntry[] = [];
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  for (const block of blocks) {
    const loc = /<loc>(?:<!\[CDATA\[)?([^\]<]+?)(?:\]\]>)?<\/loc>/.exec(block)?.[1];
    if (loc === undefined) continue;
    const url = parseListingUrl(loc.trim());
    if (url === null) continue;
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(block)?.[1]?.trim() ?? null;
    entries.push({ url, lastmod });
  }
  return entries;
}

export interface ParsedDetail {
  readonly listing: RawListing | null;
  readonly warnings: readonly string[];
}

/** Analyse une fiche bien et en extrait l'annonce. */
export function parseDetailPage(html: string, pageUrl: string): ParsedDetail {
  const parsedUrl = parseListingUrl(pageUrl);
  if (parsedUrl === null) {
    return { listing: null, warnings: [`URL inattendue pour une fiche : ${pageUrl}`] };
  }

  const $ = cheerio.load(html);
  const warnings: string[] = [];

  // « Appartement · Location » → le type est le premier segment.
  const titleBlock = cleanText($('.estate__title').first().text());
  const propertyTypeText = titleBlock.split('·')[0]?.trim() ?? '';
  // « Nice (06200) »
  const location = cleanText($('.estate__location').first().text());
  const cityText = location.replace(/\s*\(\d{5}\)\s*/, '').trim();
  // « 3 pièces · 59m² »
  const mainInfos = cleanText($('.estate__main-infos').first().text());
  const roomsText = mainInfos.match(/\d+\s*pièces?/i)?.[0];
  const areaText = mainInfos.match(/\d+(?:[.,]\d+)?\s*m²/i)?.[0];

  // Prix : « 1 230 € » + mention « par mois / CC » (charges comprises).
  const priceText = cleanText($('.estate__price p').first().text());
  const priceMention = cleanText($('.estate__price span').first().text());
  if (priceText === '') warnings.push(`Fiche sans prix : ${pageUrl}`);

  const description = htmlToText($, '.estate__description');
  const availability = cleanText($('.estate__availability').first().text());

  // Caractéristiques : paires titre/valeur (« Étage : 2 », « Meublé : oui »…).
  const features: string[] = [];
  $('.estate__feature').each((_i, el) => {
    const feature = cleanText($(el).text().replace(/\s+/g, ' '));
    if (feature !== '') features.push(feature);
  });

  // Photos du carrousel (URLs publiques Cloudinary — jamais téléchargées, §11).
  const imageUrls: string[] = [];
  $('img.estate__img').each((_i, el) => {
    const src = $(el).attr('src') ?? '';
    if (src.startsWith('https://') && !imageUrls.includes(src)) imageUrls.push(src);
  });

  // DPE : la lettre active de l'échelle (« estate__score-dpe--e ») ; le texte
  // « DPE : E - 314 kWh/m².an » sert de secours.
  const dpeClass = $('.estate__score-dpe--active').attr('class') ?? '';
  const dpe =
    /score-dpe--([a-g])\b/.exec(dpeClass)?.[1]?.toUpperCase() ??
    /DPE\)?\s*:\s*([A-G])\b/.exec($('body').text())?.[1];

  const title = cleanText(
    `${propertyTypeText || 'Bien'} ${roomsText ?? ''} ${areaText ?? ''} — ${location}`.replace(
      /\s+/g,
      ' ',
    ),
  );

  const listing: RawListing = {
    sourceRef: parsedUrl.reference,
    sourceUrl: parsedUrl.canonicalUrl,
    title,
    ...(description !== '' ? { description } : {}),
    ...(priceText !== '' ? { priceText: `${priceText} ${priceMention}`.trim() } : {}),
    ...(areaText !== undefined ? { areaText } : {}),
    ...(roomsText !== undefined ? { roomsText } : {}),
    ...(propertyTypeText !== '' ? { propertyTypeText } : {}),
    furnishedText: `${title} ${description} ${features.join(' ')}`,
    cityText: cityText !== '' ? cityText : parsedUrl.citySlug.replace(/-/g, ' '),
    postalCodeText: parsedUrl.postalCode,
    agencyName: 'Lamy Immobilier',
    // §23 : le formulaire de la fiche est le canal de contact prévu.
    contactFormUrl: parsedUrl.canonicalUrl,
    ...(availability !== '' ? { availableAtText: availability } : {}),
    ...(imageUrls.length > 0 ? { imageUrls } : {}),
    extra: {
      reference: parsedUrl.reference,
      citySlug: parsedUrl.citySlug,
      ...(features.length > 0 ? { features: features.join(' · ') } : {}),
      ...(dpe !== undefined ? { dpe } : {}),
    },
  };

  return { listing, warnings };
}
