import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeProxiedImage, hasNextPage, parseListPage } from './parser.js';

const HTML = readFileSync(
  fileURLToPath(new URL('../../../../../tests/fixtures/rentumo/liste.html', import.meta.url)),
  'utf8',
);
const PAGE = 'https://rentumo.com/rent-apartment/nice';

describe('decodeProxiedImage (Rentumo)', () => {
  it('rend l’adresse d’ORIGINE, encodée en base64 dans l’URL du proxy', () => {
    // C'est ce qui rend la source exploitable : la photo en pleine qualité, et
    // l'hébergeur du site d'où vient réellement l'annonce.
    expect(
      decodeProxiedImage(
        'https://img.rentumo.com/sig/s:366:311/rt:fill-down/aHR0cHM6Ly9leGVt/cGxlLmludmFsaWQv/cGhvdG8uanBn',
      ),
    ).toBe('https://exemple.invalid/photo.jpg');
  });

  it('ne devine rien d’une URL qui ne suit pas ce format (§17)', () => {
    expect(decodeProxiedImage('https://img.rentumo.com/logo.png')).toBeNull();
    expect(decodeProxiedImage('https://exemple.invalid/photo.jpg')).toBeNull();
  });
});

describe('parseListPage (Rentumo)', () => {
  const { listings, warnings } = parseListPage(HTML, PAGE);

  it('lit chaque carte sans avertissement', () => {
    expect(listings).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('lit les faits affichés tels quels : prix, surface, type, ville', () => {
    const first = listings[0];
    expect(first?.sourceRef).toBe('6536139');
    expect(first?.sourceUrl).toBe('https://rentumo.com/listings/nice-nord-studio-vide-6536139');
    expect(first?.priceText).toBe('€ 510');
    expect(first?.areaText).toBe('18 m²');
    expect(first?.cityText).toBe('Nice');
    expect(first?.propertyTypeText).toBe('appartement');
  });

  it('compte les CHAMBRES, jamais les pièces', () => {
    // « 1 Bedroom » n'est pas « 1 pièce » : les confondre décalerait la
    // typologie de tout l'inventaire.
    expect(listings[0]?.roomsText).toBe('1 chambre');
  });

  it('remplace la photo du proxy par son adresse d’origine', () => {
    const photos = listings[0]?.imageUrls ?? [];
    expect(photos.length).toBeGreaterThan(0);
    expect(photos.every((url) => !url.includes('img.rentumo.com'))).toBe(true);
    expect(listings[0]?.extra?.['origine']).toBe('gtiorpi.staticlbi.com');
  });

  it('n’invente pas de titre quand l’annonce ouvre sur le loyer (§17)', () => {
    // La carte ne porte pas de titre : seulement un extrait de description.
    // « Loyer : » n'en est pas un.
    expect(listings[0]?.title).toMatch(/^NICE NORD/);
    expect(listings[1]?.title).toBeUndefined();
    expect(listings[1]?.description).toMatch(/Loyer/);
  });
});

describe('hasNextPage (Rentumo)', () => {
  it('suit la pagination déclarée par le site', () => {
    expect(hasNextPage(HTML)).toBe(true);
    expect(hasNextPage('<html></html>')).toBe(false);
  });
});
