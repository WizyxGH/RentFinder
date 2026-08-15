/**
 * Tests de performance (§56) — détecter les régressions grossières, sans
 * micro-optimiser. Les seuils sont larges (machine de CI lente comprise) :
 * ils n'attrapent qu'un retour accidentel à un comportement O(n²).
 */

import { describe, expect, it } from 'vitest';
import type { NormalizedListing } from '@rentfinder/shared';
import { dedupe } from '../../packages/collector/src/deduplication/dedupe.js';
import { makeOccurrence } from '../helpers/factories.js';

/** Corpus synthétique varié : prix, surfaces et villes dispersés. */
function corpus(size: number): NormalizedListing[] {
  return Array.from({ length: size }, (_, index) =>
    makeOccurrence({
      id: `perf:${index}`,
      sourceId: index % 2 === 0 ? 'a' : 'b',
      price: 400 + (index % 90) * 10,
      area: 10 + (index % 70),
      rooms: 1 + (index % 4),
      city: index % 5 === 0 ? 'cagnes sur mer' : 'nice',
      postalCode: `0600${index % 10}`,
    }),
  );
}

describe('dédoublonnage — performance (§56)', () => {
  it('traite 2 000 occurrences en moins de 3 secondes', () => {
    const listings = corpus(2_000);

    const startedAt = performance.now();
    const result = dedupe(listings);
    const elapsedMs = performance.now() - startedAt;

    expect(result.groups.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(3_000);

    // Le blocage doit limiter le nombre de comparaisons réelles très en deçà
    // du produit cartésien (2 000² = 4 000 000).
    expect(result.comparisonCount).toBeLessThan(400_000);
  });
});
