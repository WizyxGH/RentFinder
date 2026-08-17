import { describe, expect, it } from 'vitest';
import { formatAddress, UNKNOWN } from './format.js';

describe('formatAddress', () => {
  it('recapitalise une adresse en majuscules', () => {
    expect(formatAddress('260 BOULEVARD DE LA MADELEINE')).toBe('260 Boulevard de la Madeleine');
    expect(formatAddress('6-8 RUE ABBE SALVETTI')).toBe('6-8 Rue Abbe Salvetti');
  });

  it('capitalise une adresse en minuscules', () => {
    expect(formatAddress('144 rue France')).toBe('144 Rue France');
    expect(formatAddress('3 rue André Poulan')).toBe('3 Rue André Poulan');
  });

  it('déplie les abréviations de voies', () => {
    expect(formatAddress('Bd Gorbella')).toBe('Boulevard Gorbella');
    expect(formatAddress('26/30 BLD NAPOLEON III')).toBe('26/30 Boulevard Napoleon III');
  });

  it('garde chiffres romains et ordinaux cohérents', () => {
    expect(formatAddress('5 AVENUE DU ROI ALBERT 1ER')).toBe('5 Avenue du Roi Albert 1er');
  });

  it('recolle les plages de numéros et les espaces', () => {
    expect(formatAddress('37 - 39  RUE CLEMENT ROASSAL')).toBe('37-39 Rue Clement Roassal');
  });

  it('laisse minuscules particules, bis et élisions', () => {
    expect(formatAddress('77bis Boulevard Gambetta')).toBe('77bis Boulevard Gambetta');
    expect(formatAddress("PLACE DE L'ILE DE BEAUTE")).toBe('Place de l’Ile de Beaute');
  });

  it('ne touche pas à une adresse déjà propre', () => {
    expect(formatAddress('17 Boulevard Général Louis Delfino')).toBe(
      '17 Boulevard Général Louis Delfino',
    );
  });

  it('affiche le marqueur « inconnu » si absente', () => {
    expect(formatAddress(null)).toBe(UNKNOWN);
    expect(formatAddress('  ')).toBe(UNKNOWN);
  });
});
