import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { buildSearchBody, parseSearchResponse } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/studapart');
const search = readFileSync(join(FIXTURES, 'search.json'), 'utf8');

describe('buildSearchBody', () => {
  it('produit un corps JSON valide, tagué pour la commune', () => {
    const body = buildSearchBody('nice');
    const parsed = JSON.parse(body) as { data: [unknown, { body: { query: unknown } }] };
    expect(JSON.stringify(parsed)).toContain('search-nice');
    expect(JSON.stringify(parsed)).toContain('announcementType');
    // Doit rester du JSON strictement valide (pas d'accolade manquante).
    expect(() => JSON.parse(body)).not.toThrow();
  });
});

describe('parseSearchResponse', () => {
  const { listings, warnings } = parseSearchResponse(search);

  it('extrait les fiches de l’agrégation, sans warning', () => {
    expect(warnings).toHaveLength(0);
    expect(listings.length).toBe(2);
  });

  it('mappe adresse, loyer CC, surface et URL de fiche', () => {
    const listing = listings.find((l) => l.sourceRef === '140526');
    expect(listing).toBeDefined();
    expect(listing?.sourceUrl).toMatch(/^https:\/\/www\.studapart\.com\/fr\//);
    expect(listing?.priceText).toContain('CC');
    expect(listing?.addressText).toMatch(/Nice/);
    expect(listing?.imageUrls?.[0]).toMatch(/^https:\/\/media\.studapart\.com\//);
  });

  it('marque explicitement les colocations (§17)', () => {
    const coloc = listings.find((l) => l.sourceRef === '153641');
    expect(coloc?.description ?? '').toMatch(/colocation/i);
  });

  it('se normalise : colocation détectée, loyer charges comprises', () => {
    const coloc = listings.find((l) => l.sourceRef === '153641');
    const normalized = normalizeListing(coloc as NonNullable<typeof coloc>, {
      sourceId: 'studapart',
      nowMs: Date.parse('2026-08-18T12:00:00Z'),
    });
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    expect(normalized.flatShare).toBe(true);
    expect(normalized.chargesIncluded).toBe(true);
    expect(normalized.city).toBe('nice');
  });

  it('tolère une réponse vide ou malformée sans lever', () => {
    expect(parseSearchResponse('pas du json').listings).toHaveLength(0);
    expect(parseSearchResponse('{"responses":[]}').warnings.length).toBeGreaterThan(0);
  });
});
