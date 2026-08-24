import { describe, expect, it } from 'vitest';
import type { RawListing } from '@rentfinder/shared';
import { dedupeStreetAddress, normalizeListing } from './normalize.js';

describe('district (quartier)', () => {
  it('reprend le quartier de extra.quartier (ex. Orpi)', () => {
    const n = normalizeListing(
      raw({ cityText: 'nice', extra: { reference: 'r1', quartier: 'Madeleine' } }),
      OPTIONS,
    );
    expect(n?.district).toBe('Madeleine');
  });

  it('district null quand la source ne publie pas de quartier', () => {
    const n = normalizeListing(raw({ cityText: 'nice' }), OPTIONS);
    expect(n?.district).toBeNull();
  });
});

describe('dedupeStreetAddress — voie saisie en double par la source', () => {
  it('supprime la voie répétée et garde le numéro', () => {
    expect(dedupeStreetAddress('Rue Edouard Scoffier 28 Rue Edouard Scoffier')).toBe(
      '28 Rue Edouard Scoffier',
    );
  });

  it('laisse une adresse normale intacte', () => {
    expect(dedupeStreetAddress('28 Rue Edouard Scoffier')).toBe('28 Rue Edouard Scoffier');
    expect(dedupeStreetAddress('12 Avenue de la Californie')).toBe('12 Avenue de la Californie');
  });

  it('ne fusionne pas deux voies distinctes', () => {
    expect(dedupeStreetAddress('Avenue de la Gare 12 Boulevard Victor Hugo')).toBe(
      'Avenue de la Gare 12 Boulevard Victor Hugo',
    );
  });

  it('gère null', () => {
    expect(dedupeStreetAddress(null)).toBeNull();
  });
});

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
