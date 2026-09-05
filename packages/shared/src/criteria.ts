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
  /**
   * Loyer mensuel MINIMUM en euros. Sert surtout à écarter les biens non
   * résidentiels mal étiquetés « appartement » par la source (parking, box,
   * cave à ~100 €), qu'aucun autre signal fiable ne distingue. Un bien sans
   * prix publié n'est jamais exclu (§17).
   */
  readonly minPrice?: number;
  /**
   * `true` : exclure les locations ÉTUDIANTES (résidences étudiantes, biens
   * annoncés « étudiant/erasmus »). Détecté par mots-clés dans le titre, la
   * description et l'URL. Décision utilisateur.
   */
  readonly excludeStudent?: boolean;
  readonly propertyTypes?: readonly PropertyType[];
  readonly minRooms?: number;
  readonly maxRooms?: number;
  readonly furnished?: boolean;
  /**
   * `true` : exclure les biens proposés EN colocation de la liste principale
   * (ils restent collectés et consultables via « hors critères », §53). Un
   * bien dont la source ne précise rien n'est PAS exclu (on n'élimine pas sur
   * une donnée absente, §17).
   */
  readonly excludeFlatShare?: boolean;
  readonly districts?: readonly string[];
  /**
   * Filtre sur la NATURE DU BAILLEUR (décision utilisateur) :
   * - `'all'` (défaut) : aucune restriction.
   * - `'private'` : masque les annonces d'AGENCE connue. Les particuliers ET
   *   les bailleurs INCONNUS restent affichés — on n'élimine pas sur une donnée
   *   absente (§17), et les alertes e-mail SeLoger/Bien'ici (souvent inconnues)
   *   restent visibles.
   * - `'agency'` : ne garde QUE les agences connues.
   * `'private'` et `'agency'` partitionnent l'ensemble : chaque annonce est dans
   * l'un ou l'autre, `'all'` est leur union.
   */
  readonly landlordFilter?: 'all' | 'private' | 'agency';
  /**
   * Filtre sur le caractère MEUBLÉ (décision utilisateur), distinct de la
   * préférence notée `furnished` :
   * - `'all'` (défaut) : aucune restriction.
   * - `'furnished'` : ne garde que les biens meublés (et ceux au statut inconnu,
   *   §17 — on n'élimine pas sur une donnée absente).
   * - `'unfurnished'` : ne garde que les biens NON meublés (+ inconnus).
   */
  readonly furnishedFilter?: 'all' | 'furnished' | 'unfurnished';
  /**
   * Durée maximale acceptée du trajet DOMICILE → TRAVAIL, en minutes. Au-delà,
   * l'annonce est hors critères (§53). Comparée au temps de trajet réel en
   * transports en commun quand il est disponible (Navitia, §20), sinon à
   * l'estimation vol d'oiseau. Un bien sans localisation connue n'est jamais
   * exclu sur ce critère (§17). Absent → pas de plafond de trajet.
   */
  readonly maxCommuteMinutes?: number;
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
  // 20 m² depuis le 2026-09-01 (12 → 14 le 2026-08-15 → 16 le 2026-08-22 → 18 le
  // 2026-08-25 → 20) — décisions utilisateur successives. Comparaison inclusive
  // (surface ≥ minArea).
  minArea: 20,
  // L'utilisateur ne cherche pas de colocation (décision du 2026-08-15).
  excludeFlatShare: true,
  // Écarte les parkings/box/caves mal étiquetés « appartement » (~100 €).
  minPrice: 250,
  // L'utilisateur ne cherche pas de location étudiante (décision du 2026-08-15).
  excludeStudent: true,
  // Trajet domicile→travail ≤ 60 min (arrivée 9 h) — décision du 2026-08-22.
  maxCommuteMinutes: 60,
};

/**
 * De combien une annonce peut dépasser les critères et rester « proche ».
 *
 * CINQ POUR CENT. C'était dix, et dix était trop : sur un plafond de 700 €,
 * cela signalait jusqu'à 770 € — soixante-dix euros par mois, huit cent
 * quarante par an. Ce n'est plus un arrondi, c'est un autre budget, et une
 * alerte qui le propose ne rend pas service : elle fait douter du filtre.
 *
 * À cinq pour cent, la fourchette signalée est 701–735 € : de quoi rattraper
 * une annonce dont les charges basculent le loyer d'un cheveu, sans jamais
 * proposer ce qu'on a explicitement écarté.
 *
 * La même marge s'applique à la surface, dans l'autre sens : 20 m² accepte
 * 19 m².
 */
export const NEAR_MATCH_MARGIN = 0.05;
