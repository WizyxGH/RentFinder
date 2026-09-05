import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { listUrl, parseCharacteristics, parseDetail, parseListPage, splitTitle } from './parser.js';

const HTML = readFileSync(
  fileURLToPath(new URL('../../../../../tests/fixtures/fnaim/liste.html', import.meta.url)),
  'utf8',
);
const PAGE = listUrl(1);

describe('listUrl (FNAIM)', () => {
  it('utilise la pagination SEO, sans querystring', () => {
    expect(listUrl(1)).toBe(
      'https://www.fnaim.fr/liste-annonces-immobilieres/18-location-appartement-nice-06000.htm',
    );
    expect(listUrl(3)).toBe(
      'https://www.fnaim.fr/liste-annonces-immobilieres/18-location-appartement-nice-06000-page-3.htm',
    );
  });
});

describe('splitTitle (FNAIM)', () => {
  it('décompose le titre canonique', () => {
    expect(splitTitle('Appartement 1 pièce 23m² NICE 06200')).toEqual({
      propertyType: 'Appartement',
      rooms: '1 pièce',
      area: '23m²',
      city: 'NICE',
      postalCode: '06200',
    });
  });

  it('ne devine rien d’un titre d’une autre forme (§17)', () => {
    expect(splitTitle('Bel appartement à louer')).toEqual({});
  });
});

describe('parseListPage (FNAIM)', () => {
  const page = parseListPage(HTML, PAGE);

  it('lit chaque carte sans avertissement', () => {
    expect(page.listings).toHaveLength(2);
    expect(page.warnings).toEqual([]);
    expect(page.hasNext).toBe(true);
  });

  it('lit les faits, l’agence et son téléphone', () => {
    const listing = page.listings[1];
    expect(listing?.sourceRef).toBe('53157237');
    expect(listing?.sourceUrl).toBe(
      'https://www.fnaim.fr/annonce-immobiliere/53157237/18-location-appartement-nice-06200.htm',
    );
    expect(listing?.priceText).toContain('646');
    expect(listing?.areaText).toBe('23m²');
    expect(listing?.roomsText).toBe('1 pièce');
    expect(listing?.cityText).toBe('NICE');
    expect(listing?.postalCodeText).toBe('06200');
    expect(listing?.agencyName).toBeTruthy();
    expect(listing?.phoneText).toBe('06 00 00 00 01');
    expect(listing?.extra?.['features']).toContain('Ascenseur');
  });

  it('garde la description avec ses retours à la ligne — l’adresse y est', () => {
    const description = page.listings[1]?.description ?? '';
    expect(description.split('\n').length).toBeGreaterThan(2);
    expect(description).toContain('CORNICHE FLEURIE');
  });

  it('ne prend pas « Nous consulter » pour un loyer (§17)', () => {
    expect(page.listings[0]?.priceText).toBeUndefined();
  });

  it('joint les photos, la principale et les suivantes', () => {
    const images = page.listings[0]?.imageUrls ?? [];
    expect(images.length).toBeGreaterThan(1);
    expect(images[0]).toMatch(/^https:\/\/imagesv2\.fnaim\.fr\//);
  });

  it('se normalise en une annonce exploitable, adresse comprise', () => {
    const normalized = normalizeListing(page.listings[1]!, { sourceId: 'fnaim', nowMs: 0 });
    expect(normalized?.price).toBe(646);
    expect(normalized?.area).toBe(23);
    expect(normalized?.rooms).toBe(1);
    expect(normalized?.city).toBe('nice');
    expect(normalized?.postalCode).toBe('06200');
    expect(normalized?.propertyType).toBe('apartment');
    expect(normalized?.contact.phone).toBeTruthy();
  });

  it('ne rend rien d’une page sans annonce, sans lever d’erreur (§69)', () => {
    const empty = parseListPage('<html><body><ul></ul></body></html>', PAGE);
    expect(empty.listings).toEqual([]);
    expect(empty.hasNext).toBe(false);
  });
});

describe('parseDetail (FNAIM)', () => {
  const FICHE = readFileSync(
    fileURLToPath(new URL('../../../../../tests/fixtures/fnaim/fiche.html', import.meta.url)),
    'utf8',
  );

  it('récupère la description ENTIÈRE que la carte coupait', () => {
    const detail = parseDetail(FICHE);
    const carte = parseListPage(HTML, PAGE).listings[1]?.description ?? '';
    expect(detail?.description).toBeDefined();
    expect(detail!.description!.length).toBeGreaterThan(carte.length * 3);
    // Ce que la troncature emportait : les conditions, et l'adresse.
    expect(detail?.description).toContain('CORNICHE FLEURIE');
    expect(detail?.description).toContain('honoraires charge locataire');
  });

  it('garde les retours à la ligne du texte', () => {
    expect((parseDetail(FICHE)?.description ?? '').split('\n').length).toBeGreaterThan(2);
  });

  it('ne conclut rien d’une page sans description (§17)', () => {
    expect(parseDetail('<html><body><p>rien</p></body></html>')).toBeNull();
  });
});

describe('parseCharacteristics', () => {
  const page = (body: string): string => `<html><body>${body}</body></html>`;

  it('lit les couples intitulé / valeur', () => {
    const html = page(`<div class="caracteristique">
      <ul><li><span>Type d'habitation&nbsp;: </span> Appartement</li>
          <li><span>Surface habitable&nbsp;: </span> 16 m²</li></ul></div>`);
    expect(parseCharacteristics(html)).toBe(
      "Type d'habitation : Appartement · Surface habitable : 16 m²",
    );
  });

  it('ÉCARTE les « Non » — sans quoi on inventerait un balcon', () => {
    // La normalisation cherche le MOT « balcon » dans ce texte : recopier
    // « Balcon : Non » y ferait apparaître un balcon que l'annonce dit ne pas
    // avoir. On déduirait un équipement de son absence (§17).
    const html = page(`<div class="caracteristique">
      <ul><li><span>Balcon&nbsp;: </span> Non</li>
          <li><span>Terrasse&nbsp;: </span> Non</li>
          <li><span>Ascenseur&nbsp;: </span> Non</li></ul></div>`);
    expect(parseCharacteristics(html)).toBeUndefined();
  });

  it('réduit un « Oui » à son intitulé', () => {
    // « Ascenseur » se lit ; « Ascenseur : Oui » ne se lit pas mieux.
    const html = page(`<div class="caracteristique">
      <ul><li><span>Ascenseur&nbsp;: </span> Oui</li></ul></div>`);
    expect(parseCharacteristics(html)).toBe('Ascenseur');
  });

  it('ignore une fiche sans tableau', () => {
    expect(parseCharacteristics(page('<p>rien</p>'))).toBeUndefined();
  });
});
