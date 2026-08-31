import { describe, expect, it } from 'vitest';
import { matchesSearch, type Searchable } from './search.js';

// `in` et non `??` : une surcharge explicite à `null` doit être respectée,
// sinon on ne peut pas tester le cas « champ absent » (§17).
const listing = (over: Partial<Record<string, string | null>> = {}): Searchable => {
  const pick = (key: string, fallback: string | null): string | null =>
    key in over ? (over[key] ?? null) : fallback;
  return {
    title: { value: pick('title', 'STUDIO LIBERATION') },
    description: { value: pick('description', 'Proche tramway') },
    city: { value: pick('city', 'Nice') },
    district: { value: pick('district', 'Gambetta') },
    address: { value: pick('address', '12 rue de France') },
    postalCode: { value: pick('postalCode', '06000') },
    contact: { agencyName: pick('agencyName', 'Gestion Cassini') },
  };
};

describe('matchesSearch', () => {
  it('laisse tout passer quand la recherche est vide (§17)', () => {
    expect(matchesSearch(listing(), '')).toBe(true);
    expect(matchesSearch(listing(), '   ')).toBe(true);
  });

  it('ignore la casse et les accents', () => {
    // Les annonces sont souvent en capitales sans accent : « libération »
    // doit tout de même trouver « LIBERATION ».
    expect(matchesSearch(listing({ title: 'STUDIO LIBERATION' }), 'libération')).toBe(true);
    expect(matchesSearch(listing({ district: 'Cimiez' }), 'CIMIEZ')).toBe(true);
  });

  it('cherche dans le quartier, la rue, le code postal et l’agence', () => {
    expect(matchesSearch(listing(), 'gambetta')).toBe(true);
    expect(matchesSearch(listing(), 'rue de france')).toBe(true);
    expect(matchesSearch(listing(), '06000')).toBe(true);
    expect(matchesSearch(listing(), 'cassini')).toBe(true);
  });

  it('exige TOUS les mots saisis, pour restreindre et non élargir', () => {
    expect(matchesSearch(listing(), 'nice gambetta')).toBe(true);
    // « cimiez » n'est nulle part : la combinaison ne doit pas passer.
    expect(matchesSearch(listing(), 'nice cimiez')).toBe(false);
  });

  it('ne casse pas sur les champs absents (§17)', () => {
    const sparse = listing({
      description: null,
      district: null,
      address: null,
      agencyName: null,
    });
    expect(matchesSearch(sparse, 'studio')).toBe(true);
    expect(matchesSearch(sparse, 'gambetta')).toBe(false);
  });
});
