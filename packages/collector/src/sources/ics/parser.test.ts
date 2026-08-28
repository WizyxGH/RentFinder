import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseListPage } from './parser.js';

const HTML = readFileSync(
  fileURLToPath(new URL('../../../../../tests/fixtures/ics/liste.html', import.meta.url)),
  'utf8',
);
const PAGE = 'https://www.exemple.invalid/location?transac=location';

describe('parseListPage (ICS)', () => {
  const listings = parseListPage(HTML, PAGE, 'Cabinet Test');

  it('lit les annonces du JSON embarqué, une par entrée', () => {
    expect(listings.map((l) => l.sourceRef)).toEqual(['GES08230001-168', 'GES08230002-201']);
  });

  it('décode les entités HTML et nettoie le balisage', () => {
    const l = listings[0];
    // « &agrave; », « &egrave; », « &sup2; » doivent devenir à, è, ².
    expect(l?.title).toBe('Appartement en location à Nice / 1 pièce 29 m²');
    expect(l?.title).not.toContain('&');
  });

  it('extrait loyer, charges, surface et pièces', () => {
    const l = listings[0];
    // « LOYER : 750 € CC* » → montant + mention de charges, sans l'astérisque.
    expect(l?.priceText).toBe('750 € CC');
    // La plateforme écrit « m2 » : on normalise en m².
    expect(l?.areaText).toBe('29 m²');
    expect(l?.roomsText).toMatch(/1\s*pièce/);
    expect(l?.propertyTypeText).toMatch(/appartement/i);
  });

  it('déduit la ville du titre quand le champ `ville` est vide', () => {
    // Cas réel : la clé `ville` du JSON est un span vide.
    expect(listings[0]?.cityText).toBe('Nice');
  });

  it('préfère le champ `ville` quand il est renseigné', () => {
    expect(listings[1]?.cityText).toBe('Saint-Laurent-du-Var');
  });

  it('rend des URL absolues et n’invente pas une image absente (§17)', () => {
    expect(listings[0]?.sourceUrl).toBe(
      'https://www.exemple.invalid/location-appartement-1piece-nice-GES08230001_168',
    );
    expect(listings[0]?.imageUrls?.[0]).toContain('/photobox/');
    expect(listings[1]?.imageUrls).toBeUndefined();
  });

  it('ne rend rien si la page ne porte pas le JSON attendu (§61)', () => {
    expect(parseListPage('<html><body>rien</body></html>', PAGE, 'X')).toEqual([]);
  });
});
