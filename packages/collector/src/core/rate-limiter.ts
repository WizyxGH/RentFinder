/**
 * Limiteur de débit par source (§10).
 *
 * Trois contraintes cumulées, toutes appliquées avant chaque requête :
 *   1. un délai minimal entre deux requêtes, augmenté d'un jitter ;
 *   2. un plafond glissant de requêtes par minute ;
 *   3. une mise au repos (cooldown) après un HTTP 429.
 *
 * Le limiteur ne « rattrape » jamais son retard : s'il a dormi, il repart du
 * temps réel. L'objectif est la longévité de l'accès, pas le débit (§10).
 */

import type { RateLimitBudget } from '@rentfinder/shared';
import type { Clock } from './clock.js';

/** Erreur levée quand la source est en repos forcé. */
export class CooldownError extends Error {
  constructor(public readonly until: number) {
    super(`Source en cooldown jusqu'à ${new Date(until).toISOString()}`);
    this.name = 'CooldownError';
  }
}

export interface RateLimiter {
  /** Attend jusqu'à ce qu'une requête soit autorisée. */
  acquire(): Promise<void>;
  /** Signale un HTTP 429 : déclenche la mise au repos prévue par le budget. */
  register429(): void;
  /** Instant de fin de cooldown, ou `null` si la source est disponible. */
  cooldownUntil(): number | null;
  /** Calcule l'attente d'une nouvelle tentative, backoff exponentiel (§10). */
  backoffDelayMs(attempt: number): number;
  /** Nombre de requêtes émises depuis la création. */
  requestCount(): number;
}

/**
 * Proportion du délai de base ajoutée aléatoirement.
 * 25 % suffit à désynchroniser les exécutions sans ralentir notablement.
 */
const JITTER_RATIO = 0.25;

export function createRateLimiter(budget: RateLimitBudget, clock: Clock): RateLimiter {
  /** Horodatages des requêtes de la dernière minute glissante. */
  let recentRequests: number[] = [];
  let lastRequestAt: number | null = null;
  let cooldownUntilMs: number | null = null;
  let total = 0;

  const minuteWindowMs = 60_000;

  function pruneWindow(now: number): void {
    recentRequests = recentRequests.filter((at) => now - at < minuteWindowMs);
  }

  /** Délai à respecter avant la prochaine requête, en millisecondes. */
  function computeWaitMs(now: number): number {
    // 1. Cooldown après 429 : prioritaire sur tout le reste.
    if (cooldownUntilMs !== null && now < cooldownUntilMs) {
      return cooldownUntilMs - now;
    }

    // 2. Délai minimal entre deux requêtes, plus jitter.
    let wait = 0;
    if (lastRequestAt !== null) {
      const jitter = budget.delayBetweenRequestsMs * JITTER_RATIO * clock.random();
      const target = lastRequestAt + budget.delayBetweenRequestsMs + jitter;
      wait = Math.max(0, target - now);
    }

    // 3. Plafond par minute : on attend l'expiration de la plus ancienne requête.
    pruneWindow(now);
    if (recentRequests.length >= budget.requestsPerMinute) {
      const oldest = recentRequests[0];
      if (oldest !== undefined) {
        wait = Math.max(wait, oldest + minuteWindowMs - now);
      }
    }

    return wait;
  }

  return {
    async acquire(): Promise<void> {
      // Une seule itération suffit tant que le limiteur est utilisé
      // séquentiellement ; la boucle protège les usages concurrents.
      for (let guard = 0; guard < 10; guard += 1) {
        const now = clock.now();
        const wait = computeWaitMs(now);
        if (wait <= 0) break;
        await clock.sleep(wait);
      }

      const now = clock.now();
      lastRequestAt = now;
      recentRequests.push(now);
      total += 1;
    },

    register429(): void {
      cooldownUntilMs = clock.now() + budget.cooldownSecondsAfter429 * 1000;
    },

    cooldownUntil(): number | null {
      if (cooldownUntilMs === null) return null;
      return clock.now() < cooldownUntilMs ? cooldownUntilMs : null;
    },

    backoffDelayMs(attempt: number): number {
      const base = budget.delayBetweenRequestsMs * budget.backoffFactor ** Math.max(0, attempt);
      const jitter = base * JITTER_RATIO * clock.random();
      // Plafond de sécurité : une tentative n'attend jamais plus de 2 minutes.
      return Math.min(120_000, Math.round(base + jitter));
    },

    requestCount(): number {
      return total;
    },
  };
}
