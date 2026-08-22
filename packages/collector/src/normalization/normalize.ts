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
  parseDpe,
  parseFlatShare,
  parseFurnished,
  extractFeatures,
  extractStreetAddress,
  parseAvailableAt,
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

/** Signes FORTS qu'un bien est à vendre (et non à louer). */
const SALE_MARKERS =
  /\bà vendre\b|\bprix de vente\b|\bfrais de notaire\b|\bhonoraires? (à la )?charge (de l')?acqu[eé]reur\b|\bviager\b|\bà l['e ]achat\b|\bnos biens à vendre\b/;
/** Signes qu'il s'agit bien d'une location (priment sur une ambiguïté). */
const RENTAL_MARKERS =
  /\bà louer\b|\blocation\b|\bloyer\b|\/mois\b|\bmensuel\b|\bbail\b|\bcaution\b/;

/**
 * `true` si l'annonce est clairement une VENTE. On combine titre, description
 * et URL, et on n'exclut que si un marqueur de vente est présent SANS marqueur
 * de location — mieux vaut garder une location douteuse que jeter un vrai bien.
 */
function isForSale(raw: RawListing): boolean {
  const text = comparable(
    `${raw.title ?? ''} ${raw.description ?? ''} ${raw.propertyTypeText ?? ''}`,
  );
  const url = comparable(raw.sourceUrl ?? '');
  // Une URL de vente explicite (/vente/, /acheter/, /achat/) suffit.
  if (/\bvente\b|\bacheter\b|\bachat\b/.test(url) && !/\blocation\b|\blouer\b/.test(url)) {
    return true;
  }
  return SALE_MARKERS.test(text) && !RENTAL_MARKERS.test(text);
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

/** Localisation résolue depuis les multiples champs bruts possibles (§14, §20). */
function resolveLocation(raw: RawListing): {
  address: string | null;
  city: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  return {
    // Adresse : champ dédié, sinon repérée en tête de description (« 22-24
    // Avenue… » — beaucoup d'agences l'y mettent en première ligne).
    address: toNull(raw.addressText) ?? extractStreetAddress(raw.description),
    // Ville en forme comparable : les filtres et le dédoublonnage ignorent
    // ainsi casse et accents.
    city: raw.cityText !== undefined ? comparable(raw.cityText) || null : null,
    postalCode:
      parsePostalCode(raw.postalCodeText) ??
      parsePostalCode(raw.addressText) ??
      parsePostalCode(raw.cityText),
    latitude: Number.isFinite(raw.latitude) ? (raw.latitude ?? null) : null,
    longitude: Number.isFinite(raw.longitude) ? (raw.longitude ?? null) : null,
  };
}

/** Surface : champ dédié, sinon repérée dans le titre ou la description. */
function resolveArea(raw: RawListing): number | null {
  return parseArea(raw.areaText) ?? parseArea(raw.title) ?? parseArea(raw.description);
}

/** DPE cherché dans les champs où les sources le publient. */
function resolveDpe(raw: RawListing): NormalizedListing['dpe'] {
  return (
    parseDpe(raw.extra?.['dpe']) ??
    parseDpe(raw.title) ??
    parseDpe(raw.description) ??
    parseDpe(raw.extra?.['features'])
  );
}

/** Disponibilité : champ dédié, sinon repérée dans le titre/la description. */
function resolveAvailability(raw: RawListing, nowMs: number): string | null {
  return (
    parseAvailableAt(raw.availableAtText, nowMs) ??
    parseAvailableAt(
      `${raw.title ?? ''} ${raw.description ?? ''}`.match(/disponi\w+[^.;!]{0,60}/i)?.[0],
      nowMs,
    )
  );
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

  // §3 : on ne veut QUE des locations. Les sources ciblent déjà des pages de
  // location, mais si l'une laisse passer un bien À VENDRE, on l'écarte
  // totalement (pas seulement « hors critères »). Prudence : on n'exclut que
  // sur un signe FORT de vente ET en l'absence de tout signe de location, pour
  // ne jamais jeter une vraie location par erreur (§17).
  if (isForSale(raw)) return null;

  const nowIso = new Date(options.nowMs).toISOString();
  const price = parsePrice(raw.priceText);
  const typeSource = `${raw.propertyTypeText ?? ''} ${raw.title ?? ''}`;
  const furnishedSource = `${raw.furnishedText ?? ''} ${raw.extra?.['features'] ?? ''} ${raw.description ?? ''}`;
  const location = resolveLocation(raw);

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
    area: resolveArea(raw),
    rooms: parseRooms(`${raw.roomsText ?? ''} ${raw.title ?? ''}`),
    bedrooms: parseBedrooms(`${raw.roomsText ?? ''} ${raw.extra?.['features'] ?? ''}`),
    propertyType: parsePropertyType(typeSource),
    furnished: parseFurnished(furnishedSource),
    flatShare: parseFlatShare(`${typeSource} ${raw.description ?? ''}`),
    dpe: resolveDpe(raw),
    features: extractFeatures(
      `${raw.title ?? ''} ${raw.description ?? ''} ${raw.furnishedText ?? ''} ${raw.extra?.['features'] ?? ''}`,
      raw.extra,
    ),

    // Localisation : décisive pour la distance (§20) et le dédoublonnage (§14).
    address: location.address,
    city: location.city,
    postalCode: location.postalCode,
    latitude: location.latitude,
    longitude: location.longitude,

    contact: buildContact(raw, options.sourceId),

    publishedAt: parsePublishedAt(raw.publishedAtText, options.nowMs),
    availableAt: resolveAvailability(raw, options.nowMs),

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
