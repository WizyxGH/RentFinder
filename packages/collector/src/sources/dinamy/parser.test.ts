import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseListPage, parsePageCount, parsePhotoSlug } from './parser.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('../../../../../tests/fixtures/dinamy/liste.html', import.meta.url)),
  'utf8',
);
const PAGE = 'https://www.dinamyimmobilier.com/index.php?transactions=5';

describe('parsePhotoSlug (Dinamy)', () => {
  it('lit pièces et surface dans le chemin de la photo', () => {
    // Le site n'affiche la surface NULLE PART ailleurs sur la liste : elle est
    // encodée dans le dossier `Ap{pièces}P-{surface}-{ville}-{quartier}-{id}`.
    expect(parsePhotoSlug('Vues/Images/photosBiens/Ap3P-53-Nice-Cimiez-51/x-1.jpg')).toEqual({
      rooms: '3 pièces',
      area: '53 m²',
    });
  });

  it('ne rend rien si le chemin ne suit pas le format (§17)', () => {
    expect(parsePhotoSlug('Vues/Images/autre/photo.jpg')).toEqual({});
  });
});

describe('parseListPage (Dinamy)', () => {
  const listings = parseListPage(FIXTURE, PAGE, 'Dinamy Immobilier');

  it('exclut la location SAISONNIÈRE (prix à la nuitée)', () => {
    // Sans ce filtre, un « 90 € » la nuit passerait pour un loyer mensuel.
    expect(listings.map((l) => l.sourceRef).sort()).toEqual(['33', '42', '51']);
    expect(listings.some((l) => l.priceText === '90 €')).toBe(false);
  });

  it('lit prix, surface, pièces, commune et quartier', () => {
    const l = listings.find((x) => x.sourceRef === '33');
    expect(l?.priceText).toBe('700 €');
    expect(l?.areaText).toBe('23 m²');
    expect(l?.roomsText).toBe('1 pièces');
    expect(l?.cityText).toBe('Nice');
    expect(l?.extra?.['quartier']).toBe('Carras');
    expect(l?.extra?.['agencyRef']).toBe('500227');
    expect(l?.imageUrls?.[0]).toContain('photosBiens/Ap1P-23-Nice-Carras-33');
  });

  it('distingue meublé et vide via le paramètre « trans »', () => {
    expect(listings.find((x) => x.sourceRef === '33')?.furnishedText).toBe('meublé');
    expect(listings.find((x) => x.sourceRef === '51')?.furnishedText).toBe('non meublé');
  });

  it('tolère une annonce sans quartier', () => {
    const l = listings.find((x) => x.sourceRef === '42');
    expect(l?.cityText).toBe('Nice');
    expect(l?.extra?.['quartier']).toBeUndefined();
    expect(l?.areaText).toBe('78 m²');
  });
});

describe('parsePageCount (Dinamy)', () => {
  it('lit le nombre de pages, et retombe sur 1 s’il est absent', () => {
    expect(parsePageCount(FIXTURE)).toBe(5);
    expect(parsePageCount('<html><body>rien</body></html>')).toBe(1);
  });
});
