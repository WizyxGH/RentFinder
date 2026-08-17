import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { parseDetailPage, parseListingUrl, parseSitemap } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/lamy');
const DETAIL_URL =
  'https://www.lamy-immobilier.fr/louer/louer-un-bien/annonces-de-biens-a-louer/' +
  'provence-alpes-cote-d-azur/alpes-maritimes-06/nice-06200/appartement-nice-06200-fl0000001';

const sitemap = readFileSync(join(FIXTURES, 'sitemap.xml'), 'utf8');
const detail = readFileSync(join(FIXTURES, 'detail-fl0000001.html'), 'utf8');

describe('parseListingUrl', () => {
  it('décompose une URL de fiche de location', () => {
    const parsed = parseListingUrl(DETAIL_URL);
    expect(parsed?.reference).toBe('fl0000001');
    expect(parsed?.citySlug).toBe('nice');
    expect(parsed?.postalCode).toBe('06200');
  });

  it('rejette les pages de ville et les ventes', () => {
    expect(
      parseListingUrl(
        'https://www.lamy-immobilier.fr/louer/louer-un-bien/annonces-de-biens-a-louer/' +
          'provence-alpes-cote-d-azur/alpes-maritimes-06/nice-06200',
      ),
    ).toBeNull();
    expect(
      parseListingUrl(
        'https://www.lamy-immobilier.fr/acheter/acheter-un-bien/annonces-de-biens-a-vendre/' +
          'provence-alpes-cote-d-azur/alpes-maritimes-06/nice-06000/appartement-nice-06000-fv0000009',
      ),
    ).toBeNull();
  });

  it('gère les slugs de ville composés', () => {
    const parsed = parseListingUrl(
      'https://www.lamy-immobilier.fr/louer/louer-un-bien/annonces-de-biens-a-louer/' +
        'provence-alpes-cote-d-azur/alpes-maritimes-06/cagnes-sur-mer-06800/' +
        'appartement-cagnes-sur-mer-06800-fl0000042',
    );
    expect(parsed?.citySlug).toBe('cagnes-sur-mer');
    expect(parsed?.reference).toBe('fl0000042');
  });
});

describe('parseSitemap', () => {
  it('ne retient que les fiches de location, avec leur lastmod', () => {
    const entries = parseSitemap(sitemap);
    expect(entries.map((entry) => entry.url.reference).sort()).toEqual([
      'fl0000001',
      'fl0000002',
      'fl0000003',
    ]);
    expect(entries[0]?.lastmod).toBe('2026-08-15');
  });
});

describe('parseDetailPage', () => {
  const { listing, warnings } = parseDetailPage(detail, DETAIL_URL);

  it('extrait la fiche complète sans warning', () => {
    expect(warnings).toHaveLength(0);
    expect(listing).not.toBeNull();
    expect(listing?.sourceRef).toBe('fl0000001');
    expect(listing?.priceText).toContain('1 230 €');
    expect(listing?.priceText).toContain('CC');
    expect(listing?.areaText).toBe('59m²');
    expect(listing?.roomsText).toBe('3 pièces');
    expect(listing?.propertyTypeText).toBe('Appartement');
    expect(listing?.cityText).toBe('Nice');
    expect(listing?.postalCodeText).toBe('06200');
    expect(listing?.extra?.['dpe']).toBe('E');
    expect(listing?.description).toContain('meublé');
  });

  it('se normalise en annonce exploitable', () => {
    const normalized = normalizeListing(listing as NonNullable<typeof listing>, {
      sourceId: 'lamy',
      nowMs: Date.parse('2026-08-17T12:00:00Z'),
    });
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    expect(normalized.price).toBe(1230);
    expect(normalized.area).toBe(59);
    expect(normalized.rooms).toBe(3);
    expect(normalized.propertyType).toBe('apartment');
    expect(normalized.dpe).toBe('E');
    expect(normalized.furnished).toBe(true);
    expect(normalized.city?.toLowerCase()).toBe('nice');
  });
});
