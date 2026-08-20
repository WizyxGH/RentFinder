import { describe, expect, it } from 'vitest';
import type { RawListing } from '@rentfinder/shared';
import { normalizeListing } from './normalize.js';

const OPTIONS = { sourceId: 'test', nowMs: Date.parse('2026-08-19T12:00:00Z') };

function raw(over: Partial<RawListing>): RawListing {
  return {
    sourceRef: 'ref1',
    sourceUrl: 'https://exemple.fr/location/nice/ref1',
    ...over,
  } as RawListing;
}

describe('normalizeListing — exclusion des ventes (§3)', () => {
  it('garde une location normale', () => {
    const result = normalizeListing(
      raw({ title: 'Appartement à louer 2 pièces', priceText: '700 € / mois' }),
      OPTIONS,
    );
    expect(result).not.toBeNull();
  });

  it('garde une location CHÈRE (loyer élevé, pas une vente)', () => {
    const result = normalizeListing(
      raw({ title: 'Villa à louer avec piscine', priceText: '8500 € / mois' }),
      OPTIONS,
    );
    expect(result).not.toBeNull();
  });

  it('écarte un bien à vendre (URL de vente)', () => {
    const result = normalizeListing(
      raw({ sourceUrl: 'https://exemple.fr/vente/nice/ref9', title: 'Appartement 3 pièces' }),
      OPTIONS,
    );
    expect(result).toBeNull();
  });

  it('écarte un bien à vendre (texte explicite, sans marqueur de location)', () => {
    const result = normalizeListing(
      raw({ title: 'Maison à vendre', description: 'Frais de notaire en sus' }),
      OPTIONS,
    );
    expect(result).toBeNull();
  });

  it('ne se laisse pas piéger : « proche des commerces » n’est pas une vente', () => {
    const result = normalizeListing(
      raw({
        title: 'Studio à louer',
        description: 'Proche des commerces et de la vente à emporter',
      }),
      OPTIONS,
    );
    expect(result).not.toBeNull();
  });
});
