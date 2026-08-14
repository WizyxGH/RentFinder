/**
 * Scheduler adaptatif (§7, §29).
 *
 * Le projet refuse le « tous les scrapers toutes les 10 minutes ». Chaque
 * source gagne ou perd de la fréquence selon ce qu'elle produit réellement :
 * une source qui sort des annonces neuves est interrogée plus souvent, une
 * source qui dort est espacée, une source en erreur est mise de côté.
 *
 * Toutes les décisions sont pures et déterministes : elles dépendent
 * uniquement du descripteur, de l'état persisté et de l'instant fourni. Elles
 * sont donc directement testables (§59).
 */

import type { SourceDescriptor, SourceRuntimeState } from '@rentfinder/shared';

/** Décision prise pour une source lors d'un tick du scheduler. */
export interface ScheduleDecision {
  readonly sourceId: string;
  readonly shouldRun: boolean;
  /** Intervalle retenu après adaptation, en minutes. */
  readonly effectiveIntervalMinutes: number;
  /** Explication lisible, journalisée puis affichée dans la page d'état (§63). */
  readonly reason: string;
  /** Sert à ordonner les sources retenues quand le budget de run est limité. */
  readonly priority: number;
}

/**
 * Seuil au-delà duquel une source est considérée comme « active » et mérite
 * d'être interrogée plus souvent.
 */
const ACTIVE_THRESHOLD = 3;

/** Facteur d'espacement appliqué à chaque erreur consécutive. */
const ERROR_BACKOFF_FACTOR = 2;

/**
 * Calcule l'intervalle réel entre deux exécutions d'une source.
 *
 * L'adaptation est volontairement simple et monotone : plus la source produit,
 * plus on la voit ; plus elle échoue, moins on insiste.
 */
export function effectiveInterval(descriptor: SourceDescriptor, state: SourceRuntimeState): number {
  const { baseIntervalMinutes, minIntervalMinutes, maxIntervalMinutes } = descriptor.schedule;
  let interval = baseIntervalMinutes;

  // Source productive : on se rapproche du plancher.
  if (state.averageNewListingCount >= ACTIVE_THRESHOLD) {
    interval = Math.max(minIntervalMinutes, interval / 2);
  } else if (state.averageNewListingCount === 0 && state.lastSuccessAt !== null) {
    // Source qui ne sort plus rien : on l'espace progressivement.
    interval = Math.min(maxIntervalMinutes, interval * 2);
  }

  // Erreurs consécutives : espacement exponentiel, plafonné.
  if (state.consecutiveErrors > 0) {
    interval = Math.min(
      maxIntervalMinutes,
      interval * ERROR_BACKOFF_FACTOR ** state.consecutiveErrors,
    );
  }

  return Math.round(Math.max(minIntervalMinutes, Math.min(maxIntervalMinutes, interval)));
}

/** Décide si une source doit tourner maintenant. */
export function decideForSource(
  descriptor: SourceDescriptor,
  state: SourceRuntimeState,
  nowMs: number,
): ScheduleDecision {
  const interval = effectiveInterval(descriptor, state);
  const base = {
    sourceId: descriptor.id,
    effectiveIntervalMinutes: interval,
    priority: descriptor.priority,
  };

  if (!descriptor.enabled) {
    return { ...base, shouldRun: false, reason: 'source désactivée dans le registre' };
  }

  if (state.health === 'blocked') {
    // §10 : une source qui refuse l'accès automatisé n'est plus sollicitée.
    return { ...base, shouldRun: false, reason: 'source bloquée — accès automatisé refusé' };
  }

  if (state.health === 'disabled') {
    return { ...base, shouldRun: false, reason: 'source désactivée après échecs répétés' };
  }

  if (state.cooldownUntil !== null) {
    const until = Date.parse(state.cooldownUntil);
    if (Number.isFinite(until) && nowMs < until) {
      return { ...base, shouldRun: false, reason: 'cooldown en cours après HTTP 429' };
    }
  }

  if (state.lastRunAt === null) {
    return { ...base, shouldRun: true, reason: 'jamais exécutée' };
  }

  const lastRun = Date.parse(state.lastRunAt);
  if (!Number.isFinite(lastRun)) {
    return { ...base, shouldRun: true, reason: 'dernière exécution illisible' };
  }

  const elapsedMinutes = (nowMs - lastRun) / 60_000;
  if (elapsedMinutes >= interval) {
    return {
      ...base,
      shouldRun: true,
      reason: `${Math.round(elapsedMinutes)} min écoulées ≥ ${interval} min d'intervalle`,
    };
  }

  return {
    ...base,
    shouldRun: false,
    reason: `prochaine exécution dans ${Math.ceil(interval - elapsedMinutes)} min`,
  };
}

export interface PlanOptions {
  /**
   * Nombre maximal de sources exécutées lors d'un même run GitHub Actions.
   * Borne la durée du job et la consommation de minutes gratuites (§29, §30).
   */
  readonly maxSourcesPerRun: number;
}

export interface SchedulePlan {
  /** Sources à exécuter, déjà triées par priorité puis par ancienneté. */
  readonly selected: readonly ScheduleDecision[];
  /** Sources écartées, avec la raison — utile au diagnostic (§63). */
  readonly skipped: readonly ScheduleDecision[];
}

/**
 * Construit le plan d'exécution d'un tick.
 *
 * Les sources éligibles sont triées par priorité croissante (1 = prioritaire),
 * puis par ancienneté d'exécution, de sorte qu'aucune source ne soit
 * indéfiniment évincée par une voisine plus prioritaire.
 */
export function planRun(
  entries: readonly { descriptor: SourceDescriptor; state: SourceRuntimeState }[],
  nowMs: number,
  options: PlanOptions,
): SchedulePlan {
  const decisions = entries.map(({ descriptor, state }) => ({
    decision: decideForSource(descriptor, state, nowMs),
    state,
  }));

  const eligible = decisions
    .filter((entry) => entry.decision.shouldRun)
    .sort((a, b) => {
      if (a.decision.priority !== b.decision.priority) {
        return a.decision.priority - b.decision.priority;
      }
      const aRun = a.state.lastRunAt === null ? 0 : Date.parse(a.state.lastRunAt);
      const bRun = b.state.lastRunAt === null ? 0 : Date.parse(b.state.lastRunAt);
      return aRun - bRun;
    });

  const selected = eligible.slice(0, options.maxSourcesPerRun).map((entry) => entry.decision);
  const overflow = eligible.slice(options.maxSourcesPerRun).map((entry) => ({
    ...entry.decision,
    shouldRun: false,
    reason: 'reportée : quota de sources par run atteint',
  }));

  const skipped = [
    ...decisions.filter((entry) => !entry.decision.shouldRun).map((entry) => entry.decision),
    ...overflow,
  ];

  return { selected, skipped };
}
