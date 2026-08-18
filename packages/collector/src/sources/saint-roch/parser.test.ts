import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { isTargetListing, parseDetailPage, parseListingUrl, parseListPage } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/saint-roch');
const BASE = 'https://www.saintrochimmobilier.com/location-immobilier-nice.asp';
const DETAIL_URL =
  'https://www.saintrochimmobilier.com/annonce/location-appartement-nice-L00015(A02F).asp';

const detail = readFileSync(join(FIXTURES, 'detail.html'), 'utf8');

describe('parseListingUrl / isTargetListing', () => {
  it('décompose une fiche avec référence à parenthèses', () => {
    const parsed = parseListingUrl(DETAIL_URL, BASE);
    expect(parsed?.reference).toBe('L00015(A02F)');
    expect(parsed?.slug).toBe('appartement-nice');
  });

  it('cible le résidentiel des communes voulues seulement', () => {
    const cities = ['nice', 'la-trinite'];
    const nice = parseListingUrl('/annonce/location-appartement-nice-L00093(108).asp', BASE);
    const vosges = parseListingUrl(
      '/annonce/location-appartement-st-die-des-vosges-L00069(201).asp',
      BASE,
    );
    const garage = parseListingUrl('/annonce/location-garage-nice-L00014(176).asp', BASE);
    expect(nice !== null && isTargetListing(nice, cities)).toBe(true);
    expect(vosges !== null && isTargetListing(vosges, cities)).toBe(false);
    expect(garage !== null && isTargetListing(garage, cities)).toBe(false);
  });

  it('ignore les pages hors annonces', () => {
    expect(parseListingUrl('/qui-sommes-nous.asp', BASE)).toBeNull();
    expect(parseListingUrl('https://www.stars-system.fr/fr/avis.asp?cliid=170', BASE)).toBeNull();
  });
});

describe('parseListPage', () => {
  it('extrait et dédoublonne les fiches', () => {
    const html = `
      <a href="/annonce/location-appartement-nice-L00015(A02F).asp">a</a>
      <a href="/annonce/location-appartement-nice-L00015(A02F).asp">bis</a>
      <a href="/annonce/location-garage-L00287(1046).asp">g</a>
      <a href="/contact.asp">c</a>`;
    const { urls } = parseListPage(html, BASE);
    expect(urls.map((url) => url.reference)).toEqual(['L00015(A02F)', 'L00287(1046)']);
  });
});

describe('parseDetailPage', () => {
  const { listing, warnings } = parseDetailPage(detail, DETAIL_URL, 'Agence Fictive');

  it('extrait loyer CC, charges, DPE, photos et téléphone', () => {
    expect(warnings).toHaveLength(0);
    expect(listing?.sourceRef).toBe('L00015(A02F)');
    expect(listing?.priceText).toContain('1 110');
    expect(listing?.priceText).toContain('CC');
    expect(listing?.chargesText).toContain('110');
    expect(listing?.areaText).toBe('64.57m²');
    expect(listing?.roomsText).toBe('3 Pieces');
    expect(listing?.extra?.['dpe']).toBe('DPE D');
    expect(listing?.imageUrls).toHaveLength(2);
    expect(listing?.phoneText).toContain('04');
    expect(listing?.cityText).toBe('nice');
  });

  it('se normalise avec le bon loyer et la disponibilité', () => {
    const normalized = normalizeListing(listing as NonNullable<typeof listing>, {
      sourceId: 'saint-roch',
      nowMs: Date.parse('2026-08-18T12:00:00Z'),
    });
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    expect(normalized.price).toBe(1110);
    expect(normalized.chargesIncluded).toBe(true);
    expect(normalized.charges).toBe(110);
    expect(normalized.area).toBe(64.57);
    expect(normalized.rooms).toBe(3);
    expect(normalized.dpe).toBe('D');
    expect(normalized.furnished).toBe(true);
    // « Disponible le 1er octobre » sans année → prochaine occurrence.
    expect(normalized.availableAt).toBe('2026-10-01T00:00:00.000Z');
  });
});
