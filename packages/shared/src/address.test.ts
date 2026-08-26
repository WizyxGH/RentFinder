import { describe, expect, it } from 'vitest';
import { formatAddress, formatLocation, toTitleCase } from './address.js';

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
