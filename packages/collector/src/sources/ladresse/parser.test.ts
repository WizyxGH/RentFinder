import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { parseListPage, parseWithdrawn } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/ladresse');
const LIST_URL = 'https://www.ladresse.com/recherche/location/appartement/nice-06000';
const liste = readFileSync(join(FIXTURES, 'liste.html'), 'utf8');

describe('parseListPage — L’Adresse', () => {
  const { listings, warnings } = parseListPage(liste, LIST_URL, "L'Adresse");

  it('extrait toutes les cartes, dédoublonnées sur la référence', () => {
    expect(warnings).toHaveLength(0);
    expect(listings.length).toBeGreaterThanOrEqual(10);
    expect(new Set(listings.map((l) => l.sourceRef)).size).toBe(listings.length);
  });

  it('lit prix CC, surface, pièces, ville/CP, lien et photo', () => {
    const l = listings.find((x) => x.sourceRef === '14564121');
    expect(l?.sourceUrl).toBe(
      'https://www.ladresse.com/annonce/location/appartement/nice-06000/14564121',
    );
    expect(l?.priceText).toContain('1 207');
    expect(l?.priceText?.toLowerCase()).toContain('mois');
    expect(l?.areaText).toBe('76.25 m²');
    expect(l?.roomsText).toBe('3 pièces');
    expect(l?.cityText?.toUpperCase()).toContain('NICE');
    expect(l?.postalCodeText).toBe('06000');
    expect((l?.imageUrls ?? []).length).toBeGreaterThan(0);
  });

  it('se normalise : loyer CC, surface, ville Nice', () => {
    const l = listings.find((x) => x.sourceRef === '14564121');
    const normalized = normalizeListing(l as NonNullable<typeof l>, {
      sourceId: 'ladresse',
      nowMs: Date.parse('2026-08-22T12:00:00Z'),
    });
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    expect(normalized.price).toBe(1207);
    expect(normalized.chargesIncluded).toBe(true);
    expect(normalized.area).toBe(76.25);
    expect(normalized.rooms).toBe(3);
    expect(normalized.city).toBe('nice');
  });

  it('conserve les communes voisines (écartées ensuite au scoring)', () => {
    const cannet = listings.find((l) => l.postalCodeText === '06110');
    expect(cannet).toBeDefined();
  });
});

describe('parseWithdrawn (L’Adresse)', () => {
  it('reconnaît le bandeau posé sur une annonce retirée', () => {
    // Relevé le 2026-09-04 sur deux fiches restées en ligne après retrait.
    expect(
      parseWithdrawn(
        `<div class="annonce-reference"><span class="bien-exclusif">CE BIEN N'EST PLUS
         DISPONIBLE A LA LOCATION</span><br><span>Réf. 14348630</span></div>`,
      ),
    ).toBe(true);
  });

  it('ne voit rien sur une fiche encore active', () => {
    expect(parseWithdrawn('<div>Bel appartement disponible à la location</div>')).toBe(false);
    expect(parseWithdrawn('<html></html>')).toBe(false);
  });
});
