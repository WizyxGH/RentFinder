import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { extractDpe, parseListingUrl, parseSearchPage } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/pap');
const PAGE_URL = 'https://www.pap.fr/annonce/locations-nice-06-g8979';

const nominal = readFileSync(join(FIXTURES, 'nice-page1.html'), 'utf8');

describe('parseListingUrl', () => {
  it('décompose une URL de fiche', () => {
    const parsed = parseListingUrl('https://www.pap.fr/annonces/appartement-nice-06000-r900000001');
    expect(parsed?.reference).toBe('900000001');
    expect(parsed?.slug).toBe('appartement-nice-06000');
  });

  it('rejette les pages de liste et les ancres', () => {
    expect(parseListingUrl('https://www.pap.fr/annonce/locations-nice-06-g8979')).toBeNull();
    expect(parseListingUrl('https://www.pap.fr/annonces/')).toBeNull();
  });
});

describe('extractDpe', () => {
  it('lit la classe DPE', () => {
    expect(extractDpe('item-thumb-dpe item-thumb-dpe-c')).toBe('C');
    expect(extractDpe('item-thumb-dpe')).toBeUndefined();
    expect(extractDpe(undefined)).toBeUndefined();
  });
});

describe('parseSearchPage — fixture nominale', () => {
  const page = parseSearchPage(nominal, PAGE_URL);

  it('extrait les trois annonces sans warning', () => {
    expect(page.listings).toHaveLength(3);
    expect(page.warnings).toHaveLength(0);
  });

  it('détecte la pagination suffixée', () => {
    expect(page.hasNextPage).toBe(true);
  });

  it('extrait le studio complet', () => {
    const studio = page.listings.find((l) => l.sourceRef === '900000001');
    expect(studio?.priceText).toBe('690 €');
    expect(studio?.areaText).toBe('16 m²');
    expect(studio?.cityText).toBe('Nice');
    expect(studio?.postalCodeText).toBe('06000');
    expect(studio?.extra?.['dpe']).toBe('C');
    expect(studio?.contactFormUrl).toBe(
      'https://www.pap.fr/annonces/appartement-nice-06000-r900000001',
    );
  });

  it('omet le prix illisible (« Nous consulter ») plutôt que de deviner (§17)', () => {
    const noPrice = page.listings.find((l) => l.sourceRef === '900000003');
    expect(noPrice?.priceText).toBeUndefined();
    expect(noPrice?.roomsText).toContain('2 pièces');
  });
});

describe('parseSearchPage — chaîne complète avec la normalisation', () => {
  const NOW = Date.parse('2026-08-15T12:00:00.000Z');
  const page = parseSearchPage(nominal, PAGE_URL);

  it('type le prix à séparateur de milliers « 1.750 € » en 1750 (§51)', () => {
    const family = page.listings.find((l) => l.sourceRef === '900000002');
    if (family === undefined) throw new Error('annonce absente');
    const normalized = normalizeListing(family, { sourceId: 'pap', nowMs: NOW });
    expect(normalized?.price).toBe(1750);
    expect(normalized?.area).toBe(80);
    expect(normalized?.rooms).toBe(4);
    expect(normalized?.bedrooms).toBe(3);
  });

  it('produit un studio meublé dans les critères', () => {
    const studio = page.listings.find((l) => l.sourceRef === '900000001');
    if (studio === undefined) throw new Error('studio absent');
    const normalized = normalizeListing(studio, { sourceId: 'pap', nowMs: NOW });
    expect(normalized?.price).toBe(690);
    // « charges comprises » n'apparaît que dans la description, pas dans le
    // texte du prix : la normalisation le laisse honnêtement inconnu (§17).
    expect(normalized?.chargesIncluded).toBeNull();
    expect(normalized?.area).toBe(16);
    expect(normalized?.city).toBe('nice');
    expect(normalized?.furnished).toBe(true);
    expect(normalized?.contact.phone).toBeNull();
  });
});
