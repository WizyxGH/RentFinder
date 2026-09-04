import { describe, expect, it } from 'vitest';
import { parseReferencePoints } from './reference-points.js';

describe('parseReferencePoints', () => {
  it('garde un point complet', () => {
    expect(
      parseReferencePoints([{ label: 'Travail', address: '12 rue X, Nice', mode: 'transit' }]),
    ).toEqual([{ label: 'Travail', address: '12 rue X, Nice', mode: 'transit' }]);
  });

  it('distingue « rien de réglé » de « tout retiré »', () => {
    // `null` fait retomber sur `.env` ; `[]` est le choix de n'afficher aucune
    // distance. Les confondre rallumerait un repère qu'on vient d'effacer.
    expect(parseReferencePoints(null)).toBeNull();
    expect(parseReferencePoints(undefined)).toBeNull();
    expect(parseReferencePoints('travail')).toBeNull();
    expect(parseReferencePoints([])).toEqual([]);
  });

  it('écarte un point sans adresse : il ne produirait jamais de distance', () => {
    expect(parseReferencePoints([{ label: 'Travail', address: '   ', mode: 'transit' }])).toEqual(
      [],
    );
    expect(parseReferencePoints([{ label: '', address: 'Nice', mode: 'transit' }])).toEqual([]);
  });

  it('retombe sur les transports quand le mode est inconnu', () => {
    expect(
      parseReferencePoints([{ label: 'Travail', address: 'Nice', mode: 'téléportation' }]),
    ).toEqual([{ label: 'Travail', address: 'Nice', mode: 'transit' }]);
  });

  it('rogne les espaces et ignore les entrées qui ne sont pas des objets', () => {
    expect(parseReferencePoints([' ', null, { label: ' Gare ', address: ' Nice ' }])).toEqual([
      { label: 'Gare', address: 'Nice', mode: 'transit' },
    ]);
  });
});
