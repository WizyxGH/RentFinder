import { describe, expect, it } from 'vitest';
import { extractNumber, parseFrenchNumber } from './parse-number.js';

describe('parseFrenchNumber', () => {
  it('lit un entier simple', () => {
    expect(parseFrenchNumber('690')).toBe(690);
  });

  it('traite l’espace comme un séparateur de milliers', () => {
    expect(parseFrenchNumber('1 890')).toBe(1890);
    expect(parseFrenchNumber('12 500')).toBe(12500);
  });

  it('traite l’espace insécable comme un séparateur de milliers', () => {
    // U+00A0 : c'est ce que servent la plupart des sites français.
    expect(parseFrenchNumber('1 890')).toBe(1890);
    // U+202F : espace fine insécable, utilisée par certains CMS.
    expect(parseFrenchNumber('1 890')).toBe(1890);
  });

  it('traite la virgule comme séparateur décimal', () => {
    expect(parseFrenchNumber('34,5')).toBe(34.5);
    expect(parseFrenchNumber('1 890,50')).toBe(1890.5);
  });

  it('traite le point suivi de trois chiffres comme séparateur de milliers', () => {
    expect(parseFrenchNumber('1.890')).toBe(1890);
    expect(parseFrenchNumber('12.500')).toBe(12500);
  });

  it('traite le point comme décimal quand il n’est pas suivi de trois chiffres', () => {
    expect(parseFrenchNumber('690.5')).toBe(690.5);
    expect(parseFrenchNumber('34.75')).toBe(34.75);
  });

  it('gère le format mixte point-milliers et virgule-décimale', () => {
    expect(parseFrenchNumber('1.250,50')).toBe(1250.5);
  });

  it('gère le format mixte anglo-saxon', () => {
    expect(parseFrenchNumber('1,250.50')).toBe(1250.5);
  });

  it('rend null sur une entrée non numérique', () => {
    expect(parseFrenchNumber('')).toBeNull();
    expect(parseFrenchNumber('nous consulter')).toBeNull();
    expect(parseFrenchNumber('€')).toBeNull();
  });
});

describe('extractNumber', () => {
  it('extrait le premier nombre plausible', () => {
    expect(extractNumber('690 € par mois', { min: 50, max: 20_000 })).toBe(690);
  });

  it('ignore les nombres hors bornes', () => {
    // Le code postal ne doit pas être pris pour un loyer.
    expect(extractNumber('06000 — loyer 690 €', { min: 50, max: 5_000 })).toBe(690);
  });

  it('rend null quand aucun nombre n’est dans les bornes', () => {
    expect(extractNumber('référence 12', { min: 50, max: 20_000 })).toBeNull();
  });

  it('rend null sur une entrée absente', () => {
    expect(extractNumber(null, { min: 0, max: 100 })).toBeNull();
    expect(extractNumber(undefined, { min: 0, max: 100 })).toBeNull();
  });
});

/**
 * Tests de non-régression (§51).
 *
 * NE JAMAIS SUPPRIMER NI DÉSACTIVER CES TESTS.
 * Chacun documente un bug réel ou une classe d'erreur que le projet refuse de
 * revoir apparaître. Si le comportement attendu change réellement, modifier le
 * test explicitement et documenter le changement dans le CHANGELOG.
 */
describe('non-régression — erreurs de facteur 10 sur les loyers', () => {
  it('« 650 € » vaut 650, jamais 6500', () => {
    expect(parseFrenchNumber('650')).toBe(650);
    expect(extractNumber('650 €', { min: 50, max: 20_000 })).toBe(650);
    expect(extractNumber('650 €/mois', { min: 50, max: 20_000 })).toBe(650);
  });

  it('« 650 » suivi d’un autre nombre reste 650', () => {
    expect(extractNumber('650 € + 50 € de charges', { min: 50, max: 20_000 })).toBe(650);
  });

  it('« 1 890 » ne devient jamais 1 ni 890', () => {
    expect(extractNumber('1 890 €/mois', { min: 50, max: 20_000 })).toBe(1890);
  });

  it('un séparateur de milliers ne crée pas de décimale', () => {
    // Le piège classique : « 1.890 » lu comme 1,89.
    expect(parseFrenchNumber('1.890')).not.toBeCloseTo(1.89);
    expect(parseFrenchNumber('1.890')).toBe(1890);
  });
});
