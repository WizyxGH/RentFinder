import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { agencyLabel, parseListPage } from './parser.js';

const HTML = readFileSync(
  fileURLToPath(new URL('../../../../../tests/fixtures/era/liste.html', import.meta.url)),
  'utf8',
);
const PAGE =
  'https://www.eraimmobilier.com/location/provence-alpes-cote-dazur-17/alpes-maritimes-10/nice-13662';

describe('agencyLabel (ERA)', () => {
  it('calme les capitales sans abîmer les sigles', () => {
    expect(agencyLabel('ERA MAC IMMOBILIER')).toBe('ERA Mac Immobilier');
    expect(agencyLabel('ERA AGENCE B.A IMMOBILIER')).toBe('ERA Agence B.A Immobilier');
    expect(agencyLabel('ERA CD  IMMOBILIER')).toBe('ERA CD Immobilier');
  });
});

describe('parseListPage (ERA)', () => {
  const page = parseListPage(HTML, PAGE);

  it("lit l'état de transfert et son total", () => {
    expect(page.warnings).toEqual([]);
    expect(page.total).toBe(12);
  });

  it('écarte ce qui n’est pas un logement', () => {
    // La fixture contient une place de parking : ERA la loue depuis la même
    // page, mais elle n’a rien à faire dans une recherche d’habitation (§3).
    expect(page.listings.map((listing) => listing.sourceRef)).toEqual(['575304', '573299']);
  });

  it('joint les faits, la franchise et son téléphone', () => {
    const first = page.listings[0];
    expect(first?.sourceUrl).toBe('https://www.eraimmobilier.com/annonces/575304');
    expect(first?.priceText).toBe('564 €');
    expect(first?.areaText).toBe('50 m²');
    expect(first?.roomsText).toBe('1 pièces 1 chambres');
    expect(first?.cityText).toBe('nice');
    expect(first?.postalCodeText).toBe('06000');
    expect(first?.agencyName).toBe('ERA Mac Immobilier');
    expect(first?.phoneText).toBe('06 00 00 00 01');
    expect(first?.publishedAtText).toBe('2026-09-03');
    expect(first?.extra?.['dpe']).toBe('C');
    expect(first?.extra?.['features']).toContain('terrasse');
  });

  it('garde le descriptif entier, retours à la ligne compris', () => {
    // Le HTML visible le tronque à « Emplacemen… » ; l’état de transfert, non.
    const description = page.listings[0]?.description ?? '';
    expect(description).toContain('quartier Pasteur');
    expect(description).toContain('Dépôt de garantie');
    expect(description.split('\n').length).toBeGreaterThan(5);
  });

  it('n’invente aucune position (§17) — le geoloc d’ERA est celui de l’agence', () => {
    for (const listing of page.listings) {
      expect(listing.latitude).toBeUndefined();
      expect(listing.longitude).toBeUndefined();
    }
  });

  it('ne retient pas un DPE « NC » comme une note', () => {
    // La seconde annonce porte « NC » : non communiqué.
    expect(page.listings[1]?.extra?.['dpe']).toBeUndefined();
  });

  it('se normalise en une annonce exploitable', () => {
    const normalized = normalizeListing(page.listings[0]!, { sourceId: 'era', nowMs: 0 });
    expect(normalized?.price).toBe(564);
    expect(normalized?.area).toBe(50);
    expect(normalized?.city).toBe('nice');
    expect(normalized?.propertyType).toBe('apartment');
    expect(normalized?.dpe).toBe('C');
    expect(normalized?.latitude).toBeNull();
    expect(normalized?.contact.phone).toBeTruthy();
  });

  it('signale une page dont l’état de transfert manque, sans rien inventer', () => {
    const empty = parseListPage('<html><body>rien</body></html>', PAGE);
    expect(empty.listings).toEqual([]);
    expect(empty.warnings).toHaveLength(1);
    expect(empty.total).toBeNull();
  });
});
