import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { extractAddress, parseListingUrl, parseSearchPage } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/foncia');
const PAGE_URL = 'https://fr.foncia.com/location/nice-06000/appartement';

const nominal = readFileSync(join(FIXTURES, 'nice-page1.html'), 'utf8');

describe('parseListingUrl', () => {
  it('décompose une URL de fiche', () => {
    const parsed = parseListingUrl(
      'https://fr.foncia.com/location/nice-06/appartement/900100001.htm',
    );
    expect(parsed?.reference).toBe('900100001');
    expect(parsed?.citySlug).toBe('nice-06');
  });

  it('rejette les pages de liste', () => {
    expect(parseListingUrl('https://fr.foncia.com/location/nice-06000/appartement')).toBeNull();
  });
});

describe('extractAddress', () => {
  it("isole l'adresse entre le tiret et « Ville CP »", () => {
    expect(
      extractAddress('Location Appartement 2 pièces 40.1 m² - 260 BOULEVARD FICTIF Nice 06200'),
    ).toBe('260 BOULEVARD FICTIF');
  });

  it('rend undefined sans tiret séparateur', () => {
    expect(extractAddress('Location Appartement 2 pièces')).toBeUndefined();
  });
});

describe('parseSearchPage — fixture nominale', () => {
  const page = parseSearchPage(nominal, PAGE_URL);

  it('extrait les trois cartes sans warning', () => {
    expect(page.listings).toHaveLength(3);
    expect(page.warnings).toHaveLength(0);
  });

  it("n'annonce jamais de page suivante (pagination interdite par robots.txt)", () => {
    expect(page.hasNextPage).toBe(false);
  });

  it("extrait l'annonce complète avec adresse et DPE", () => {
    const listing = page.listings.find((l) => l.sourceRef === '900100001');
    // cheerio concatène <span> et <sup> sans espace — sans incidence métier.
    expect(listing?.priceText).toBe('795 €/ mois CC');
    expect(listing?.areaText).toBe('40,1 m²');
    expect(listing?.roomsText).toBe('2 pièces');
    expect(listing?.addressText).toBe('260 BOULEVARD FICTIF');
    expect(listing?.cityText).toBe('NICE');
    expect(listing?.postalCodeText).toBe('06200');
    expect(listing?.extra?.['dpe']).toBe('C');
  });

  it('omet le prix absent plutôt que de deviner (§17)', () => {
    const noPrice = page.listings.find((l) => l.sourceRef === '900100003');
    expect(noPrice?.priceText).toBeUndefined();
  });
});

describe('parseSearchPage — chaîne complète avec la normalisation', () => {
  const NOW = Date.parse('2026-08-15T12:00:00.000Z');
  const page = parseSearchPage(nominal, PAGE_URL);

  it('lit « 795 € / mois CC » comme charges comprises', () => {
    const listing = page.listings.find((l) => l.sourceRef === '900100001');
    if (listing === undefined) throw new Error('annonce absente');
    const normalized = normalizeListing(listing, { sourceId: 'foncia', nowMs: NOW });
    expect(normalized?.price).toBe(795);
    expect(normalized?.chargesIncluded).toBe(true);
    expect(normalized?.area).toBe(40.1);
    expect(normalized?.address).toBe('260 BOULEVARD FICTIF');
    expect(normalized?.city).toBe('nice');
  });

  it('produit un studio meublé dans les critères', () => {
    const studio = page.listings.find((l) => l.sourceRef === '900100002');
    if (studio === undefined) throw new Error('studio absent');
    const normalized = normalizeListing(studio, { sourceId: 'foncia', nowMs: NOW });
    expect(normalized?.price).toBe(640);
    expect(normalized?.area).toBe(15);
    expect(normalized?.furnished).toBe(true);
    expect(normalized?.propertyType).toBe('studio');
  });
});
