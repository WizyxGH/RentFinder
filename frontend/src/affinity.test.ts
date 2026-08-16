import { describe, expect, it } from 'vitest';
import type { ListingView } from './types.js';
import { computeAffinity } from './affinity.js';

/** Fabrique une annonce minimale pour les tests d'affinité. */
function listing(over: Partial<ListingView> & { id: string }): ListingView {
  const field = <T>(value: T) => ({ value, source: 'test', conflicts: [] });
  return {
    id: over.id,
    title: field('Annonce'),
    description: field(null),
    price: field(over.price?.value ?? 600),
    charges: field(null),
    area: field(30),
    rooms: field(over.rooms?.value ?? 2),
    propertyType: field(over.propertyType?.value ?? 'apartment'),
    furnished: field(null),
    flatShare: field(null),
    dpe: field(over.dpe?.value ?? null),
    features: over.features ?? [],
    address: field(null),
    city: field('nice'),
    postalCode: field(null),
    latitude: field(null),
    longitude: field(null),
    availableAt: field(null),
    views: field(null),
    favorites: field(null),
    contact: {
      name: null,
      phone: null,
      email: null,
      formUrl: null,
      agency: null,
      reference: null,
      kind: 'unknown',
      providedBy: {},
    },
    imageUrls: [],
    scores: {
      match: { value: 50, reasons: [], unknownSignals: [], confidence: 1 },
      opportunity: { value: 50, reasons: [], unknownSignals: [], confidence: 1 },
      visitProbability: { value: 50, reasons: [], unknownSignals: [], confidence: 1 },
      risk: { value: 0, reasons: [], unknownSignals: [], confidence: 1 },
    },
    distances: [],
    occurrences: [],
    matchesCriteria: true,
    actionPriority: 50,
    tracking: over.tracking ?? 'new',
    viewed: over.viewed,
    archived: over.archived,
    lifecycle: 'active',
    firstSeenAt: '2026-08-16T00:00:00.000Z',
    lastSeenAt: '2026-08-16T00:00:00.000Z',
  } as unknown as ListingView;
}

describe('computeAffinity', () => {
  it('reste inactif sans assez de signal (< 2 annonces appréciées)', () => {
    const result = computeAffinity([listing({ id: 'a', viewed: true }), listing({ id: 'b' })]);
    expect(result.active).toBe(false);
    expect(result.scores.get('b')).toBe(0);
  });

  it('remonte les annonces qui ressemblent à celles appréciées', () => {
    // Deux annonces suivies : studios avec balcon. Une candidate identique doit
    // scorer plus haut qu'une candidate très différente.
    const result = computeAffinity([
      listing({
        id: 'liked1',
        tracking: 'contacted',
        propertyType: { value: 'studio' } as never,
        features: ['Balcon'],
      }),
      listing({
        id: 'liked2',
        tracking: 'visitScheduled',
        propertyType: { value: 'studio' } as never,
        features: ['Balcon'],
      }),
      listing({ id: 'similar', propertyType: { value: 'studio' } as never, features: ['Balcon'] }),
      listing({ id: 'different', propertyType: { value: 'house' } as never, features: [] }),
    ]);
    expect(result.active).toBe(true);
    const similar = result.scores.get('similar') ?? 0;
    const different = result.scores.get('different') ?? 0;
    expect(similar).toBeGreaterThan(different);
  });

  it('ne laisse pas les archivées booster le profil', () => {
    // Une seule vraie appréciation + une archivée : signal insuffisant.
    const result = computeAffinity([
      listing({ id: 'liked', tracking: 'contacted' }),
      listing({ id: 'trashed', archived: true, features: ['Piscine'] }),
      listing({ id: 'candidate', features: ['Piscine'] }),
    ]);
    // 1 seule appréciée → inactif.
    expect(result.active).toBe(false);
  });
});
