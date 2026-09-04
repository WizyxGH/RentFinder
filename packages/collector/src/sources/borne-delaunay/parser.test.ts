import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { parseListPage, referenceOf } from './parser.js';

const HTML = readFileSync(
  fileURLToPath(
    new URL('../../../../../tests/fixtures/borne-delaunay/liste.html', import.meta.url),
  ),
  'utf8',
);
const PAGE = 'https://www.borne-delaunay.com/immobilier/louer-13';

describe('referenceOf (Borne & Delaunay)', () => {
  it('lit la référence en fin de chemin', () => {
    expect(referenceOf('/location-appartement-t2-nice-06000-2082')).toBe('2082');
  });

  it('ne devine rien d’un lien sans référence (§17)', () => {
    expect(referenceOf('/location-appartement-nice')).toBeNull();
  });
});

describe('parseListPage (Borne & Delaunay)', () => {
  const { listings, warnings } = parseListPage(HTML, PAGE, 'Borne & Delaunay');

  it('lit chaque carte sans avertissement', () => {
    expect(listings).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('lit les faits de la carte : loyer, surface, pièces, ville, CP', () => {
    const first = listings[0];
    expect(first?.sourceRef).toBe('2082');
    expect(first?.sourceUrl).toBe(
      'https://www.borne-delaunay.com/location-appartement-t2-nice-06000-2082',
    );
    expect(first?.priceText).toContain('882');
    expect(first?.areaText).toContain('52 m²');
    expect(first?.roomsText).toContain('2 pièces');
    expect(first?.cityText).toBe('Nice');
    expect(first?.postalCodeText).toBe('06000');
  });

  it('garde l’accroche de l’agence comme titre — elle situe le bien', () => {
    // « A LOUER NICE - QUARTIER DES FLEURS/BOTTERO - T2 » nomme le quartier,
    // là où le libellé du lien ne dit que « Location Appartement T2 ».
    expect(listings[0]?.title).toMatch(/QUARTIER DES FLEURS/);
  });

  it('joint la photo, en absolu', () => {
    expect(listings[0]?.imageUrls?.[0]).toMatch(
      /^https:\/\/www\.borne-delaunay\.com\/uploads\/accommodations\//,
    );
  });

  it('se normalise en une annonce exploitable', () => {
    const normalized = normalizeListing(listings[0]!, { sourceId: 'borne-delaunay', nowMs: 0 });
    expect(normalized?.price).toBe(882);
    expect(normalized?.area).toBe(52);
    expect(normalized?.rooms).toBe(2);
    expect(normalized?.city).toBe('nice');
    expect(normalized?.propertyType).toBe('apartment');
  });
});
