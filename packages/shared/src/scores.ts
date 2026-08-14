/**
 * Les quatre scores du projet (§16, §17, §18, §19).
 *
 * Règle absolue commune : un score n'invente jamais de donnée. Lorsqu'un signal
 * est indisponible, il ne contribue pas au score et il est listé dans
 * `unknownSignals` — de sorte que l'interface puisse dire « calculé sans le
 * nombre de favoris » plutôt que de laisser croire à une précision inexistante.
 */

/** Entier borné à l'intervalle [0, 100]. */
export type Score = number;

/**
 * Explication d'une contribution au score.
 * Chaque score doit pouvoir se justifier ligne à ligne dans l'interface (§19).
 */
export interface ScoreReason {
  /** Clé stable, utilisable pour la traduction et les tests. */
  readonly code: string;
  /** Phrase courte affichable telle quelle. */
  readonly label: string;
  /** Contribution en points, positive ou négative. */
  readonly delta: number;
}

/** Score accompagné de ses justifications et de ses angles morts. */
export interface ExplainedScore {
  readonly value: Score;
  readonly reasons: readonly ScoreReason[];
  /**
   * Signaux qui auraient compté mais qu'aucune source n'a fournis (§17).
   * Leur présence signifie « score calculé sur une information partielle ».
   */
  readonly unknownSignals: readonly string[];
  /**
   * Part de l'information disponible, dans [0, 1].
   * 1 = tous les signaux prévus étaient présents. Sert à afficher une réserve
   * honnête sur la fiabilité du score (§18).
   */
  readonly confidence: number;
}

/**
 * Les quatre scores d'un logement.
 *
 * - `match` : correspond-il à mes critères ? (§16)
 * - `opportunity` : dois-je agir maintenant ? (§17)
 * - `visitProbability` : mon contact a-t-il des chances d'aboutir ? (§18)
 * - `risk` : cette annonce est-elle suspecte ? (§19)
 */
export interface ListingScores {
  readonly match: ExplainedScore;
  readonly opportunity: ExplainedScore;
  readonly visitProbability: ExplainedScore;
  readonly risk: ExplainedScore;
}

/** Borne une valeur dans [0, 100] et l'arrondit à l'entier le plus proche. */
export function clampScore(value: number): Score {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Score de tri global, utilisé pour classer la liste principale (§36).
 *
 * L'interface doit répondre à « que dois-je contacter maintenant ? ». On
 * privilégie donc l'urgence (opportunité) et la faisabilité (probabilité de
 * visite) autant que la pertinence, et on pénalise le risque.
 *
 * Les poids sont volontairement simples et lisibles : ils seront réévalués à
 * partir de statistiques réelles en V3 (§71), pas avant.
 */
export function actionPriority(scores: ListingScores): number {
  const { match, opportunity, visitProbability, risk } = scores;
  return clampScore(
    match.value * 0.3 +
      opportunity.value * 0.35 +
      visitProbability.value * 0.25 +
      (100 - risk.value) * 0.1,
  );
}
