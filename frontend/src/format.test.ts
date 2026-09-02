import { describe, expect, it } from 'vitest';
import { UNKNOWN, formatAddress, formatPhone, telHref } from './format.js';

describe('formatAddress', () => {
  it('recapitalise une adresse en majuscules', () => {
    expect(formatAddress('260 BOULEVARD DE LA MADELEINE')).toBe('260 Boulevard de la Madeleine');
    expect(formatAddress('6-8 RUE ABBE SALVETTI')).toBe('6-8 Rue Abbe Salvetti');
  });

  it('capitalise une adresse en minuscules', () => {
    expect(formatAddress('144 rue France')).toBe('144 Rue France');
    expect(formatAddress('3 rue André Poulan')).toBe('3 Rue André Poulan');
  });

  it('retire le code postal et la ville collés à la voie (harmonisation)', () => {
    expect(formatAddress('260 BOULEVARD DE LA MADELEINE 06000 NICE')).toBe(
      '260 Boulevard de la Madeleine',
    );
    expect(formatAddress('5 Avenue Jean Médecin, 06000 Nice, France')).toBe(
      '5 Avenue Jean Médecin',
    );
  });

  it('déplie davantage d’abréviations de voies', () => {
    expect(formatAddress('Pl Masséna')).toBe('Place Masséna');
    expect(formatAddress('Ch de Fabron')).toBe('Chemin de Fabron');
    expect(formatAddress('Rte de Turin')).toBe('Route de Turin');
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

describe('formatPhone', () => {
  it('rend la forme française usuelle, par paires', () => {
    expect(formatPhone('0600000012')).toBe('06 00 00 00 12');
    expect(formatPhone('06.00.00.00.34')).toBe('06 00 00 00 34');
  });

  it('ramène l’international au format national', () => {
    expect(formatPhone('+33600000012')).toBe('06 00 00 00 12');
    expect(formatPhone('0033600000012')).toBe('06 00 00 00 12');
  });

  it('laisse INTACT ce qui n’est pas un numéro français (§17)', () => {
    // Mieux vaut un format inhabituel qu'un numéro déformé.
    expect(formatPhone('+41 22 000 00 00')).toBe('+41 22 000 00 00');
    expect(formatPhone('numéro sur demande')).toBe('numéro sur demande');
  });

  it('signale l’absence plutôt que de rendre une chaîne vide', () => {
    expect(formatPhone(null)).toBe(UNKNOWN);
    expect(formatPhone('   ')).toBe(UNKNOWN);
  });
});

describe('telHref', () => {
  it('retire espaces et ponctuation, que certains téléphones refusent', () => {
    expect(telHref('06 00 00 00 12')).toBe('tel:0600000012');
    expect(telHref('+33 6.00.00.00.12')).toBe('tel:+33600000012');
  });
});
