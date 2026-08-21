import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { isTargetListing, parseDetailPage, parseListingUrl, parseListPage } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/inli');
const LIST_URL = 'https://www.inli.fr/locations/offres/';
const DETAIL_URL = 'https://www.inli.fr/location-appartement-nice-06300/IPA-000435';

const detail = readFileSync(join(FIXTURES, 'detail.html'), 'utf8');

describe('parseListingUrl / isTargetListing', () => {
  it('décompose une fiche : type, ville, code postal, référence', () => {
    const parsed = parseListingUrl(DETAIL_URL, LIST_URL);
    expect(parsed?.reference).toBe('IPA-000435');
    expect(parsed?.propertyType).toBe('appartement');
    expect(parsed?.citySlug).toBe('nice');
    expect(parsed?.postalCode).toBe('06300');
  });

  it('décompose une ville composée et une réf non standard', () => {
    const slv = parseListingUrl(
      '/location-appartement-st-laurent-du-var-06700/IPA-016692',
      LIST_URL,
    );
    expect(slv?.citySlug).toBe('st-laurent-du-var');
    expect(slv?.postalCode).toBe('06700');
    const num = parseListingUrl('/location-appartement-clamart-92140/409-40003-3043', LIST_URL);
    expect(num?.reference).toBe('409-40003-3043');
  });

  it('ne cible que Nice (exclut les autres communes du 06)', () => {
    const nice = parseListingUrl(DETAIL_URL, LIST_URL);
    const cannet = parseListingUrl('/location-appartement-le-cannet-06110/IPA-005221', LIST_URL);
    expect(nice !== null && isTargetListing(nice)).toBe(true);
    expect(cannet !== null && isTargetListing(cannet)).toBe(false);
  });

  it('ignore les pages hors fiche', () => {
    expect(parseListingUrl('/locations/offres/?page=2', LIST_URL)).toBeNull();
    expect(parseListingUrl('/cgu', LIST_URL)).toBeNull();
  });
});

describe('parseListPage', () => {
  it('extrait les fiches et détecte le nombre de pages', () => {
    const html = `
      <a href="/location-appartement-nice-06300/IPA-000435">a</a>
      <a href="/location-appartement-le-cannet-06110/IPA-005221">b</a>
      <a href="/location-appartement-nice-06300/IPA-000435">dup</a>
      <a href="/locations/offres/?page=2">p2</a>
      <a href="/locations/offres/?page=22">p22</a>`;
    const { urls, lastPage } = parseListPage(html, LIST_URL);
    expect(urls.map((u) => u.reference).sort()).toEqual(['IPA-000435', 'IPA-005221']);
    expect(lastPage).toBe(22);
  });
});

describe('parseDetailPage', () => {
  const { listing, warnings } = parseDetailPage(detail, DETAIL_URL, "In'li");

  it('lit loyer CC, charges, surface, pièces, ville/CP, photos', () => {
    expect(warnings).toHaveLength(0);
    expect(listing?.sourceRef).toBe('IPA-000435');
    expect(listing?.priceText).toContain('656');
    expect(listing?.priceText).toContain('CC');
    expect(listing?.chargesText).toContain('121');
    expect(listing?.areaText).toBe('55.5 m²');
    expect(listing?.roomsText).toBe('3 pièces');
    expect(listing?.cityText).toBe('nice');
    expect(listing?.postalCodeText).toBe('06300');
    expect((listing?.imageUrls ?? []).length).toBeGreaterThan(0);
    expect(listing?.extra?.['priceControlled']).toContain('prix maîtrisé');
  });

  it('se normalise : loyer CC 656, surface 55.5, 3 pièces, Nice', () => {
    const normalized = normalizeListing(listing as NonNullable<typeof listing>, {
      sourceId: 'inli',
      nowMs: Date.parse('2026-08-21T12:00:00Z'),
    });
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    expect(normalized.price).toBe(656);
    expect(normalized.chargesIncluded).toBe(true);
    expect(normalized.area).toBe(55.5);
    expect(normalized.rooms).toBe(3);
    expect(normalized.city).toBe('nice');
  });
});
