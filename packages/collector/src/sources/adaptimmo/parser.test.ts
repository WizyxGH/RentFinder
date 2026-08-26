import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDetailPage, parseListPage, toRawListing } from './parser.js';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../../../tests/fixtures/adaptimmo/${name}`, import.meta.url)),
    'utf8',
  );

const PAGE = 'https://exemple.invalid/fr/liste.htm?tdp=5&page=1';

describe('parseListPage (AdaptImmo)', () => {
  const cards = parseListPage(fixture('liste.html'), PAGE);

  it('ne garde que les LOCATIONS encore disponibles', () => {
    // La fixture contient 4 cartes : 2 locations libres, 1 déjà louée
    // (data-ribbon-prop="Vendu" = 1) et 1 VENTE (data-ope = 1).
    expect(cards.map((c) => c.reference).sort()).toEqual(['06022216', '06022300']);
  });

  it('lit type, commune, quartier, prix et photo', () => {
    const card = cards.find((c) => c.reference === '06022216');
    expect(card?.propertyTypeText).toBe('Appartement');
    expect(card?.localityText).toBe('Nice - Gambetta');
    expect(card?.priceText).toBe('660 € CC');
    expect(card?.imageUrl).toContain('assets.adaptimmo.com');
    // L'URL est nettoyée de ses paramètres d'affichage (`monnaie`).
    expect(card?.sourceUrl).toBe('https://exemple.invalid/fr/detail.htm?cle=06022216');
  });

  it('normalise le prix au format anglo-saxon (« 1,470.00 » → 1470 €)', () => {
    const card = cards.find((c) => c.reference === '06022300');
    // Sans normalisation, un parseur français y lirait « 1 ».
    expect(card?.priceText).toBe('1470 € CC');
  });
});

describe('parseDetailPage (AdaptImmo)', () => {
  const detail = parseDetailPage(fixture('detail.html'));

  it('lit surface, pièces et code postal', () => {
    expect(detail.areaText).toBe('32 m²');
    expect(detail.roomsText).toBe('1 pièce(s)');
    expect(detail.postalCodeText).toBe('06000');
  });

  it('n’invente pas une valeur « NC » (§17)', () => {
    // « Chambre(s) : NC » ne doit produire aucun nombre de chambres.
    expect(JSON.stringify(detail)).not.toContain('NC');
  });
});

describe('toRawListing (AdaptImmo)', () => {
  const cards = parseListPage(fixture('liste.html'), PAGE);
  const card = cards.find((c) => c.reference === '06022216');
  const listing = toRawListing(card!, parseDetailPage(fixture('detail.html')), 'Agence Test');

  it('sépare la commune du quartier et assemble l’annonce', () => {
    expect(listing.cityText).toBe('Nice');
    expect(listing.extra?.['quartier']).toBe('Gambetta');
    expect(listing.priceText).toBe('660 € CC');
    expect(listing.areaText).toBe('32 m²');
    expect(listing.postalCodeText).toBe('06000');
    expect(listing.agencyName).toBe('Agence Test');
    expect(listing.sourceRef).toBe('06022216');
  });
});
