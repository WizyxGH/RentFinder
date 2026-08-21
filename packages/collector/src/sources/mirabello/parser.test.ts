import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { parseDetailPage, parseListingUrl, parseListPage } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/mirabello');
const LIST_URL = 'https://mirabello-immobilier.com/fr/locations';
const DETAIL_URL = 'https://mirabello-immobilier.com/fr/propri%C3%A9t%C3%A9/87252043';

const detail = readFileSync(join(FIXTURES, 'detail.html'), 'utf8');
const list = readFileSync(join(FIXTURES, 'list.html'), 'utf8');

describe('parseListingUrl', () => {
  it('décompose une fiche, accent percent-encodé ou non', () => {
    expect(parseListingUrl(DETAIL_URL, LIST_URL)?.reference).toBe('87252043');
    expect(parseListingUrl('/fr/propriété/1410865', LIST_URL)?.reference).toBe('1410865');
  });

  it('ignore les pages hors fiche et les autres domaines', () => {
    expect(parseListingUrl('/fr/locations', LIST_URL)).toBeNull();
    expect(parseListingUrl('/fr/agence', LIST_URL)).toBeNull();
    expect(parseListingUrl('https://autre.fr/fr/propriété/1', LIST_URL)).toBeNull();
  });
});

describe('parseListPage', () => {
  it('extrait et dédoublonne les fiches de la liste réelle', () => {
    const { urls } = parseListPage(list, LIST_URL);
    // 7 locations distinctes au 2026-08-21 (les faux liens courts sont écartés).
    expect(urls.length).toBeGreaterThanOrEqual(6);
    expect(urls.map((u) => u.reference)).toContain('87252043');
    // Pas de doublon.
    expect(new Set(urls.map((u) => u.reference)).size).toBe(urls.length);
  });
});

describe('parseDetailPage', () => {
  const { listing, warnings } = parseDetailPage(detail, DETAIL_URL, 'Mirabello Immobilier');

  it('lit le JSON-LD : réf, prix CC, surface, pièces, adresse, géo, photos', () => {
    expect(warnings).toHaveLength(0);
    expect(listing?.sourceRef).toBe('87252043');
    // Loyer charges comprises (span .price) : 950 = 890 hors charges + 60 provision.
    expect(listing?.priceText).toContain('950');
    expect(listing?.priceText?.toLowerCase()).toContain('charges comprises');
    expect(listing?.chargesText).toContain('60');
    expect(listing?.areaText).toBe('36 m²');
    expect(listing?.roomsText).toBe('2 pièces');
    expect(listing?.addressText).toBe('34 Avenue Georges Clemenceau');
    expect(listing?.cityText).toBe('Nice');
    expect(listing?.postalCodeText).toBe('06000');
    expect(listing?.latitude).toBeCloseTo(43.70191, 4);
    expect(listing?.longitude).toBeCloseTo(7.26051, 4);
    expect((listing?.imageUrls ?? []).length).toBeGreaterThan(0);
    expect(listing?.phoneText).toBeDefined();
    expect(listing?.extra?.['reference']).toBe('87252043');
  });

  it('se normalise avec le bon loyer, la surface et la ville', () => {
    const normalized = normalizeListing(listing as NonNullable<typeof listing>, {
      sourceId: 'mirabello',
      nowMs: Date.parse('2026-08-21T12:00:00Z'),
    });
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    expect(normalized.price).toBe(950);
    expect(normalized.chargesIncluded).toBe(true);
    expect(normalized.area).toBe(36);
    expect(normalized.rooms).toBe(2);
    expect(normalized.city).toBe('nice');
  });

  it('renvoie null (sans planter) sur une fiche sans JSON-LD logement', () => {
    const { listing: none, warnings: w } = parseDetailPage(
      '<html><body><p>rien</p></body></html>',
      DETAIL_URL,
      'Mirabello Immobilier',
    );
    expect(none).toBeNull();
    expect(w[0]).toContain('sans JSON-LD');
  });
});
