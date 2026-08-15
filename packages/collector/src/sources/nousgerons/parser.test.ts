import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { parseListingUrl, parseSearchPage } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/nousgerons');
const PAGE_URL = 'https://www.nousgerons.com/location/nice';

const nominal = readFileSync(join(FIXTURES, 'nice.html'), 'utf8');

describe('parseListingUrl', () => {
  it('décompose une URL de fiche', () => {
    const parsed = parseListingUrl('https://www.nousgerons.com/logement/location/900200001-nice');
    expect(parsed?.reference).toBe('900200001');
  });

  it('rejette les pages de liste', () => {
    expect(parseListingUrl(PAGE_URL)).toBeNull();
  });
});

describe('parseSearchPage — JSON-LD ItemList', () => {
  const page = parseSearchPage(nominal, PAGE_URL);

  it('extrait les deux annonces sans warning', () => {
    expect(page.listings).toHaveLength(2);
    expect(page.warnings).toHaveLength(0);
  });

  it('extrait la colocation complète', () => {
    const coloc = page.listings.find((l) => l.sourceRef === '900200001');
    expect(coloc?.priceText).toBe('550.00 €');
    expect(coloc?.areaText).toBe('62 m²');
    expect(coloc?.roomsText).toBe('4 pièces');
    expect(coloc?.cityText).toBe('Nice');
  });
});

describe('chaîne complète avec la normalisation', () => {
  const NOW = Date.parse('2026-08-15T12:00:00.000Z');
  const page = parseSearchPage(nominal, PAGE_URL);

  it('marque la colocation comme flatShare=true (§17)', () => {
    const coloc = page.listings.find((l) => l.sourceRef === '900200001');
    if (coloc === undefined) throw new Error('coloc absente');
    const normalized = normalizeListing(coloc, { sourceId: 'nousgerons', nowMs: NOW });
    expect(normalized?.price).toBe(550);
    expect(normalized?.area).toBe(62);
    expect(normalized?.flatShare).toBe(true);
  });

  it('laisse flatShare inconnu pour le studio classique', () => {
    const studio = page.listings.find((l) => l.sourceRef === '900200002');
    if (studio === undefined) throw new Error('studio absent');
    const normalized = normalizeListing(studio, { sourceId: 'nousgerons', nowMs: NOW });
    expect(normalized?.price).toBe(620);
    expect(normalized?.flatShare).toBeNull();
    expect(normalized?.furnished).toBe(true);
    expect(normalized?.propertyType).toBe('studio');
  });
});
