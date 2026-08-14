/**
 * Tests du scheduler adaptatif (§7, §29).
 */

import { describe, expect, it } from 'vitest';
import type { SourceDescriptor, SourceRuntimeState } from '@rentfinder/shared';
import { budgetFor, scheduleFor } from '../core/budgets.js';
import { decideForSource, effectiveInterval, planRun } from './scheduler.js';

const NOW = Date.parse('2026-08-14T12:00:00.000Z');

function descriptor(overrides: Partial<SourceDescriptor> = {}): SourceDescriptor {
  return {
    id: 'test',
    name: 'Test',
    domain: 'example.invalid',
    kind: 'portal',
    method: 'html',
    priority: 1,
    schedule: scheduleFor('portal'),
    budget: budgetFor('portal'),
    enabled: true,
    manualOnly: false,
    allowedPaths: [],
    notes: '',
    ...overrides,
  };
}

function state(overrides: Partial<SourceRuntimeState> = {}): SourceRuntimeState {
  return {
    sourceId: 'test',
    health: 'healthy',
    lastRunAt: null,
    lastSuccessAt: null,
    last429At: null,
    lastBlockedAt: null,
    cooldownUntil: null,
    consecutiveErrors: 0,
    lastNewListingCount: 0,
    averageNewListingCount: 0,
    ...overrides,
  };
}

/** Instant situé `minutes` avant NOW. */
const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

describe('effectiveInterval', () => {
  it('part de l’intervalle de base', () => {
    // Une source jamais exécutée n'a pas encore de moyenne exploitable.
    expect(effectiveInterval(descriptor(), state())).toBe(20);
  });

  it('resserre l’intervalle pour une source productive', () => {
    const interval = effectiveInterval(descriptor(), state({ averageNewListingCount: 8 }));
    expect(interval).toBe(10);
    expect(interval).toBeGreaterThanOrEqual(descriptor().schedule.minIntervalMinutes);
  });

  it('espace l’intervalle pour une source qui ne produit plus rien', () => {
    const interval = effectiveInterval(
      descriptor(),
      state({ averageNewListingCount: 0, lastSuccessAt: minutesAgo(120) }),
    );
    expect(interval).toBe(40);
  });

  it('espace exponentiellement en cas d’erreurs consécutives', () => {
    const one = effectiveInterval(descriptor(), state({ consecutiveErrors: 1 }));
    const three = effectiveInterval(descriptor(), state({ consecutiveErrors: 3 }));
    expect(three).toBeGreaterThan(one);
  });

  it('ne dépasse jamais le plafond de la source', () => {
    const interval = effectiveInterval(descriptor(), state({ consecutiveErrors: 20 }));
    expect(interval).toBe(descriptor().schedule.maxIntervalMinutes);
  });

  it('respecte les fréquences plus lentes des agences locales (§7)', () => {
    const local = descriptor({ kind: 'localAgency', schedule: scheduleFor('localAgency') });
    expect(effectiveInterval(local, state())).toBe(120);
  });
});

describe('decideForSource', () => {
  it('exécute une source jamais lancée', () => {
    const decision = decideForSource(descriptor(), state(), NOW);
    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toBe('jamais exécutée');
  });

  it('n’exécute pas une source désactivée', () => {
    const decision = decideForSource(descriptor({ enabled: false }), state(), NOW);
    expect(decision.shouldRun).toBe(false);
  });

  it('n’exécute jamais une source bloquée (§10)', () => {
    // Une source qui refuse l'accès automatisé sort définitivement du roulement.
    const decision = decideForSource(descriptor(), state({ health: 'blocked' }), NOW);
    expect(decision.shouldRun).toBe(false);
    expect(decision.reason).toMatch(/bloquée/);
  });

  it('respecte le cooldown après un 429', () => {
    const decision = decideForSource(
      descriptor(),
      state({ health: 'cooldown', cooldownUntil: new Date(NOW + 600_000).toISOString() }),
      NOW,
    );
    expect(decision.shouldRun).toBe(false);
    expect(decision.reason).toMatch(/cooldown/);
  });

  it('reprend l’exécution une fois le cooldown expiré', () => {
    const decision = decideForSource(
      descriptor(),
      state({
        health: 'cooldown',
        cooldownUntil: new Date(NOW - 1_000).toISOString(),
        lastRunAt: minutesAgo(120),
      }),
      NOW,
    );
    expect(decision.shouldRun).toBe(true);
  });

  it('attend que l’intervalle soit écoulé', () => {
    const decision = decideForSource(descriptor(), state({ lastRunAt: minutesAgo(5) }), NOW);
    expect(decision.shouldRun).toBe(false);
    expect(decision.reason).toMatch(/prochaine exécution dans/);
  });

  it('exécute une fois l’intervalle dépassé', () => {
    const decision = decideForSource(descriptor(), state({ lastRunAt: minutesAgo(30) }), NOW);
    expect(decision.shouldRun).toBe(true);
  });
});

describe('planRun', () => {
  it('trie par priorité et borne le nombre de sources par run (§29)', () => {
    const entries = [
      { descriptor: descriptor({ id: 'c', priority: 3 }), state: state({ sourceId: 'c' }) },
      { descriptor: descriptor({ id: 'a', priority: 1 }), state: state({ sourceId: 'a' }) },
      { descriptor: descriptor({ id: 'b', priority: 2 }), state: state({ sourceId: 'b' }) },
    ];

    const plan = planRun(entries, NOW, { maxSourcesPerRun: 2 });
    expect(plan.selected.map((decision) => decision.sourceId)).toEqual(['a', 'b']);
    expect(plan.skipped.some((decision) => decision.sourceId === 'c')).toBe(true);
  });

  it('reporte les sources excédentaires avec une raison explicite', () => {
    const entries = Array.from({ length: 5 }, (_unused, index) => ({
      descriptor: descriptor({ id: `s${index}`, priority: 1 }),
      state: state({ sourceId: `s${index}` }),
    }));

    const plan = planRun(entries, NOW, { maxSourcesPerRun: 2 });
    expect(plan.selected).toHaveLength(2);
    expect(plan.skipped.filter((d) => d.reason.includes('quota de sources'))).toHaveLength(3);
  });

  it('départage les sources de même priorité par ancienneté d’exécution', () => {
    // Garantit qu'une source n'est jamais indéfiniment évincée.
    const entries = [
      {
        descriptor: descriptor({ id: 'recent', priority: 1 }),
        state: state({ sourceId: 'recent', lastRunAt: minutesAgo(30) }),
      },
      {
        descriptor: descriptor({ id: 'ancien', priority: 1 }),
        state: state({ sourceId: 'ancien', lastRunAt: minutesAgo(300) }),
      },
    ];

    const plan = planRun(entries, NOW, { maxSourcesPerRun: 1 });
    expect(plan.selected[0]?.sourceId).toBe('ancien');
  });

  it('n’exécute aucune source quand aucune n’est due', () => {
    const entries = [
      {
        descriptor: descriptor({ id: 'a' }),
        state: state({ sourceId: 'a', lastRunAt: minutesAgo(1) }),
      },
    ];
    expect(planRun(entries, NOW, { maxSourcesPerRun: 6 }).selected).toHaveLength(0);
  });
});
