/**
 * Critères de recherche (§2).
 *
 * Pour le MVP, seuls trois critères sont actifs : ville, budget, surface.
 * Les autres champs existent pour que l'ajout d'un critère ne demande aucune
 * modification de structure — uniquement une règle de scoring supplémentaire.
 * Ils valent `undefined` tant qu'ils ne sont pas utilisés : un critère absent
 * n'est pas un critère à zéro.
 */

import type { PropertyType } from './listing.js';

export interface SearchCriteria {
  // --- Actifs dans le MVP ---------------------------------------------------
  /** Villes recherchées, en minuscules sans accent, ex. `['nice']`. */
  readonly cities: readonly string[];
  /** Loyer mensuel maximum en euros, charges comprises. */
  readonly maxPrice: number;
  /** Surface minimum en m². */
  readonly minArea: number;

  // --- Prévus, inactifs par défaut (§2) ------------------------------------
  readonly propertyTypes?: readonly PropertyType[];
  readonly minRooms?: number;
  readonly maxRooms?: number;
  readonly furnished?: boolean;
  readonly districts?: readonly string[];
  /** Durée maximale acceptée vers un point de référence, en minutes. */
  readonly maxDurationToReference?: Readonly<Record<string, number>>;
  /** Classes DPE acceptées, ex. `['A', 'B', 'C']`. */
  readonly energyClasses?: readonly string[];
  readonly requiresBalcony?: boolean;
  readonly requiresParking?: boolean;
}

/**
 * Critères du MVP (§2).
 *
 * Ces valeurs sont publiques et peuvent figurer dans le dépôt : elles ne
 * révèlent rien de personnel, contrairement aux points de référence (§20).
 */
export const MVP_CRITERIA: SearchCriteria = {
  cities: ['nice'],
  maxPrice: 700,
  // 14 m² depuis le 2026-08-15 (12 m² à l'origine) — décision utilisateur.
  minArea: 14,
};
