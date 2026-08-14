/**
 * Budgets et fréquences par défaut, par famille de source (§7, §10).
 *
 * Aucune de ces valeurs n'est codée en dur dans un scraper : une source part
 * du gabarit de sa famille et surcharge uniquement ce qui la distingue. C'est
 * ce qui permet de régler la pression de collecte sans toucher au code.
 */

import type { RateLimitBudget, SourceKind, SourceSchedule } from '@rentfinder/shared';

/**
 * Budget prudent servant de base commune.
 * Un délai d'une seconde et une seule requête à la fois : on privilégie la
 * longévité de l'accès plutôt que la vitesse (§10).
 */
export const DEFAULT_BUDGET: RateLimitBudget = {
  requestsPerMinute: 20,
  delayBetweenRequestsMs: 1_500,
  maxConcurrentRequests: 1,
  maxPagesPerRun: 3,
  maxListingsPerRun: 120,
  retryLimit: 2,
  backoffFactor: 3,
  cooldownSecondsAfter429: 3_600,
  maxConsecutiveErrors: 3,
};

/**
 * Fréquences indicatives par famille (§7).
 *
 * Ce ne sont que des points de départ : le scheduler ajuste ensuite en fonction
 * de ce que la source produit réellement.
 */
export const SCHEDULE_BY_KIND: Record<SourceKind, SourceSchedule> = {
  // Portails à fort volume : ce sont eux qui bougent le plus vite.
  portal: { baseIntervalMinutes: 20, minIntervalMinutes: 10, maxIntervalMinutes: 180 },
  // Réseaux d'agences : renouvellement plus lent, volume moyen.
  agencyNetwork: { baseIntervalMinutes: 45, minIntervalMinutes: 30, maxIntervalMinutes: 360 },
  // Agences locales : peu d'annonces, mais souvent exclusives (§3).
  localAgency: { baseIntervalMinutes: 120, minIntervalMinutes: 60, maxIntervalMinutes: 1_440 },
  // Agrégateurs : redondants avec les portails, donc peu prioritaires.
  aggregator: { baseIntervalMinutes: 60, minIntervalMinutes: 30, maxIntervalMinutes: 720 },
};

/** Budgets ajustés par famille, dérivés du gabarit prudent. */
export const BUDGET_BY_KIND: Record<SourceKind, RateLimitBudget> = {
  portal: { ...DEFAULT_BUDGET, requestsPerMinute: 20, maxPagesPerRun: 3 },
  agencyNetwork: { ...DEFAULT_BUDGET, requestsPerMinute: 15, maxPagesPerRun: 4 },
  // Les petits sites d'agence encaissent mal la charge : on ralentit nettement.
  localAgency: {
    ...DEFAULT_BUDGET,
    requestsPerMinute: 6,
    delayBetweenRequestsMs: 4_000,
    maxPagesPerRun: 2,
    maxListingsPerRun: 40,
  },
  aggregator: { ...DEFAULT_BUDGET, requestsPerMinute: 12, maxPagesPerRun: 2 },
};

/** Compose un budget à partir de la famille et de quelques surcharges. */
export function budgetFor(
  kind: SourceKind,
  overrides: Partial<RateLimitBudget> = {},
): RateLimitBudget {
  return { ...BUDGET_BY_KIND[kind], ...overrides };
}

/** Compose une fréquence à partir de la famille et de quelques surcharges. */
export function scheduleFor(
  kind: SourceKind,
  overrides: Partial<SourceSchedule> = {},
): SourceSchedule {
  return { ...SCHEDULE_BY_KIND[kind], ...overrides };
}
