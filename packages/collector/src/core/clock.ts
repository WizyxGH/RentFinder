/**
 * Horloge et attente injectables.
 *
 * §59 : les tests doivent être déterministes et ne jamais dépendre de l'heure
 * réelle ni attendre pour de vrai. Tout code qui a besoin de « maintenant » ou
 * d'un délai passe par cette abstraction.
 */

export interface Clock {
  /** Millisecondes depuis l'époque Unix. */
  now(): number;
  /** Attend `ms` millisecondes. */
  sleep(ms: number): Promise<void>;
  /** Valeur dans [0, 1), utilisée pour le jitter. */
  random(): number;
}

/** Horloge réelle, utilisée en production. */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
  random: () => Math.random(),
};

/**
 * Horloge contrôlée pour les tests : le temps n'avance que sur `advance()`, et
 * `sleep()` se résout immédiatement en enregistrant la durée demandée.
 *
 * @example
 * const clock = createTestClock({ startMs: 0, random: 0.5 });
 * await limiter.acquire();           // ne bloque pas réellement
 * expect(clock.sleptMs).toEqual([0]); // mais on vérifie l'attente demandée
 */
export interface TestClock extends Clock {
  /** Durées passées à `sleep`, dans l'ordre. */
  readonly sleptMs: number[];
  /** Avance l'horloge sans attendre. */
  advance(ms: number): void;
  /** Fixe la prochaine valeur rendue par `random()`. */
  setRandom(value: number): void;
}

export function createTestClock(options: { startMs?: number; random?: number } = {}): TestClock {
  let current = options.startMs ?? 0;
  let randomValue = options.random ?? 0;
  const sleptMs: number[] = [];

  return {
    now: () => current,
    async sleep(ms: number) {
      sleptMs.push(ms);
      current += Math.max(0, ms);
    },
    random: () => randomValue,
    sleptMs,
    advance(ms: number) {
      current += ms;
    },
    setRandom(value: number) {
      randomValue = value;
    },
  };
}
