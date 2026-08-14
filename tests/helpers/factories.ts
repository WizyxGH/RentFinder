/**
 * Fabriques de données de test.
 *
 * Toutes les valeurs sont FICTIVES (§26) : domaine `example.invalid` réservé
 * par la RFC 2606, numéros dans la plage `06 00 00 00 xx`, noms inventés.
 *
 * Ces fabriques produisent des objets valides par défaut ; chaque test ne
 * surcharge que le champ qu'il exerce, ce qui garde les tests lisibles et
 * résistants à l'ajout de nouveaux champs au modèle.
 */

import type {
  AggregatedListing,
  Contact,
  MergedField,
  NormalizedListing,
  PropertyType,
} from '@rentfinder/shared';
import { EMPTY_CONTACT, merged } from '@rentfinder/shared';

export const TEST_NOW = Date.parse('2026-08-14T12:00:00.000Z');
export const TEST_NOW_ISO = new Date(TEST_NOW).toISOString();

/** Occurrence normalisée, telle qu'elle sort de la normalisation. */
export function makeOccurrence(
  overrides: Partial<NormalizedListing> & { id: string; sourceId: string },
): NormalizedListing {
  return {
    sourceRef: overrides.id.split(':')[1] ?? overrides.id,
    sourceUrl: `https://${overrides.sourceId}.example.invalid/annonce/${overrides.id}`,
    title: 'Appartement T2 lumineux',
    description: 'Bel appartement rénové, proche commerces.',
    price: 690,
    charges: null,
    chargesIncluded: null,
    area: 34,
    rooms: 2,
    bedrooms: 1,
    propertyType: 'apartment',
    furnished: null,
    address: null,
    city: 'nice',
    postalCode: '06000',
    latitude: null,
    longitude: null,
    contact: { ...EMPTY_CONTACT },
    publishedAt: null,
    availableAt: null,
    imageUrls: [],
    views: null,
    favorites: null,
    firstSeenAt: TEST_NOW_ISO,
    lastSeenAt: TEST_NOW_ISO,
    scrapedAt: TEST_NOW_ISO,
    lifecycle: 'active',
    ...overrides,
  };
}

/** Contact fictif complet. */
export function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    ...EMPTY_CONTACT,
    name: 'Camille Martin',
    agencyName: 'Agence Fictive',
    phone: '+33600000012',
    email: 'contact@example.invalid',
    formUrl: null,
    reference: 'REF-FICTIVE-1',
    kind: 'agency',
    providedBy: ['test'],
    ...overrides,
  };
}

/** Raccourci pour un champ fusionné sans conflit. */
const field = <T>(value: T, sourceId = 'test'): MergedField<T> =>
  merged(value, sourceId, TEST_NOW_ISO);

export interface AggregatedOverrides {
  readonly id?: string;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly price?: number | null;
  readonly charges?: number | null;
  readonly area?: number | null;
  readonly rooms?: number | null;
  readonly propertyType?: PropertyType;
  readonly furnished?: boolean | null;
  readonly city?: string | null;
  readonly postalCode?: string | null;
  readonly address?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly publishedAt?: string | null;
  readonly views?: number | null;
  readonly favorites?: number | null;
  readonly contact?: Contact;
  readonly occurrences?: readonly NormalizedListing[];
  readonly firstSeenAt?: string;
  readonly lifecycle?: AggregatedListing['lifecycle'];
}

/** Logement agrégé, tel qu'il entre dans le moteur de scoring. */
export function makeAggregated(overrides: AggregatedOverrides = {}): AggregatedListing {
  const id = overrides.id ?? 'test:1';
  const occurrences = overrides.occurrences ?? [makeOccurrence({ id, sourceId: 'test' })];

  return {
    id,
    title: field(overrides.title ?? 'Appartement T2 lumineux'),
    description: field(overrides.description ?? 'Bel appartement rénové, proche commerces.'),
    price: field(overrides.price === undefined ? 690 : overrides.price),
    charges: field(overrides.charges ?? null),
    area: field(overrides.area === undefined ? 34 : overrides.area),
    rooms: field(overrides.rooms === undefined ? 2 : overrides.rooms),
    propertyType: field(overrides.propertyType ?? 'apartment'),
    furnished: field(overrides.furnished ?? null),
    address: field(overrides.address ?? null),
    city: field(overrides.city === undefined ? 'nice' : overrides.city),
    postalCode: field(overrides.postalCode ?? '06000'),
    latitude: field(overrides.latitude ?? null),
    longitude: field(overrides.longitude ?? null),
    contact: overrides.contact ?? { ...EMPTY_CONTACT },
    publishedAt: field(overrides.publishedAt ?? null),
    availableAt: field(null),
    imageUrls: [],
    views: field(overrides.views ?? null),
    favorites: field(overrides.favorites ?? null),
    occurrences,
    firstSeenAt: overrides.firstSeenAt ?? TEST_NOW_ISO,
    lastSeenAt: TEST_NOW_ISO,
    lifecycle: overrides.lifecycle ?? 'active',
    tracking: 'new',
  };
}

/** Instant situé `minutes` avant `TEST_NOW`, au format ISO. */
export const minutesBefore = (minutes: number): string =>
  new Date(TEST_NOW - minutes * 60_000).toISOString();
