import { describe, expect, it } from 'vitest';
import {
  formatAddress,
  formatCommune,
  formatLocation,
  splitCommune,
  toTitleCase,
} from './address.js';

describe('toTitleCase', () => {
  it('capitalise en respectant les particules françaises', () => {
    expect(toTitleCase('nice')).toBe('Nice');
    expect(toTitleCase('saint-laurent-du-var')).toBe('Saint-Laurent-du-Var');
    expect(toTitleCase('LA TRINITE')).toBe('La Trinite');
    expect(toTitleCase('12 rue de france')).toBe('12 Rue de France');
  });
});

describe('formatAddress', () => {
  it('rend « rue, CP Ville » comme Google Maps', () => {
    expect(formatAddress({ street: '12 rue de france', postalCode: '06000', city: 'nice' })).toBe(
      '12 Rue de France, 06000 Nice',
    );
  });

  it('omet proprement les parties absentes (§17)', () => {
    expect(formatAddress({ postalCode: '06000', city: 'nice' })).toBe('06000 Nice');
    expect(formatAddress({ city: 'nice' })).toBe('Nice');
    expect(formatAddress({ street: null, postalCode: null, city: null })).toBe('');
  });
});

describe('formatLocation', () => {
  it('préfère la rue, puis le quartier, puis la commune', () => {
    expect(
      formatLocation({ street: '3 av. jean medecin', postalCode: '06000', city: 'nice' }),
    ).toBe('3 Av. Jean Medecin, 06000 Nice');
    expect(formatLocation({ district: 'madeleine', postalCode: '06000', city: 'nice' })).toBe(
      'Madeleine, 06000 Nice',
    );
    expect(formatLocation({ postalCode: '06200', city: 'nice' })).toBe('06200 Nice');
  });
});

describe('formatCommune', () => {
  it('rétablit tirets et accents perdus par la forme comparable', () => {
    // La normalisation range la ville sans accent ni tiret pour la comparer :
    // recapitaliser ne suffisait pas (« Cagnes Sur Mer »).
    expect(formatCommune('cagnes sur mer')).toBe('Cagnes-sur-Mer');
    expect(formatCommune('saint laurent du var')).toBe('Saint-Laurent-du-Var');
    expect(formatCommune('saint andre de la roche')).toBe('Saint-André-de-la-Roche');
    expect(formatCommune('cap d ail')).toBe("Cap-d'Ail");
    expect(formatCommune('juan les pins')).toBe('Juan-les-Pins');
  });

  it('détache le quartier que certaines sources collent à la commune', () => {
    // Sans cela, « nice magnan » et « nice carre d or » apparaissaient comme
    // autant de villes différentes dans la liste.
    expect(formatCommune('nice magnan')).toBe('Nice');
    expect(formatCommune('nice carre d or')).toBe('Nice');
    expect(formatCommune('mougins tournamy')).toBe('Mougins');
  });

  it('préfère le préfixe le PLUS LONG', () => {
    // « saint andre de la roche » ne doit pas se réduire à une commune plus
    // courte qui commencerait pareil.
    expect(formatCommune('saint andre les alpes')).toBe('Saint-André-les-Alpes');
  });

  it('laisse une commune inconnue telle quelle, en casse de titre', () => {
    // Mieux vaut l'afficher que la déformer.
    expect(formatCommune('bourg en truc')).toBe('Bourg en Truc');
  });

  it('accepte une commune déjà bien écrite', () => {
    expect(formatCommune('Cagnes-sur-Mer')).toBe('Cagnes-sur-Mer');
  });
});

describe('splitCommune', () => {
  it('détache le quartier collé à la commune SANS le perdre', () => {
    // Quinze annonces n'ont ni adresse ni champ quartier : le suffixe est leur
    // seule localisation, le supprimer les ramenait à « Nice » tout court.
    expect(splitCommune('nice magnan')).toEqual({ commune: 'Nice', district: 'Magnan' });
    expect(splitCommune('nice fleurs gambetta')).toEqual({
      commune: 'Nice',
      district: 'Fleurs Gambetta',
    });
    expect(splitCommune('mandelieu capitou')).toEqual({
      commune: 'Mandelieu-la-Napoule',
      district: 'Capitou',
    });
  });

  it('ne détache rien d’une commune dont le nom fait plusieurs mots', () => {
    expect(splitCommune('saint laurent du var')).toEqual({
      commune: 'Saint-Laurent-du-Var',
      district: null,
    });
    expect(splitCommune('nice')).toEqual({ commune: 'Nice', district: null });
  });
});

describe('formatLocation — quartier', () => {
  it('promeut le quartier porté par la commune à défaut de quartier publié', () => {
    expect(formatLocation({ street: null, postalCode: '06000', city: 'nice magnan' })).toBe(
      'Magnan, 06000 Nice',
    );
  });

  it('préfère le quartier PUBLIÉ quand il existe', () => {
    expect(
      formatLocation({
        street: null,
        postalCode: '06000',
        city: 'nice magnan',
        district: 'Riquier',
      }),
    ).toBe('Riquier, 06000 Nice');
  });

  it('n’affiche pas le quartier quand la voie est connue, comme une carte', () => {
    expect(
      formatLocation({
        street: '19 Rue Michelet',
        postalCode: '06100',
        city: 'nice',
        district: 'Gambetta',
      }),
    ).toBe('19 Rue Michelet, 06100 Nice');
  });
});
