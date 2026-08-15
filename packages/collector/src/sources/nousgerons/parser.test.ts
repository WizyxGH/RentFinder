import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { parseDetailPage, parseListingUrl, parseSearchPage } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/nousgerons');
const PAGE_URL = 'https://www.nousgerons.com/location/nice';
const DETAIL_URL = 'https://www.nousgerons.com/logement/location/900200001-nice';

const nominal = readFileSync(join(FIXTURES, 'nice.html'), 'utf8');
const detail = readFileSync(join(FIXTURES, 'detail-900200001.html'), 'utf8');

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

  it('extrait la colocation complète, adresse comprise', () => {
    const coloc = page.listings.find((l) => l.sourceRef === '900200001');
    expect(coloc?.priceText).toBe('550.00 €');
    expect(coloc?.areaText).toBe('62 m²');
    expect(coloc?.roomsText).toBe('4 pièces');
    expect(coloc?.cityText).toBe('Nice');
    // L'adresse est dans le titre : « … – Bd Fictif – Nice (06100) – … ».
    expect(coloc?.addressText).toBe('Bd Fictif');
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

describe('parseDetailPage — enrichissement par la fiche', () => {
  const NOW = Date.parse('2026-08-15T12:00:00.000Z');
  const { listing, warnings } = parseDetailPage(detail, DETAIL_URL);

  it('récupère les informations riches absentes de la liste', () => {
    expect(warnings).toHaveLength(0);
    expect(listing).not.toBeNull();
    expect(listing?.addressText).toBe('42 Bd Fictif');
    expect(listing?.postalCodeText).toBe('06000');
    expect(listing?.chargesText).toContain('50');
  });

  it('normalise loyer, charges et adresse exacte', () => {
    if (listing === null) throw new Error('fiche absente');
    const normalized = normalizeListing(listing, { sourceId: 'nousgerons', nowMs: NOW });
    expect(normalized?.price).toBe(550);
    expect(normalized?.charges).toBe(50);
    expect(normalized?.area).toBe(62);
    expect(normalized?.address).toBe('42 Bd Fictif');
    expect(normalized?.postalCode).toBe('06000');
    expect(normalized?.flatShare).toBe(true);
  });
});
