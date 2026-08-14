/**
 * Extraction des nombres depuis du texte français.
 *
 * C'est le code le plus sensible du projet : une erreur de facteur 10 sur un
 * loyer fausse tous les filtres et tous les scores. Les règles ci-dessous sont
 * donc explicites, commentées, et couvertes par des tests de non-régression
 * (§51).
 *
 * Formats rencontrés en pratique :
 *   « 690 € »            → 690
 *   « 1 890 €/mois »     → 1890   (espace insécable comme séparateur de milliers)
 *   « 1.890 € »          → 1890   (point séparateur de milliers)
 *   « 1 890,50 € »       → 1890.5 (virgule décimale)
 *   « 34,5 m² »          → 34.5
 *   « 690.50 € »         → 690.5  (point décimal, format anglo-saxon)
 */

import { cleanText } from './text.js';

/**
 * Convertit un fragment numérique français en nombre.
 *
 * L'ambiguïté du point est tranchée ainsi : un point suivi d'exactement trois
 * chiffres et précédé d'au moins un chiffre est un séparateur de milliers
 * (« 1.890 »), sinon c'est un séparateur décimal (« 690.50 »). Cette règle
 * couvre tous les cas observés sur les sites français ; le cas théorique
 * « 1.890 » voulant dire « un virgule huit-neuf-zéro » n'existe pas pour un
 * loyer ou une surface.
 *
 * @returns le nombre, ou `null` si le fragment n'est pas numérique.
 */
export function parseFrenchNumber(fragment: string): number | null {
  const cleaned = cleanText(fragment);
  if (cleaned === '') return null;

  // Seuls chiffres, espaces, points et virgules sont conservés.
  const candidate = cleaned.replace(/[^\d.,\s]/g, '').trim();
  if (candidate === '' || !/\d/.test(candidate)) return null;

  // Les espaces ne sont jamais que des séparateurs de milliers.
  let normalized = candidate.replace(/\s/g, '');

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    // Les deux présents : le dernier rencontré est le séparateur décimal.
    const lastComma = normalized.lastIndexOf(',');
    const lastDot = normalized.lastIndexOf('.');
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Virgule : décimale en français, sauf si elle sépare trois chiffres.
    normalized = /,\d{3}(?!\d)/.test(normalized)
      ? normalized.replace(/,/g, '')
      : normalized.replace(',', '.');
  } else if (hasDot) {
    // Point suivi de trois chiffres exactement → séparateur de milliers.
    normalized = /^\d{1,3}(\.\d{3})+$/.test(normalized)
      ? normalized.replace(/\./g, '')
      : normalized;
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Extrait le premier nombre d'un texte, avec ses bornes de plausibilité.
 *
 * Les bornes ne sont pas cosmétiques : elles empêchent qu'un identifiant
 * d'annonce ou un code postal glissé dans le texte soit pris pour un loyer.
 * Une valeur hors bornes rend `null` — « je ne sais pas » — plutôt qu'une
 * valeur fausse (§17).
 */
export function extractNumber(
  text: string | null | undefined,
  bounds: { min: number; max: number },
): number | null {
  if (text == null) return null;
  const cleaned = cleanText(text);

  // Capture les groupes de chiffres avec séparateurs, ex. « 1 890,50 ».
  const matches = cleaned.match(/\d[\d\s.,]*/g);
  if (matches === null) return null;

  for (const match of matches) {
    const value = parseFrenchNumber(match);
    if (value !== null && value >= bounds.min && value <= bounds.max) {
      return value;
    }
  }
  return null;
}
