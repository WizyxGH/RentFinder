import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import {
  extractAreaText,
  extractPriceText,
  extractRoomsText,
  parseEulerianData,
  parseListingUrl,
  parseSearchPage,
} from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/orpi');
const PAGE_URL = 'https://www.orpi.com/location-immobiliere-nice/';

const nominal = readFileSync(join(FIXTURES, 'nice-page1.html'), 'utf8');
const degraded = readFileSync(join(FIXTURES, 'nice-degraded.html'), 'utf8');

describe('parseListingUrl', () => {
  it('décompose une URL à référence agence', () => {
    const parsed = parseListingUrl(
      'https://www.orpi.com/annonce-location-appartement-t1-nice-06000-x-000001-101/',
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.postalCode).toBe('06000');
    expect(parsed?.reference).toBe('x-000001-101');
    expect(parsed?.typeAndCitySlug).toBe('appartement-t1-nice');
    expect(parsed?.nonResidential).toBe(false);
  });

  it('prend le PREMIER groupe de 5 chiffres comme code postal, même si la référence UUID en contient', () => {
    const parsed = parseListingUrl(
      'https://www.orpi.com/annonce-location-appartement-t2-nice-06100-00000000-0000-4000-8000-000000000202/',
    );
    expect(parsed?.postalCode).toBe('06100');
    expect(parsed?.reference).toBe('00000000-0000-4000-8000-000000000202');
  });

  it('canonise en retirant query et fragment', () => {
    const parsed = parseListingUrl(
      'https://www.orpi.com/annonce-location-appartement-t1-nice-06000-x-000001-101/?contact=true',
    );
    expect(parsed?.canonicalUrl).toBe(
      'https://www.orpi.com/annonce-location-appartement-t1-nice-06000-x-000001-101/',
    );
  });

  it('marque les biens non résidentiels', () => {
    const parsed = parseListingUrl(
      'https://www.orpi.com/annonce-location-stationnement-nice-06300-x-000000-901/',
    );
    expect(parsed?.nonResidential).toBe(true);
  });

  it('rejette les liens qui ne sont pas des fiches', () => {
    expect(parseListingUrl('https://www.orpi.com/location-immobiliere-nice/')).toBeNull();
    expect(parseListingUrl('https://www.orpi.com/location-immobiliere-nice/?page=2')).toBeNull();
    expect(parseListingUrl('https://www.orpi.com/agence-fictive-nice/')).toBeNull();
  });
});

describe('parseEulerianData', () => {
  it('rejette un JSON dont la référence ne correspond pas', () => {
    expect(parseEulerianData('{"prdref":"autre-ref","prdamount":690}', 'x-000001-101')).toBeNull();
  });

  it('rejette un JSON corrompu sans lever', () => {
    expect(parseEulerianData('{"prdref":"x-1","surfa', 'x-1')).toBeNull();
  });
});

describe('extracteurs de texte', () => {
  it('extrait le prix de la bannière', () => {
    expect(extractPriceText('690 € par mois Location')).toBe('690 € par mois');
    expect(extractPriceText('1 280 € par mois')).toBe('1 280 € par mois');
  });

  it('extrait la surface même collée (« m2 », rendu texte de m<sup>2</sup>)', () => {
    expect(extractAreaText('Location Appartement 1 pièce 13,50 m2')).toBe('13,50 m2');
    expect(extractAreaText('appartement 20 m ²')).toBe('20 m ²');
  });

  it('extrait le nombre de pièces', () => {
    expect(extractRoomsText('Location Appartement 2 pièces 34 m 2')).toBe('2 pièces');
  });
});

describe('parseSearchPage — fixture nominale', () => {
  const page = parseSearchPage(nominal, PAGE_URL);

  it('extrait les logements et ignore le stationnement', () => {
    // 5 cartes dont 1 stationnement → 4 logements.
    expect(page.listings).toHaveLength(4);
    expect(page.listings.map((l) => l.sourceRef)).not.toContain('x-000000-901');
  });

  it("n'émet aucun warning quand la structure est saine", () => {
    expect(page.warnings).toHaveLength(0);
  });

  it('détecte la page suivante via rel="next"', () => {
    expect(page.hasNextPage).toBe(true);
  });

  it('ignore les liens de quartiers du dropdown', () => {
    for (const listing of page.listings) {
      expect(listing.sourceUrl).toContain('/annonce-location-');
    }
  });

  it('extrait le studio complet avec enrichissement JSON', () => {
    const studio = page.listings.find((l) => l.sourceRef === 'x-000001-101');
    expect(studio).toBeDefined();
    expect(studio?.priceText).toBe('690 € par mois');
    expect(studio?.areaText).toBe('13,50 m2');
    expect(studio?.roomsText).toBe('1 pièce');
    expect(studio?.propertyTypeText).toBe('appartement');
    expect(studio?.cityText).toBe('Nice');
    // codePostal null dans le JSON → repli sur celui de l'URL.
    expect(studio?.postalCodeText).toBe('06000');
    expect(studio?.latitude).toBeCloseTo(43.7017875);
    expect(studio?.longitude).toBeCloseTo(7.2628625);
    expect(studio?.agencyName).toBe('Orpi — Agence Fictive Azur');
    expect(studio?.publishedAtText).toBe('2026-08-15');
    expect(studio?.extra?.['quartier']).toBe('Quartier Fictif Nord');
    expect(studio?.imageUrls).toEqual([
      'https://img.example.invalid/fixture-orpi/photo-101.jpg?p=estate-result-item',
    ]);
  });

  it('préfère le code postal du JSON quand il est renseigné', () => {
    const t2 = page.listings.find((l) => l.sourceRef === '00000000-0000-4000-8000-000000000202');
    expect(t2?.postalCodeText).toBe('06100');
    expect(t2?.extra?.['dpe']).toBe('D');
  });

  it('fonctionne sans JSON de tracking (carte maison)', () => {
    const house = page.listings.find((l) => l.sourceRef === 'x-000004-404');
    expect(house?.priceText).toBe('1 900 € par mois');
    expect(house?.areaText).toBe('95 m2');
    expect(house?.propertyTypeText).toBe('maison');
    expect(house?.agencyName).toBe('Orpi');
    expect(house?.latitude).toBeUndefined();
  });
});

describe('parseSearchPage — chaîne complète avec la normalisation', () => {
  const page = parseSearchPage(nominal, PAGE_URL);
  const NOW = Date.parse('2026-08-15T12:00:00.000Z');

  it('produit un studio meublé typé et dans les critères', () => {
    const raw = page.listings.find((l) => l.sourceRef === 'x-000001-101');
    expect(raw).toBeDefined();
    if (raw === undefined) return;
    const normalized = normalizeListing(raw, { sourceId: 'orpi', nowMs: NOW });
    expect(normalized).not.toBeNull();
    expect(normalized?.price).toBe(690);
    expect(normalized?.area).toBe(13.5);
    expect(normalized?.rooms).toBe(1);
    expect(normalized?.city).toBe('nice');
    expect(normalized?.propertyType).toBe('apartment');
    // Le tag visible « Meublé » fait foi, pas le champ JSON contradictoire.
    expect(normalized?.furnished).toBe(true);
    expect(normalized?.latitude).toBeCloseTo(43.7017875);
    expect(normalized?.publishedAt).toBe('2026-08-15T00:00:00.000Z');
  });

  it('type correctement le T3 hors budget', () => {
    const raw = page.listings.find((l) => l.sourceRef === 'x-000003-303');
    if (raw === undefined) throw new Error('T3 absent de la fixture');
    const normalized = normalizeListing(raw, { sourceId: 'orpi', nowMs: NOW });
    expect(normalized?.price).toBe(1280);
    expect(normalized?.area).toBe(62);
    expect(normalized?.bedrooms).toBe(2);
  });
});

describe('parseSearchPage — fixture dégradée', () => {
  const page = parseSearchPage(degraded, PAGE_URL);

  it('extrait les trois cartes sans lever', () => {
    expect(page.listings).toHaveLength(3);
  });

  it('omet le prix et la surface quand ils sont absents partout', () => {
    const bare = page.listings.find((l) => l.sourceRef === 'x-000010-110');
    expect(bare?.priceText).toBeUndefined();
    expect(bare?.areaText).toBeUndefined();
  });

  it('se replie sur le HTML quand le JSON est corrompu', () => {
    const broken = page.listings.find((l) => l.sourceRef === 'x-000011-111');
    expect(broken?.priceText).toBe('650 € par mois');
    expect(broken?.areaText).toBe('20 m2');
    expect(broken?.latitude).toBeUndefined();
  });

  it("canonise l'URL même quand seul le lien ?contact=true existe", () => {
    const contactOnly = page.listings.find((l) => l.sourceRef === 'x-000012-112');
    expect(contactOnly?.sourceUrl).toBe(
      'https://www.orpi.com/annonce-location-appartement-t2-nice-06200-x-000012-112/',
    );
  });

  it("n'émet pas de warning quand 2 annonces sur 3 gardent un prix", () => {
    // 67 % au-dessus du seuil de 50 % : le warning ne doit pas crier au loup
    // à la moindre annonce incomplète (« en cours de saisie », ça existe).
    expect(page.warnings).toHaveLength(0);
  });

  it('ne voit pas de page suivante sur la dernière page', () => {
    expect(page.hasNextPage).toBe(false);
  });
});

describe('parseSearchPage — page entièrement sans prix (§61)', () => {
  it('émet le warning de structure modifiée', () => {
    // On retire tous les prix de la fixture dégradée : bannières et JSON.
    const stripped = degraded
      .replace(/<span class="h4 font-bold">[^<]*<\/span> par mois/g, '')
      .replace(/&quot;prdamount&quot;:\d+,/g, '');
    const page = parseSearchPage(stripped, PAGE_URL);
    expect(page.listings.length).toBeGreaterThan(0);
    expect(page.warnings.some((w) => w.includes('structure probablement modifiée'))).toBe(true);
  });
});
