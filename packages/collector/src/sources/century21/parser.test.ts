import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { parseListingUrl, parseSearchPage } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/century21');
const PAGE_URL = 'https://www.century21.fr/annonces/location-appartement/v-nice/';

const nominal = readFileSync(join(FIXTURES, 'nice-page1.html'), 'utf8');

describe('parseListingUrl', () => {
  it('décompose une URL de fiche', () => {
    const parsed = parseListingUrl('https://www.century21.fr/trouver_logement/detail/16000000001/');
    expect(parsed?.reference).toBe('16000000001');
  });

  it('rejette les autres pages', () => {
    expect(parseListingUrl(PAGE_URL)).toBeNull();
  });
});

describe('parseSearchPage — fixture nominale', () => {
  const page = parseSearchPage(nominal, PAGE_URL);

  it('extrait les trois cartes sans warning ni pagination', () => {
    expect(page.listings).toHaveLength(3);
    expect(page.warnings).toHaveLength(0);
    expect(page.hasNextPage).toBe(false);
  });

  it('extrait la carte complète (prix, surface, pièces, réf agence, ville)', () => {
    const f3 = page.listings.find((l) => l.sourceRef === '16000000001');
    expect(f3?.priceText).toContain('3 000 € par mois charges comprises');
    expect(f3?.areaText).toBe('78,27 m2');
    expect(f3?.roomsText).toBe('3 pièces');
    expect(f3?.cityText).toBe('NICE');
    expect(f3?.extra?.['agencyRef']).toBe('90001');
  });

  it('omet les champs absents (§17)', () => {
    const bare = page.listings.find((l) => l.sourceRef === '16000000003');
    expect(bare?.priceText).toBeUndefined();
    expect(bare?.areaText).toBeUndefined();
  });
});

describe('chaîne complète avec la normalisation', () => {
  const NOW = Date.parse('2026-08-15T12:00:00.000Z');
  const page = parseSearchPage(nominal, PAGE_URL);

  it('produit un studio meublé charges comprises dans les critères', () => {
    const studio = page.listings.find((l) => l.sourceRef === '16000000002');
    if (studio === undefined) throw new Error('studio absent');
    const normalized = normalizeListing(studio, { sourceId: 'century21', nowMs: NOW });
    expect(normalized?.price).toBe(660);
    expect(normalized?.chargesIncluded).toBe(true);
    expect(normalized?.area).toBe(18);
    expect(normalized?.city).toBe('nice');
    expect(normalized?.furnished).toBe(true);
    expect(normalized?.contact.reference).not.toBeNull();
  });
});
