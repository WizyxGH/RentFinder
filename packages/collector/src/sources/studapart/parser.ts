/**
 * Source : Studapart (studapart.com) — plateforme de logement étudiant.
 *
 * ACCÈS CONFORME (vérifié le 2026-08-18). Le HTML de la page ville est en AJAX
 * (aucune fiche dans le source), mais les annonces proviennent d'une API de
 * recherche PUBLIQUE : `POST https://search-api.studapart.com/property` (proxy
 * Elasticsearch). Cet hôte n'a pas de robots.txt ; le site principal autorise
 * le crawler générique en `Content-Signal: search=yes, use=reference` — usage
 * exact de RentFinder, avec un User-Agent honnête (§6, §10).
 *
 * Une seule requête rend jusqu'à 201 biens dédoublonnés pour une ville, avec
 * l'ADRESSE EXACTE, la surface, le loyer charges comprises, le meublé, la
 * colocation, les coordonnées GPS et les photos. Beaucoup d'annonces sont des
 * COLOCATIONS (`rentedByRoom`) : on les marque comme telles pour que le filtre
 * personnel les écarte le cas échéant (§17).
 */

import type { RawListing } from '@rentfinder/shared';
import { compactListing } from '../shared/raw-listing.js';

const SITE_BASE = 'https://www.studapart.com';
export const SEARCH_API_URL = 'https://search-api.studapart.com/property';

/** Nombre maximal de biens dédoublonnés demandés (borne ES `terms`). */
const MAX_RESULTS = 201;

/**
 * Corps de la requête Elasticsearch (via le proxy). On restreint aux index de
 * biens et de résidences, aux annonces en ligne, en location, taguées pour la
 * ville. L'agrégation `distinctProperties` dédoublonne par bien et renvoie une
 * fiche complète par bucket.
 */
export function buildSearchBody(citySlug: string): string {
  return JSON.stringify({
    data: [
      { index: ['search_properties_prod', 'residence_properties_prod'] },
      {
        size: 0,
        body: {
          query: {
            bool: {
              filter: [
                { term: { online: true } },
                { terms: { tags: [`search-${citySlug}`] } },
                { term: { announcementType: 'rental' } },
              ],
            },
          },
          aggs: {
            distinctProperties: {
              terms: { field: 'distinctId', size: MAX_RESULTS },
              aggs: { hit: { top_hits: { size: 1 } } },
            },
          },
        },
      },
    ],
  });
}

/** Forme minimale d'une fiche telle que renvoyée dans un bucket. */
interface StudapartSource {
  readonly reference?: string | number;
  readonly distinctId?: string;
  readonly title?: string;
  readonly description?: string;
  readonly propertyType?: string;
  readonly propertySurface?: number;
  readonly roomsCount?: number;
  readonly isFurnished?: boolean;
  readonly rentedByRoom?: boolean;
  readonly rentWithExpensesAmount?: number;
  readonly address?: string;
  readonly full_address?: string;
  readonly city?: string;
  readonly zipcode?: string;
  readonly geoloc?: { lat?: number; lon?: number };
  readonly canonicalUrls?: { fr?: string };
  readonly media?: unknown;
  readonly availabilities?: { start?: number }[];
}

/** Type français attendu par la normalisation (elle lit surtout le titre). */
const TYPE_FR: Readonly<Record<string, string>> = {
  apartment: 'appartement',
  studio: 'studio',
  house: 'maison',
  room: 'chambre',
  loft: 'loft',
};

/** Extrait les URLs de photos (grand format) du champ `media`. */
function extractImageUrls(media: unknown): string[] {
  let items: unknown = media;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(items)) return [];

  const urls: string[] = [];
  for (const item of items) {
    const finalUrl = (item as { final_url?: unknown }).final_url;
    let parsed: unknown = finalUrl;
    if (typeof finalUrl === 'string') {
      try {
        parsed = JSON.parse(finalUrl);
      } catch {
        parsed = undefined;
      }
    }
    const large = (parsed as { property_images_large?: unknown } | undefined)
      ?.property_images_large;
    if (typeof large === 'string' && large.startsWith('https://') && !urls.includes(large)) {
      urls.push(large);
    }
  }
  return urls;
}

/** Convertit un instant epoch (secondes) en date `AAAA-MM-JJ`, sinon `undefined`. */
function epochToDate(epochSeconds: number | undefined): string | undefined {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) return undefined;
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/** Référence stable + URL de fiche d'une source API. `null` si non identifiable. */
function resolveRefAndUrl(
  source: StudapartSource,
): { reference: string; sourceUrl: string } | null {
  const reference =
    source.reference !== undefined ? String(source.reference) : (source.distinctId ?? '');
  if (reference === '') return null;
  const path =
    source.canonicalUrls?.fr ??
    (source.distinctId !== undefined ? `/fr/property/${source.distinctId}` : null);
  if (path === null) return null;
  return { reference, sourceUrl: `${SITE_BASE}${path}` };
}

/** Transforme une fiche brute de l'API en `RawListing`. `null` si inexploitable. */
function toRawListing(source: StudapartSource): RawListing | null {
  const identity = resolveRefAndUrl(source);
  if (identity === null) return null;
  const { reference, sourceUrl } = identity;

  const typeText = source.propertyType !== undefined ? (TYPE_FR[source.propertyType] ?? '') : '';
  // §17 : une colocation est signalée explicitement, pour que le filtre perso
  // puisse l'écarter (« en colocation » ≠ « colocation possible »).
  const colocationPrefix = source.rentedByRoom === true ? 'En colocation. ' : '';
  const description = `${colocationPrefix}${source.description ?? ''}`.trim();

  const geoloc = source.geoloc;
  const imageUrls = extractImageUrls(source.media);

  return compactListing({
    sourceRef: reference,
    sourceUrl,
    title: source.title,
    description: description !== '' ? description : undefined,
    priceText:
      source.rentWithExpensesAmount !== undefined
        ? `${source.rentWithExpensesAmount} € CC`
        : undefined,
    areaText: source.propertySurface !== undefined ? `${source.propertySurface} m²` : undefined,
    roomsText: source.roomsCount !== undefined ? `${source.roomsCount} pièces` : undefined,
    propertyTypeText: `${typeText} ${source.title ?? ''}`.trim(),
    furnishedText: source.isFurnished === true ? 'meublé' : 'non meublé',
    addressText: (source.full_address ?? source.address) || undefined,
    cityText: source.city,
    postalCodeText: source.zipcode,
    latitude: typeof geoloc?.lat === 'number' ? geoloc.lat : undefined,
    longitude: typeof geoloc?.lon === 'number' ? geoloc.lon : undefined,
    availableAtText: epochToDate(source.availabilities?.[0]?.start),
    agencyName: 'Studapart',
    contactFormUrl: sourceUrl,
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    extra: { reference },
  });
}

export interface ParsedSearch {
  readonly listings: readonly RawListing[];
  readonly warnings: readonly string[];
}

/** Analyse la réponse ES brute (`{responses:[{aggregations:…}]}`). */
export function parseSearchResponse(body: string): ParsedSearch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { listings: [], warnings: ['Réponse Studapart illisible (JSON invalide)'] };
  }

  const buckets = (
    parsed as {
      responses?: {
        aggregations?: { distinctProperties?: { buckets?: unknown[] } };
      }[];
    }
  ).responses?.[0]?.aggregations?.distinctProperties?.buckets;

  if (!Array.isArray(buckets)) {
    return { listings: [], warnings: ['Réponse Studapart sans agrégation attendue'] };
  }

  const listings: RawListing[] = [];
  for (const bucket of buckets) {
    const source = (bucket as { hit?: { hits?: { hits?: { _source?: unknown }[] } } }).hit?.hits
      ?.hits?.[0]?._source;
    if (source === undefined) continue;
    const listing = toRawListing(source as StudapartSource);
    if (listing !== null) listings.push(listing);
  }

  return {
    listings,
    warnings: listings.length === 0 ? ['Aucune annonce Studapart exploitable'] : [],
  };
}
