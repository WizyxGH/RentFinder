import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { parseDetailPage, parseListingUrl, parseListPage } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/hektor');
const BASE = 'https://www.agence-fictive.fr/location/1';
const DETAIL_URL =
  'https://www.agence-fictive.fr/location/1-nice/appartement/t3/31-sett-gambetta-disponible-le-1er-septembre-2027/';

const liste = readFileSync(join(FIXTURES, 'liste.html'), 'utf8');
const detail = readFileSync(join(FIXTURES, 'detail-31.html'), 'utf8');

describe('parseListingUrl', () => {
  it('décompose les deux formes de fiches de la plateforme', () => {
    const zone = parseListingUrl(DETAIL_URL, BASE);
    expect(zone?.reference).toBe('31');
    expect(zone?.citySlug).toBe('nice');

    const plain = parseListingUrl('/92-location-parking.html', BASE);
    expect(plain?.reference).toBe('92');
    expect(plain?.citySlug).toBeNull();
  });

  it('rejette pagination, pages éditoriales et autres domaines', () => {
    expect(parseListingUrl('/location/2', BASE)).toBeNull();
    expect(parseListingUrl('/contact.html', BASE)).toBeNull();
    expect(
      parseListingUrl('https://autre-site.exemple/location/1-nice/appartement/99-x', BASE),
    ).toBeNull();
  });
});

describe('parseListPage', () => {
  it('extrait les fiches du site, dédoublonnées, sans les liens externes', () => {
    const { urls, warnings } = parseListPage(liste, BASE);
    expect(warnings).toHaveLength(0);
    expect(urls.map((url) => url.reference).sort()).toEqual(['31', '42', '92']);
  });

  it('signale une liste sans fiche (structure changée, §69)', () => {
    const { warnings } = parseListPage('<html><body>vide</body></html>', BASE);
    expect(warnings).toHaveLength(1);
  });
});

describe('parseDetailPage', () => {
  const { listing, warnings } = parseDetailPage(detail, DETAIL_URL, 'Agence Fictive');

  it('extrait la fiche complète sans warning', () => {
    expect(warnings).toHaveLength(0);
    expect(listing?.sourceRef).toBe('31');
    expect(listing?.priceText).toBe('1 460 € CC');
    expect(listing?.chargesText).toContain('110 €');
    expect(listing?.areaText).toBe('54.25m²');
    expect(listing?.roomsText).toBe('3 pièces');
    expect(listing?.postalCodeText).toBe('06000');
    expect(listing?.cityText).toBe('Nice');
    // La terrasse est à NON : seul le balcon (OUI) devient un atout.
    expect(listing?.extra?.['features']).toContain('Balcon');
    expect(listing?.extra?.['features']).not.toContain('Terrasse');
    // Seules les vraies photos (/images/biens/) : l'avatar d'agence et le logo
    // du CDN sont écartés — sinon envoyés à tort comme photo d'alerte (§29).
    expect(listing?.imageUrls).toHaveLength(2);
    expect(listing?.imageUrls?.every((u) => u.includes('/images/biens/'))).toBe(true);
    // La photo « original » est normalisée vers la taille d'affichage.
    expect(listing?.imageUrls?.[0]).toContain('/1600xauto/');
  });

  it('se normalise, disponibilité et exclusivité étudiante comprises', () => {
    const normalized = normalizeListing(listing as NonNullable<typeof listing>, {
      sourceId: 'hektor-test',
      nowMs: Date.parse('2026-08-17T12:00:00Z'),
    });
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    expect(normalized.price).toBe(1460);
    expect(normalized.chargesIncluded).toBe(true);
    expect(normalized.area).toBe(54.25);
    expect(normalized.rooms).toBe(3);
    expect(normalized.propertyType).toBe('apartment');
    expect(normalized.furnished).toBe(true);
    expect(normalized.city).toBe('nice');
    // « DISPONIBLE LE 1ER SEPTEMBRE 2027 » dans le titre → date de dispo.
    expect(normalized.availableAt).toBe('2027-09-01T00:00:00.000Z');
  });
});
