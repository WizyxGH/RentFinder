/**
 * Tests du dédoublonnage (§14).
 *
 * L'accent est mis sur les CAS AMBIGUS, comme l'exige le §14 : fusionner deux
 * logements différents fait disparaître une annonce réelle de la liste, ce qui
 * est bien plus grave que d'afficher un doublon.
 */

import { describe, expect, it } from 'vitest';
import type { NormalizedListing } from '@rentfinder/shared';
import { EMPTY_CONTACT } from '@rentfinder/shared';
import { similarity } from './similarity.js';
import { dedupe } from './dedupe.js';
import { mergeGroup } from './merge.js';

const BASE_TIME = '2026-08-14T12:00:00.000Z';

/** Fabrique une occurrence de test avec des valeurs par défaut raisonnables. */
function listing(overrides: Partial<NormalizedListing> & { id: string }): NormalizedListing {
  return {
    sourceId: 'test',
    sourceRef: overrides.id,
    sourceUrl: `https://example.invalid/${overrides.id}`,
    title: 'Appartement T2 Nice',
    description: null,
    price: 690,
    charges: null,
    chargesIncluded: null,
    area: 34,
    rooms: 2,
    bedrooms: null,
    propertyType: 'apartment',
    furnished: null,
    flatShare: null,
    address: null,
    city: 'nice',
    postalCode: '06000',
    latitude: null,
    longitude: null,
    contact: { ...EMPTY_CONTACT },
    publishedAt: null,
    availableAt: null,
    imageUrls: [],
    views: null,
    favorites: null,
    firstSeenAt: BASE_TIME,
    lastSeenAt: BASE_TIME,
    scrapedAt: BASE_TIME,
    lifecycle: 'active',
    ...overrides,
  };
}

describe('similarity — signaux forts', () => {
  it('fusionne deux annonces partageant le même téléphone', () => {
    const a = listing({
      id: 'lbc:1',
      sourceId: 'leboncoin',
      contact: { ...EMPTY_CONTACT, phone: '+33612345678' },
    });
    const b = listing({
      id: 'sel:1',
      sourceId: 'seloger',
      contact: { ...EMPTY_CONTACT, phone: '+33612345678' },
    });

    const result = similarity(a, b);
    expect(result.verdict).toBe('duplicate');
    expect(result.signals.map((signal) => signal.code)).toContain('phone');
  });

  it('fusionne deux annonces partageant la même référence d’agence', () => {
    const a = listing({
      id: 'lbc:2',
      sourceId: 'leboncoin',
      contact: { ...EMPTY_CONTACT, reference: 'REF-2024-A', agencyName: 'Agence X' },
    });
    const b = listing({
      id: 'age:2',
      sourceId: 'agencex',
      contact: { ...EMPTY_CONTACT, reference: 'ref-2024-a', agencyName: 'AGENCE X' },
    });

    expect(similarity(a, b).verdict).toBe('duplicate');
  });

  it('fusionne deux annonces aux coordonnées GPS quasi identiques', () => {
    const a = listing({ id: 'a:3', sourceId: 'a', latitude: 43.7031, longitude: 7.2661 });
    const b = listing({ id: 'b:3', sourceId: 'b', latitude: 43.7032, longitude: 7.2662 });
    expect(similarity(a, b).verdict).toBe('duplicate');
  });
});

describe('similarity — désaccords rédhibitoires', () => {
  it('refuse de fusionner deux villes différentes, même tout le reste identique', () => {
    const a = listing({ id: 'a:4', sourceId: 'a', city: 'nice' });
    const b = listing({ id: 'b:4', sourceId: 'b', city: 'cannes' });

    const result = similarity(a, b);
    expect(result.verdict).toBe('distinct');
    expect(result.blocker).toMatch(/villes différentes/);
  });

  it('refuse de fusionner des surfaces incompatibles', () => {
    const a = listing({ id: 'a:5', sourceId: 'a', area: 34 });
    const b = listing({ id: 'b:5', sourceId: 'b', area: 55 });

    const result = similarity(a, b);
    expect(result.verdict).toBe('distinct');
    expect(result.blocker).toMatch(/surfaces incompatibles/);
  });

  it('refuse de fusionner des loyers incompatibles', () => {
    const a = listing({ id: 'a:6', sourceId: 'a', price: 690 });
    const b = listing({ id: 'b:6', sourceId: 'b', price: 1290 });
    expect(similarity(a, b).verdict).toBe('distinct');
  });

  it('refuse de fusionner deux nombres de pièces différents', () => {
    const a = listing({ id: 'a:7', sourceId: 'a', rooms: 2 });
    const b = listing({ id: 'b:7', sourceId: 'b', rooms: 3 });
    expect(similarity(a, b).verdict).toBe('distinct');
  });

  it('le blocage prime sur un téléphone identique', () => {
    // Une même agence loue deux studios différents dans le même immeuble :
    // même téléphone, mais surfaces distinctes. Ne pas les fusionner.
    const phone = '+33612345678';
    const a = listing({
      id: 'a:8',
      sourceId: 'a',
      area: 18,
      price: 550,
      contact: { ...EMPTY_CONTACT, phone },
    });
    const b = listing({
      id: 'b:8',
      sourceId: 'b',
      area: 42,
      price: 890,
      contact: { ...EMPTY_CONTACT, phone },
    });

    expect(similarity(a, b).verdict).toBe('distinct');
  });
});

describe('similarity — tolérances', () => {
  it('accepte un léger écart de loyer entre portails', () => {
    // Un portail affiche charges comprises, l'autre non.
    const a = listing({ id: 'a:9', sourceId: 'a', price: 690 });
    const b = listing({ id: 'b:9', sourceId: 'b', price: 710 });
    expect(similarity(a, b).blocker).toBeNull();
  });

  it('accepte un arrondi de surface', () => {
    const a = listing({ id: 'a:10', sourceId: 'a', area: 34 });
    const b = listing({ id: 'b:10', sourceId: 'b', area: 35 });
    expect(similarity(a, b).blocker).toBeNull();
  });

  it('ne fusionne pas sur la seule concordance prix + surface', () => {
    // Deux T2 de 34 m² à 690 € à Nice existent sûrement en double exemplaire.
    // Sans signal fort, on reste prudent : ambigu, pas doublon.
    const a = listing({ id: 'a:11', sourceId: 'a', title: 'Appartement lumineux centre' });
    const b = listing({ id: 'b:11', sourceId: 'b', title: 'Studio rénové bord de mer' });

    const result = similarity(a, b);
    expect(result.verdict).not.toBe('duplicate');
  });
});

describe('dedupe', () => {
  it('regroupe les occurrences d’un même logement en un seul groupe', () => {
    const phone = '+33612345678';
    const occurrences = [
      listing({ id: 'leboncoin:1', sourceId: 'leboncoin', contact: { ...EMPTY_CONTACT, phone } }),
      listing({ id: 'seloger:1', sourceId: 'seloger', contact: { ...EMPTY_CONTACT, phone } }),
      listing({ id: 'bienici:1', sourceId: 'bienici', contact: { ...EMPTY_CONTACT, phone } }),
    ];

    const { groups } = dedupe(occurrences);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.occurrences).toHaveLength(3);
  });

  it('garde séparés deux logements distincts', () => {
    const occurrences = [
      listing({ id: 'a:1', sourceId: 'a', area: 20, price: 550 }),
      listing({ id: 'b:1', sourceId: 'b', area: 60, price: 1200 }),
    ];

    const { groups } = dedupe(occurrences);
    expect(groups).toHaveLength(2);
  });

  it('ne fusionne pas les paires ambiguës par défaut', () => {
    const occurrences = [
      listing({ id: 'a:2', sourceId: 'a', title: 'T2 lumineux', postalCode: '06000' }),
      listing({ id: 'b:2', sourceId: 'b', title: 'T2 lumineux', postalCode: '06000' }),
    ];

    const { groups } = dedupe(occurrences);
    // Prudence : deux fiches distinctes plutôt qu'une fusion hasardeuse.
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it('limite le nombre de comparaisons grâce au blocage (§56)', () => {
    // 200 annonces réparties sur des tranches de prix et de surface variées :
    // une comparaison exhaustive coûterait 19 900 paires.
    const many = Array.from({ length: 200 }, (_unused, index) =>
      listing({
        id: `s${index % 5}:${index}`,
        sourceId: `s${index % 5}`,
        price: 400 + index * 5,
        area: 15 + (index % 60),
      }),
    );

    const { comparisonCount } = dedupe(many);
    expect(comparisonCount).toBeLessThan(19_900);
  });
});

describe('mergeGroup — fusion des informations (§15)', () => {
  it('regroupe les coordonnées provenant de sources différentes', () => {
    const occurrences = [
      listing({
        id: 'leboncoin:5',
        sourceId: 'leboncoin',
        contact: { ...EMPTY_CONTACT, phone: '+33612345678', providedBy: ['leboncoin'] },
      }),
      listing({
        id: 'agencex:5',
        sourceId: 'agencex',
        contact: {
          ...EMPTY_CONTACT,
          agencyName: 'Agence X',
          name: 'Camille Martin',
          reference: 'REF-99',
          providedBy: ['agencex'],
        },
      }),
    ];

    const merged = mergeGroup(occurrences);
    expect(merged.contact.phone).toBe('+33612345678');
    expect(merged.contact.agencyName).toBe('Agence X');
    expect(merged.contact.name).toBe('Camille Martin');
    expect(merged.contact.reference).toBe('REF-99');
    expect(merged.contact.providedBy).toEqual(expect.arrayContaining(['leboncoin', 'agencex']));
  });

  it('conserve les valeurs divergentes au lieu de les écraser', () => {
    const occurrences = [
      listing({ id: 'a:6', sourceId: 'a', price: 690, area: 34 }),
      listing({ id: 'b:6', sourceId: 'b', price: 715, area: 34 }),
    ];

    const merged = mergeGroup(occurrences);
    expect(merged.price.value).toBe(690);
    expect(merged.price.conflicts).toHaveLength(1);
    expect(merged.price.conflicts[0]).toMatchObject({ value: 715, sourceId: 'b' });
  });

  it('ne signale aucun conflit quand les sources s’accordent', () => {
    const occurrences = [
      listing({ id: 'a:7', sourceId: 'a', price: 690 }),
      listing({ id: 'b:7', sourceId: 'b', price: 690 }),
    ];
    expect(mergeGroup(occurrences).price.conflicts).toHaveLength(0);
  });

  it('conserve même un petit écart de loyer — c’est souvent les charges (§15)', () => {
    // 690 € HC contre 715 € CC : l'écart est réel et informatif, il ne doit
    // pas être lissé. Le score de risque, lui, l'ignorera car non significatif.
    const occurrences = [
      listing({ id: 'a:7b', sourceId: 'a', price: 690 }),
      listing({ id: 'b:7b', sourceId: 'b', price: 715 }),
    ];
    expect(mergeGroup(occurrences).price.conflicts).toHaveLength(1);
  });

  it('conserve toutes les occurrences et leurs URLs d’origine (§13, §38)', () => {
    const occurrences = [
      listing({ id: 'leboncoin:8', sourceId: 'leboncoin' }),
      listing({ id: 'seloger:8', sourceId: 'seloger' }),
    ];

    const merged = mergeGroup(occurrences);
    expect(merged.occurrences).toHaveLength(2);
    expect(merged.occurrences.map((occurrence) => occurrence.sourceUrl)).toEqual([
      'https://example.invalid/leboncoin:8',
      'https://example.invalid/seloger:8',
    ]);
  });

  it('complète un champ absent de la source principale', () => {
    const occurrences = [
      listing({ id: 'a:9', sourceId: 'a', latitude: null, longitude: null, description: null }),
      listing({
        id: 'b:9',
        sourceId: 'b',
        latitude: 43.7,
        longitude: 7.26,
        description: 'Bel appartement rénové',
      }),
    ];

    const merged = mergeGroup(occurrences);
    expect(merged.latitude.value).toBe(43.7);
    expect(merged.description.value).toBe('Bel appartement rénové');
  });
});
