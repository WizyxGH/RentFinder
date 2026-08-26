/**
 * Parseurs de la plateforme ADAPTIMMO / Ubiflow (§5, §47).
 *
 * Troisième plateforme d'agences rencontrée sur Nice après Apimo/Cello et
 * Hektor/La Boîte Immo. Beaucoup d'agences des Alpes-Maritimes tournent dessus :
 * l'adaptateur est donc générique, paramétré par domaine (voir `scraper.ts`).
 *
 * Deux particularités :
 *
 *  - Les pages sont servies en `windows-1252` sans le déclarer dans l'en-tête
 *    HTTP. Le client HTTP du projet lit la balise `<meta charset>` et décode en
 *    conséquence — sans quoi tous les accents seraient perdus.
 *  - Les RUBANS « Vendu / Loué / Sous compromis » sont pré-rendus EN DUR dans
 *    chaque carte et masqués par JavaScript. Les lire donnerait n'importe quoi.
 *    Le statut réel est porté par `li[data-ribbon-prop="Vendu"]` (0 = encore
 *    disponible) et le type d'opération par `costpermonth[data-ope]` (2 =
 *    location).
 *
 * La liste ne porte NI surface NI nombre de pièces : ils vivent sur la fiche
 * (`detail.htm?cle=…`), d'où une visite par annonce nouvelle seulement (§30).
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/** Une carte de la page de liste, avant enrichissement par la fiche. */
export interface AdaptImmoCard {
  readonly reference: string;
  readonly sourceUrl: string;
  readonly propertyTypeText: string;
  /** « Nice - Cimiez » : commune puis quartier. */
  readonly localityText: string;
  readonly priceText: string | undefined;
  readonly imageUrl: string | undefined;
}

/** Opération « location » dans le vocabulaire AdaptImmo. */
const OPERATION_RENTAL = '2';

/**
 * `data-price` est au format ANGLO-SAXON (« 1,000.00 » = mille euros) : la
 * virgule sépare les milliers, le point les décimales. Tel quel, un parseur de
 * prix français y lirait « 1 ». On rend un montant entier propre, en euros.
 */
function normalizeAmount(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number.parseFloat(raw.replace(/,/g, ''));
  return Number.isFinite(value) ? `${Math.round(value)} € CC` : undefined;
}

/**
 * Extrait les cartes de LOCATION encore disponibles d'une page de liste.
 * Dédoublonnées sur la référence : le gabarit répète chaque bien en plusieurs
 * variantes d'affichage (vignette, liste, carte).
 */
export function parseListPage(html: string, pageUrl: string): AdaptImmoCard[] {
  const $ = cheerio.load(html);
  const byReference = new Map<string, AdaptImmoCard>();

  $('.liste-bien-container').each((_i, el) => {
    const card = $(el);
    const price = card.find('costpermonth').first();
    // Seules les locations, et seulement si le bien n'est pas déjà pris.
    if (price.attr('data-ope') !== OPERATION_RENTAL) return;
    const sold = cleanText(card.find('li[data-ribbon-prop="Vendu"]').first().text());
    if (sold === '1') return;

    const href = card.find('a[href*="detail.htm"]').first().attr('href') ?? '';
    const reference = card.attr('data-show-on-map') ?? /[?&]cle=(\d+)/.exec(href)?.[1] ?? null;
    if (reference === null || reference === '' || byReference.has(reference)) return;

    let sourceUrl: string;
    try {
      // On retire les paramètres d'affichage (`monnaie`) : l'URL doit rester
      // celle qu'un humain partagerait.
      const url = new URL(href, pageUrl);
      url.search = `?cle=${reference}`;
      sourceUrl = url.toString();
    } catch {
      return;
    }

    const amount = normalizeAmount(price.attr('data-price'));
    // L'image est en `data-src` (chargement différé) ; `vide_liste.jpg` est le
    // visuel de remplacement des biens sans photo — ce n'est pas une photo.
    const image = card.find('img.liste-bien-photo-slideshow').first().attr('data-src');

    byReference.set(reference, {
      reference,
      sourceUrl,
      propertyTypeText: cleanText(card.find('h2.liste-bien-type').first().text()),
      localityText: cleanText(card.find('h3.liste-bien-ville').first().text()),
      priceText: amount,
      imageUrl:
        image !== undefined && /^https?:/i.test(image) && !/vide_liste/i.test(image)
          ? image
          : undefined,
    });
  });

  return [...byReference.values()];
}

/** Valeur d'une caractéristique de la fiche, repérée par son libellé. */
function specValue($: cheerio.CheerioAPI, label: RegExp): string | undefined {
  let found: string | undefined;
  $('.detail-bien-specs li').each((_i, el) => {
    if (found !== undefined) return;
    const item = $(el);
    if (!label.test(cleanText(item.find('.bien-specs-label').text()))) return;
    // La valeur est le texte de l'élément, moins son libellé.
    const whole = cleanText(item.text().replace(/\s+/g, ' '));
    const withoutLabel = whole.replace(/^\s*[A-Za-zÀ-ÿ()'’\s]*?(?=\d)/, '').trim();
    if (withoutLabel !== '' && /\d/.test(withoutLabel)) found = withoutLabel;
  });
  return found;
}

/** Champs supplémentaires lus sur la fiche d'une annonce. */
export interface AdaptImmoDetail {
  readonly areaText?: string;
  readonly roomsText?: string;
  readonly postalCodeText?: string;
  readonly description?: string;
}

/** Lit surface, pièces, code postal et description d'une fiche. */
export function parseDetailPage(html: string): AdaptImmoDetail {
  const $ = cheerio.load(html);
  const area = specValue($, /surface/i);
  const rooms = specValue($, /pi[eè]ce/i);
  // Le code postal apparaît en « Ville (06000) » dans l'en-tête de la fiche.
  const postal = /\((\d{5})\)/.exec($('body').text())?.[1];
  const description = cleanText($('[itemprop="description"]').first().text().replace(/\s+/g, ' '));

  return {
    ...(area !== undefined ? { areaText: area } : {}),
    ...(rooms !== undefined ? { roomsText: rooms } : {}),
    ...(postal !== undefined ? { postalCodeText: postal } : {}),
    ...(description !== '' ? { description } : {}),
  };
}

/** Assemble une carte et sa fiche en une annonce brute. */
export function toRawListing(
  card: AdaptImmoCard,
  detail: AdaptImmoDetail,
  agencyName: string,
): RawListing {
  // « Nice - Cimiez » : la commune est avant le tiret, le quartier après.
  const [city, district] = card.localityText.split(/\s+-\s+/, 2);

  const draft: Record<string, unknown> = {
    sourceRef: card.reference,
    sourceUrl: card.sourceUrl,
    title: [card.propertyTypeText, card.localityText].filter((p) => p !== '').join(' — '),
    propertyTypeText: card.propertyTypeText,
    cityText: city?.trim(),
    agencyName,
    contactFormUrl: card.sourceUrl,
    extra: { reference: card.reference, ...(district !== undefined ? { quartier: district } : {}) },
    ...(card.priceText !== undefined ? { priceText: card.priceText } : {}),
    ...(card.imageUrl !== undefined ? { imageUrls: [card.imageUrl] } : {}),
    ...detail,
  };
  for (const [key, value] of Object.entries(draft)) {
    if (value === undefined || value === '') delete draft[key];
  }
  return draft as unknown as RawListing;
}
