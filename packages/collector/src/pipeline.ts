/**
 * Pipeline de collecte (§29, §78).
 *
 *   COLLECTER → NORMALISER → DÉDOUBLONNER → SCORER → PERSISTER
 *
 * Deux garanties structurent ce fichier :
 *
 *   1. ISOLATION DES PANNES (§69, §76). Chaque source tourne dans son propre
 *      `try`. Une source cassée produit un avertissement et passe en `degraded`
 *      ou `blocked` ; les autres continuent et le run se termine normalement.
 *
 *   2. ÉCONOMIE (§6, §30). Le budget de chaque source est appliqué par le
 *      client HTTP ; le scheduler limite le nombre de sources par run ; la
 *      persistance compare avant d'écrire.
 */

import { randomUUID } from 'node:crypto';
import type {
  RawListing,
  ScrapeContext,
  ScrapeResult,
  Scraper,
  ScoredListing,
  SourceRuntimeState,
} from '@rentfinder/shared';
import type { Clock } from './core/clock.js';
import type { Logger } from './core/logger.js';
import { BlockedError, createHttpClient, RateLimitedError } from './core/http-client.js';
import type { SourceRegistry } from './core/registry.js';
import { planRun } from './scheduler/scheduler.js';
import { normalizeAll } from './normalization/normalize.js';
import { dedupe } from './deduplication/dedupe.js';
import { mergeGroup } from './deduplication/merge.js';
import { scoreListing } from './scoring/index.js';
import type { Repository } from './db/repository.js';
import type { PublicConfig, ReferencePoint } from './config.js';

export interface PipelineOptions {
  readonly registry: SourceRegistry;
  readonly repository: Repository;
  readonly config: PublicConfig;
  readonly referencePoints: readonly ReferencePoint[];
  readonly userAgent: string;
  readonly mode: 'live' | 'backfill';
  readonly clock: Clock;
  readonly logger: Logger;
  /** Injection de `fetch` — les tests n'accèdent jamais au réseau (§59). */
  readonly fetchImpl?: typeof fetch;
}

export interface SourceOutcome {
  readonly sourceId: string;
  readonly success: boolean;
  readonly result: ScrapeResult | null;
  readonly error: string | null;
}

export interface PipelineReport {
  readonly sourcesRun: readonly string[];
  readonly sourcesSkipped: readonly { sourceId: string; reason: string }[];
  readonly outcomes: readonly SourceOutcome[];
  readonly listingsCollected: number;
  readonly groupsFormed: number;
  readonly comparisons: number;
  /** Écritures au niveau des occurrences — mesure directe de l'économie (§30). */
  readonly occurrencesWritten: { inserted: number; updated: number; unchanged: number };
  /** Écritures au niveau des fiches agrégées. */
  readonly written: { inserted: number; updated: number; unchanged: number };
  readonly durationMs: number;
}

/**
 * Exécute une source et rend son résultat.
 * Ne lève jamais : les erreurs sont converties en `SourceOutcome` en échec,
 * afin qu'une source défaillante n'interrompe pas le run (§69).
 */
async function runSource(
  scraper: Scraper,
  options: PipelineOptions,
  knownRefs: ReadonlySet<string>,
): Promise<{ outcome: SourceOutcome; nextState: Partial<SourceRuntimeState> }> {
  const { descriptor } = scraper;
  const logger = options.logger.child({ source: descriptor.id });
  const startedAt = new Date(options.clock.now()).toISOString();

  const http = createHttpClient({
    budget: descriptor.budget,
    userAgent: options.userAgent,
    clock: options.clock,
    logger,
    cache: options.repository.httpCache(),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  let requestsUsed = 0;
  const context: ScrapeContext = {
    criteria: options.config.criteria,
    mode: options.mode,
    fetch: async (url, init) => {
      requestsUsed += 1;
      return http.get(url, init);
    },
    isKnown: (ref) => knownRefs.has(ref),
    log: (event, fields) => logger.debug(event, fields),
    shouldStop: () => requestsUsed >= descriptor.budget.maxPagesPerRun,
  };

  try {
    const result = await scraper.run(context);
    logger.info('source.completed', {
      listings: result.listings.length,
      requests: result.requestCount,
      pages: result.pagesFetched,
      stopReason: result.stopReason,
      warnings: result.warnings.length,
    });

    // Un parser qui ne rend plus rien alors qu'il a bien téléchargé des pages
    // signale un changement de structure : la source est dégradée, pas morte (§69).
    const degraded = result.pagesFetched > 0 && result.listings.length === 0;

    return {
      outcome: { sourceId: descriptor.id, success: true, result, error: null },
      nextState: {
        health: degraded ? 'degraded' : 'healthy',
        lastRunAt: startedAt,
        lastSuccessAt: new Date(options.clock.now()).toISOString(),
        consecutiveErrors: 0,
        lastNewListingCount: result.listings.length,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('source.failed', { error: message });

    if (error instanceof RateLimitedError) {
      const until = new Date(
        options.clock.now() + descriptor.budget.cooldownSecondsAfter429 * 1000,
      ).toISOString();
      return {
        outcome: { sourceId: descriptor.id, success: false, result: null, error: message },
        nextState: {
          health: 'cooldown',
          lastRunAt: startedAt,
          last429At: startedAt,
          cooldownUntil: until,
        },
      };
    }

    if (error instanceof BlockedError) {
      // §10 : on ne contourne pas. La source est retirée du roulement.
      return {
        outcome: { sourceId: descriptor.id, success: false, result: null, error: message },
        nextState: { health: 'blocked', lastRunAt: startedAt, lastBlockedAt: startedAt },
      };
    }

    return {
      outcome: { sourceId: descriptor.id, success: false, result: null, error: message },
      nextState: { health: 'degraded', lastRunAt: startedAt },
    };
  }
}

/** Moyenne glissante pondérée, pour lisser l'estimation d'activité (§7). */
function updateAverage(previous: number, latest: number): number {
  return Math.round((previous * 0.7 + latest * 0.3) * 100) / 100;
}

/** Exécute un cycle complet de collecte. */
export async function runPipeline(options: PipelineOptions): Promise<PipelineReport> {
  const { registry, repository, logger, clock, config } = options;
  const startedMs = clock.now();

  // --- 1. Quelles sources doivent tourner ? --------------------------------
  const scrapers = registry.enabled();
  const entries = await Promise.all(
    scrapers.map(async (scraper) => ({
      descriptor: scraper.descriptor,
      state: await repository.loadSourceState(scraper.descriptor.id),
    })),
  );

  const plan = planRun(entries, clock.now(), { maxSourcesPerRun: config.maxSourcesPerRun });
  logger.info('scheduler.plan', {
    selected: plan.selected.map((decision) => decision.sourceId),
    skipped: plan.skipped.length,
  });

  // --- 2. Collecte, source par source, en isolation -------------------------
  const outcomes: SourceOutcome[] = [];
  const rawBySource = new Map<string, readonly RawListing[]>();
  const confirmedBySource = new Map<string, readonly string[]>();

  for (const decision of plan.selected) {
    const scraper = registry.get(decision.sourceId);
    if (scraper === undefined) continue;

    const knownRefs = await repository.knownRefs(decision.sourceId);
    const previousState = entries.find((entry) => entry.descriptor.id === decision.sourceId)?.state;
    const { outcome, nextState } = await runSource(scraper, options, knownRefs);
    outcomes.push(outcome);

    if (outcome.result !== null) {
      rawBySource.set(decision.sourceId, outcome.result.listings);
      confirmedBySource.set(decision.sourceId, outcome.result.confirmedRefs ?? []);
    }

    const base = previousState ?? (await repository.loadSourceState(decision.sourceId));
    await repository.saveSourceState({
      ...base,
      ...nextState,
      consecutiveErrors: outcome.success ? 0 : base.consecutiveErrors + 1,
      averageNewListingCount: updateAverage(
        base.averageNewListingCount,
        outcome.result?.listings.length ?? 0,
      ),
    });

    if (outcome.result !== null) {
      await repository.recordRun({
        id: randomUUID(),
        sourceId: decision.sourceId,
        startedAt: new Date(startedMs).toISOString(),
        finishedAt: new Date(clock.now()).toISOString(),
        requestCount: outcome.result.requestCount,
        pagesFetched: outcome.result.pagesFetched,
        listingsFound: outcome.result.listings.length,
        listingsNew: outcome.result.listings.filter((l) => !knownRefs.has(l.sourceRef)).length,
        listingsUpdated: 0,
        duplicates: 0,
        errors: outcome.success ? 0 : 1,
        stopReason: outcome.result.stopReason,
        warnings: outcome.result.warnings,
      });
    }
  }

  // --- 3. Normalisation -----------------------------------------------------
  const nowMs = clock.now();
  const normalized = [...rawBySource.entries()].flatMap(([sourceId, raws]) =>
    normalizeAll(raws, { sourceId, nowMs }),
  );
  logger.info('pipeline.normalized', { count: normalized.length });

  // --- 4. Persistance des occurrences --------------------------------------
  const occurrenceReport = await repository.upsertOccurrences(normalized);
  logger.info('pipeline.occurrences_written', { ...occurrenceReport });

  // Cycle de vie des annonces non revues, source par source (§32). Les refs
  // confirmées par la source sans re-téléchargement (sitemap) comptent comme
  // vues : leur fiche n'a pas été visitée, mais la source les dit publiées.
  for (const [sourceId, raws] of rawBySource) {
    const seen = new Set(raws.map((raw) => raw.sourceRef));
    for (const ref of confirmedBySource.get(sourceId) ?? []) seen.add(ref);
    await repository.markMissing(sourceId, seen, {
      possiblyInactiveAfter: config.missingRunsBeforePossiblyInactive,
      inactiveAfter: config.missingRunsBeforeInactive,
    });
  }

  // --- 5. Dédoublonnage sur l'ensemble du corpus ----------------------------
  // Le regroupement porte sur toutes les annonces vivantes, pas seulement sur
  // celles du run : une annonce collectée aujourd'hui peut être le doublon
  // d'une annonce vue la semaine dernière sur une autre source (§13).
  const corpus = await repository.allActiveOccurrences();
  const { groups, comparisonCount } = dedupe(corpus);
  logger.info('pipeline.deduplicated', { groups: groups.length, comparisons: comparisonCount });

  // --- 6. Fusion et scoring -------------------------------------------------
  const scored: ScoredListing[] = groups.map((group) =>
    scoreListing(mergeGroup(group.occurrences), {
      criteria: config.criteria,
      nowMs,
      referencePricePerSqm: config.referencePricePerSqm,
      referencePoints: options.referencePoints,
    }),
  );

  const listingReport = await repository.saveListings(scored);
  logger.info('pipeline.listings_written', { ...listingReport });

  return {
    sourcesRun: plan.selected.map((decision) => decision.sourceId),
    sourcesSkipped: plan.skipped.map((decision) => ({
      sourceId: decision.sourceId,
      reason: decision.reason,
    })),
    outcomes,
    listingsCollected: normalized.length,
    groupsFormed: groups.length,
    comparisons: comparisonCount,
    occurrencesWritten: occurrenceReport,
    written: listingReport,
    durationMs: clock.now() - startedMs,
  };
}
