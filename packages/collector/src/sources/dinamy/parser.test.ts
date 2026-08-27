import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseListPage, parsePageCount, parsePhotoSlug } from './parser.js';

const HTML = readFileSync(
  fileURLToPath(new URL('../../../../../tests/fixtures/dinamy/liste.html', import.meta.url)),
  'utf8',
);
const PAGE = 'https://www.dinamyimmobilier.com/index.php?transactions=5';

describe('parsePhotoSlug (Dinamy)', () => {
  it('lit pièces et surface dans le dossier photo', () => {
    expect(parsePhotoSlug('Vues/Images/photosBiens/Ap3P-53-Nice-Cimiez-51/x.jpg')).toEqual({
      rooms: '3 pièces',
      area: '53 m²',
    });
  });

  it('ne rend rien si le dossier ne suit pas le format (§17)', () => {
    expect(parsePhotoSlug('Vues/Images/photosBiens/divers/x.jpg')).toEqual({});
  });
});

describe('parseListPage (Dinamy)', () => {
  const listings = parseListPage(HTML, PAGE, 'Dinamy Immobilier');

  it('écarte la location SAISONNIÈRE (prix à la nuitée)', () => {
    // La fixture contient 4 cartes dont une saisonnière à 90 € : sans ce filtre,
    // elle polluerait les notifications avec un faux « bon plan ».
    expect(listings.map((l) => l.sourceRef).sort()).toEqual(['33', '42', '51']);
  });

  it('lit prix, surface, pièces, ville, quartier et meublé', () => {
    const l = listings.find((x) => x.sourceRef === '33');
    expect(l?.priceText).toBe('700 €');
    expect(l?.areaText).toBe('23 m²');
    expect(l?.roomsText).toBe('1 pièces');
    expect(l?.cityText).toBe('Nice');
    expect(l?.extra?.['quartier']).toBe('Carras');
    expect(l?.furnishedText).toBe('meublé');
    expect(l?.extra?.['agencyRef']).toBe('500227');
  });

  it('distingue la location VIDE de la meublée', () => {
    expect(listings.find((x) => x.sourceRef === '51')?.furnishedText).toBe('non meublé');
  });

  it('tolère un dossier photo sans quartier', () => {
    const l = listings.find((x) => x.sourceRef === '42');
    expect(l?.areaText).toBe('78 m²');
    expect(l?.extra?.['quartier']).toBeUndefined();
  });
});

describe('parsePageCount (Dinamy)', () => {
  it('lit le nombre de pages, 1 par défaut', () => {
    expect(parsePageCount(HTML)).toBe(2);
    expect(parsePageCount('<html></html>')).toBe(1);
  });
});
