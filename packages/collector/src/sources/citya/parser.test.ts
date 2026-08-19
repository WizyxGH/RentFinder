import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { parseDetailPage, parseListingUrl, parseListPage } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/citya');
const BASE = 'https://www.citya.com/annonces/location/appartement/nice-06088';
const DETAIL_URL = 'https://www.citya.com/annonces/location/appartement/nice-06088/GES12345678-53';

const liste = readFileSync(join(FIXTURES, 'liste.html'), 'utf8');
const detail = readFileSync(join(FIXTURES, 'detail.html'), 'utf8');

describe('parseListingUrl', () => {
  it('décompose une fiche et rejette les pages de catégorie', () => {
    const fiche = parseListingUrl(DETAIL_URL, BASE);
    expect(fiche?.reference).toBe('GES12345678-53');
    expect(fiche?.typeSlug).toBe('appartement');
    expect(fiche?.citySlug).toBe('nice-06088');

    // Page de catégorie (pas de réf) ou paramètre → non.
    expect(parseListingUrl('/annonces/location/appartement/nice-06088', BASE)).toBeNull();
    expect(
      parseListingUrl('/annonces/location/appartement/nice-06088?carte=true', BASE),
    ).toBeNull();
  });
});

describe('parseListPage', () => {
  it('extrait les fiches résidentielles, dédoublonnées, sans parking', () => {
    const { urls } = parseListPage(liste, BASE);
    // T3 + Maison (le parking et les pages de catégorie sont écartés).
    expect(urls.map((u) => u.reference).sort()).toEqual(['GES12345678-53', 'GES99999999-10']);
  });
});

describe('parseDetailPage', () => {
  const { listing, warnings } = parseDetailPage(detail, DETAIL_URL, 'Citya Immobilier');

  it('extrait prix, surface, pièces, CP et photos depuis le JSON-LD', () => {
    expect(warnings).toHaveLength(0);
    expect(listing?.sourceRef).toBe('GES12345678-53');
    expect(listing?.priceText).toBe('890 €');
    expect(listing?.areaText).toBe('54.25m²');
    expect(listing?.roomsText).toBe('3 pièces');
    expect(listing?.postalCodeText).toBe('06100');
    expect(listing?.imageUrls).toHaveLength(2);
  });

  it('se normalise dans les critères de Nice', () => {
    const normalized = normalizeListing(listing as NonNullable<typeof listing>, {
      sourceId: 'citya',
      nowMs: Date.parse('2026-08-19T12:00:00Z'),
    });
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    expect(normalized.price).toBe(890);
    expect(normalized.area).toBe(54.25);
    expect(normalized.rooms).toBe(3);
    expect(normalized.city).toBe('nice');
    expect(normalized.postalCode).toBe('06100');
    expect(normalized.propertyType).toBe('apartment');
  });
});
