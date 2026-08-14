/**
 * Normalisation : `RawListing` → `NormalizedListing` (§12).
 *
 * Le scraper extrait des chaînes ; la normalisation les transforme en données
 * typées et vérifiées. La séparation est stricte : aucun scraper ne fait de
 * parsing métier, et la normalisation ne connaît aucune particularité de site.
 * C'est ce qui permet d'ajouter une source sans toucher au reste (§47, §76).
 */

import type {
  Contact,
  LandlordKind,
  NormalizedListing,
  RawListing,
  SourceId,
} from '@rentfinder/shared';
import { EMPTY_CONTACT } from '@rentfinder/shared';
import { cleanText, comparable } from './text.js';
import {
  parseArea,
  parseBedrooms,
  parseCharges,
  parseEmail,
  parseFurnished,
  parsePhone,
  parsePostalCode,
  parsePrice,
  parsePropertyType,
  parsePublishedAt,
  parseRooms,
} from './parse-listing-fields.js';
import { extractNumber } from './parse-number.js';

export interface NormalizeOptions {
  readonly sourceId: SourceId;
  /** Instant de la collecte, injecté pour la reproductibilité (§59). */
  readonly nowMs: number;
  /**
   * Date de première observation si l'annonce est déjà connue.
   * Absente pour une annonce nouvellement découverte.
   */
  readonly firstSeenAt?: string;
}

/** Identifiant stable et lisible d'une occurrence. */
export function occurrenceId(sourceId: SourceId, sourceRef: string): string {
  return `${sourceId}:${sourceRef}`;
}

function toNull(value: string | undefined): string | null {
  const cleaned = cleanText(value);
  return cleaned === '' ? null : cleaned;
}

/**
 * Déduit la nature du bailleur.
 * Une agence nommée suffit à trancher ; sans indice, on reste sur `unknown`
 * plutôt que de supposer un particulier (§17).
 */
function inferLandlordKind(raw: RawListing): LandlordKind {
  if (toNull(raw.agencyName) !== null) return 'agency';
  const haystack = comparable(`${raw.title ?? ''} ${raw.description ?? ''}`);
  if (/\bparticulier\b|\bde particulier a particulier\b/.test(haystack)) return 'private';
  return 'unknown';
}

/** Construit les coordonnées à partir des champs bruts (§21). */
function buildContact(raw: RawListing, sourceId: SourceId): Contact {
  const phone = parsePhone(raw.phoneText);
  const email = parseEmail(raw.emailText);
  const agencyName = toNull(raw.agencyName);
  const name = toNull(raw.contactName);
  const formUrl = toNull(raw.contactFormUrl);
  const reference = toNull(raw.extra?.['reference']) ?? raw.sourceRef;

  const hasAny =
    phone !== null || email !== null || agencyName !== null || name !== null || formUrl !== null;

  return {
    ...EMPTY_CONTACT,
    name,
    agencyName,
    phone,
    email,
    formUrl,
    reference,
    kind: inferLandlordKind(raw),
    providedBy: hasAny ? [sourceId] : [],
  };
}

/**
 * Transforme une annonce brute en annonce normalisée.
 *
 * @returns l'annonce normalisée, ou `null` si elle est inexploitable —
 *          c'est-à-dire sans URL ou sans référence stable, auquel cas on ne
 *          saurait ni la dédoublonner ni la retrouver.
 */
export function normalizeListing(
  raw: RawListing,
  options: NormalizeOptions,
): NormalizedListing | null {
  const sourceUrl = cleanText(raw.sourceUrl);
  const sourceRef = cleanText(raw.sourceRef);
  if (sourceUrl === '' || sourceRef === '') return null;

  const nowIso = new Date(options.nowMs).toISOString();
  const price = parsePrice(raw.priceText);

  // La surface peut apparaître dans un champ dédié ou seulement dans le titre.
  const area = parseArea(raw.areaText) ?? parseArea(raw.title) ?? parseArea(raw.description);

  const roomsSource = `${raw.roomsText ?? ''} ${raw.title ?? ''}`;
  const rooms = parseRooms(roomsSource);

  const typeSource = `${raw.propertyTypeText ?? ''} ${raw.title ?? ''}`;
  const furnishedSource = `${raw.furnishedText ?? ''} ${raw.extra?.['features'] ?? ''} ${raw.description ?? ''}`;

  const postalCode =
    parsePostalCode(raw.postalCodeText) ??
    parsePostalCode(raw.addressText) ??
    parsePostalCode(raw.cityText);

  return {
    id: occurrenceId(options.sourceId, sourceRef),
    sourceId: options.sourceId,
    sourceRef,
    sourceUrl,

    title: toNull(raw.title),
    description: toNull(raw.description),

    price: price.amount,
    charges: parseCharges(raw.chargesText) ?? parseCharges(raw.priceText),
    chargesIncluded: price.chargesIncluded,
    area,
    rooms,
    bedrooms: parseBedrooms(`${raw.roomsText ?? ''} ${raw.extra?.['features'] ?? ''}`),
    propertyType: parsePropertyType(typeSource),
    furnished: parseFurnished(furnishedSource),

    address: toNull(raw.addressText),
    // La ville est stockée en forme comparable pour que les filtres et le
    // dédoublonnage n'aient jamais à se soucier de la casse ni des accents.
    city: raw.cityText !== undefined ? comparable(raw.cityText) || null : null,
    postalCode,
    latitude: Number.isFinite(raw.latitude) ? (raw.latitude ?? null) : null,
    longitude: Number.isFinite(raw.longitude) ? (raw.longitude ?? null) : null,

    contact: buildContact(raw, options.sourceId),

    publishedAt: parsePublishedAt(raw.publishedAtText, options.nowMs),
    availableAt: parsePublishedAt(raw.availableAtText, options.nowMs),

    // §11 : uniquement des URLs distantes, jamais de téléchargement.
    imageUrls: [...(raw.imageUrls ?? [])].filter((url) => url.startsWith('http')),

    // §17 : `null` signifie « la source ne publie pas cette information ».
    views: extractNumber(raw.viewsText, { min: 0, max: 10_000_000 }),
    favorites: extractNumber(raw.favoritesText, { min: 0, max: 1_000_000 }),

    firstSeenAt: options.firstSeenAt ?? nowIso,
    lastSeenAt: nowIso,
    scrapedAt: nowIso,
    lifecycle: 'active',
  };
}

/** Normalise un lot, en écartant silencieusement les annonces inexploitables. */
export function normalizeAll(
  raws: readonly RawListing[],
  options: NormalizeOptions,
): NormalizedListing[] {
  const results: NormalizedListing[] = [];
  for (const raw of raws) {
    const normalized = normalizeListing(raw, options);
    if (normalized !== null) results.push(normalized);
  }
  return results;
}
