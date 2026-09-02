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
  NormalizedListing,
  RawListing,
  ScoredListing,
  ScrapeContext,
  ScrapeResult,
  Scraper,
  SourceHealth,
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
import { scoreListing, scoreMatch } from './scoring/index.js';
import { createGeocoder, geocodeCacheKey } from './core/geocode.js';
import { createTransitRouter } from './core/transit.js';
import type { Coordinates } from './core/geo.js';
import type { AggregatedListing } from '@rentfinder/shared';
import type { Repository } from './db/repository.js';
import type { PublicConfig, ReferencePoint, TransitConfig } from './config.js';

/** Plafond d'appels réseau de géocodage par run (les adresses en cache sont gratuites, §30). */
const GEOCODE_NETWORK_BUDGET = 80;

/**
 * Plafond de biens routés par run vers un point transit : borne le nombre
 * d'appels Navitia (les résultats sont mis en cache, donc en régime établi
 * seuls les biens NOUVEAUX en consomment, §30).
 */
const TRANSIT_MAX_LISTINGS = 120;

/**
 * Construit la requête de géocodage d'un logement : uniquement s'il a une
 * adresse de rue (numéro/voie), jamais sur la seule ville (§17, §20).
 */
function geocodeQuery(listing: AggregatedListing): string | null {
  const address = listing.address.value;
  if (address === null || address.trim().length < 4) return null;
  const parts = [address, listing.postalCode.value, listing.city.value].filter(
    (part): part is string => part !== null && part.trim() !== '',
  );
  return parts.join(' ');
}

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
  /** Routage transports en commun (Navitia). Absent → estimation vol d'oiseau. */
  readonly transitConfig?: TransitConfig;
}

export interface SourceOutcome {
  readonly sourceId: string;
  readonly success: boolean;
  readonly result: ScrapeResult | null;
  readonly error: string | null;
}

/** Changement d'état de santé d'une source entre deux runs (§69, alerting). */
export interface SourceHealthTransition {
  readonly sourceId: string;
  readonly from: SourceHealth;
  readonly to: SourceHealth;
  readonly listingsFound: number;
  readonly error: string | null;
}

export interface PipelineReport {
  readonly sourcesRun: readonly string[];
  readonly sourcesSkipped: readonly { sourceId: string; reason: string }[];
  readonly outcomes: readonly SourceOutcome[];
  /** Sources dont l'état de santé a changé ce run (pour alerter, §69). */
  readonly healthTransitions: readonly SourceHealthTransition[];
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
      return http.get(url, init ?? {});
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

    // Un parser qui ne DÉCOUVRE plus rien alors qu'il a bien téléchargé des
    // pages signale un changement de structure : la source est dégradée, pas
    // morte (§69). « Découvrir » = de nouvelles annonces OU des références
    // confirmées : une source incrémentale (sitemap, liste à refs connues) qui
    // n'a rien de neuf mais confirme son stock reste saine — ne pas la marquer
    // dégradée à tort.
    const discovered = result.listings.length + (result.confirmedRefs?.length ?? 0);
    const degraded = result.pagesFetched > 0 && discovered === 0;

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

/**
 * Géocode les adresses des fiches qui n'ont pas de GPS mais une adresse de rue
 * (§20). Ne fait aucun appel réseau si aucun point de référence n'est configuré
 * ou si le budget réseau est épuisé — les adresses en cache restent gratuites
 * (§30). Retourne l'association fiche → coordonnées (ou `null` si non résolue).
 */
async function geocodeMissingAddresses(
  merged: readonly AggregatedListing[],
  options: PipelineOptions,
  nowMs: number,
): Promise<Map<string, Coordinates | null>> {
  const geocoded = new Map<string, Coordinates | null>();
  if (options.referencePoints.length === 0) return geocoded;

  const geocoder = createGeocoder({
    cache: options.repository.geocodeCache(),
    nowMs,
    userAgent: options.userAgent,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });
  let networkBudget = GEOCODE_NETWORK_BUDGET;
  for (const listing of merged) {
    // Seulement les annonces sans GPS mais avec une adresse de rue : géocoder
    // une simple ville donnerait un centre-ville trompeur (§17).
    if (listing.latitude.value !== null && listing.longitude.value !== null) continue;
    const query = geocodeQuery(listing);
    if (query === null) continue;

    const cached = await options.repository.geocodeCache().get(geocodeCacheKey(query));
    if (cached === null && networkBudget <= 0) continue; // budget réseau épuisé
    if (cached === null) networkBudget -= 1;

    geocoded.set(listing.id, await geocoder.geocode(query));
  }
  return geocoded;
}

/**
 * Calcule le temps de trajet RÉEL en transports en commun (Navitia) vers les
 * points de référence en mode `transit`, pour les biens géolocalisés qui
 * satisfont DÉJÀ les autres critères (§20, §30). Résultats mis en cache ;
 * ne route qu'un nombre borné de biens par run. Retourne, par fiche, la durée
 * par libellé de point. Vide si le routage n'est pas configuré.
 */
async function resolveTransitMinutes(
  merged: readonly AggregatedListing[],
  options: PipelineOptions,
  geocoded: ReadonlyMap<string, Coordinates | null>,
  nowMs: number,
): Promise<Map<string, Record<string, number>>> {
  const byListing = new Map<string, Record<string, number>>();
  const transitPoints = options.referencePoints.filter((point) => point.mode === 'transit');
  if (options.transitConfig === undefined || transitPoints.length === 0) return byListing;

  const router = createTransitRouter({
    token: options.transitConfig.token,
    arrivalTime: options.transitConfig.arrivalTime,
    cache: options.repository.transitCache(),
    nowMs,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  let routed = 0;
  for (const listing of merged) {
    if (routed >= TRANSIT_MAX_LISTINGS) break;
    const latitude = listing.latitude.value ?? geocoded.get(listing.id)?.latitude ?? null;
    const longitude = listing.longitude.value ?? geocoded.get(listing.id)?.longitude ?? null;
    if (latitude === null || longitude === null) continue;
    // On ne route que les candidats déjà retenus par les autres critères, pour
    // ne pas dépenser d'appels sur des biens de toute façon écartés (§30).
    if (!scoreMatch(listing, options.config.criteria).matchesCriteria) continue;

    routed += 1;
    const byLabel: Record<string, number> = {};
    for (const point of transitPoints) {
      const minutes = await router.arrivalMinutes({ latitude, longitude }, point);
      if (minutes !== null) byLabel[point.label] = minutes;
    }
    if (Object.keys(byLabel).length > 0) byListing.set(listing.id, byLabel);
  }
  return byListing;
}

/** Exécute un cycle complet de collecte. */
/**
 * Complète les annonces sans coordonnées par le contact GÉNÉRAL de l'agence.
 *
 * Beaucoup d'agences n'offrent qu'un formulaire sur leurs annonces, mais
 * publient leur ligne en pied de page. Cette ligne vaut mieux que rien : elle
 * permet d'appeler au lieu de remplir un formulaire et d'attendre.
 *
 * Ne remplace JAMAIS une coordonnée portée par l'annonce : celle-là vise le bon
 * interlocuteur, celle-ci l'accueil (§17).
 */
function withAgencyContact(
  listings: readonly NormalizedListing[],
  sourceId: string,
  scrapers: readonly Scraper[],
): NormalizedListing[] {
  const fallback = scrapers.find((s) => s.descriptor.id === sourceId)?.descriptor.agencyContact;
  if (fallback === undefined) return [...listings];

  return listings.map((listing) => {
    const phone = listing.contact.phone ?? fallback.phone ?? null;
    const email = listing.contact.email ?? fallback.email ?? null;
    if (phone === listing.contact.phone && email === listing.contact.email) return listing;
    return { ...listing, contact: { ...listing.contact, phone, email } };
  });
}

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
  const healthTransitions: SourceHealthTransition[] = [];
  const rawBySource = new Map<string, readonly RawListing[]>();
  const confirmedBySource = new Map<string, readonly string[]>();
  const rentedBySource = new Map<string, readonly string[]>();

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
      rentedBySource.set(decision.sourceId, outcome.result.rentedRefs ?? []);
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

    // Transition d'état de santé : c'est le changement (et non l'état stable)
    // qui mérite une alerte, pour ne pas répéter le même avertissement à chaque
    // run tant qu'une source reste dégradée.
    if (nextState.health !== undefined && nextState.health !== base.health) {
      healthTransitions.push({
        sourceId: decision.sourceId,
        from: base.health,
        to: nextState.health,
        listingsFound: outcome.result?.listings.length ?? 0,
        error: outcome.error,
      });
    }

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
    withAgencyContact(normalizeAll(raws, { sourceId, nowMs }), sourceId, scrapers),
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
  // Baisses de loyer des 14 derniers jours : signal d'opportunité (§17).
  const priceDropSince = new Date(nowMs - 14 * 24 * 60 * 60 * 1000).toISOString();
  const priceDroppedIds = await repository.recentPriceDropIds(priceDropSince);

  const merged = groups.map((group) => mergeGroup(group.occurrences));

  const geocoded = await geocodeMissingAddresses(merged, options, nowMs);
  if (geocoded.size > 0) {
    logger.info('pipeline.geocoded', {
      resolved: [...geocoded.values()].filter((c) => c !== null).length,
      attempted: geocoded.size,
    });
  }

  // Temps de trajet réel en transports en commun (Navitia), pour l'affichage
  // ET le plafond de trajet (maxCommuteMinutes → hors critères).
  const transitByListing = await resolveTransitMinutes(merged, options, geocoded, nowMs);
  if (transitByListing.size > 0) {
    logger.info('pipeline.transit_resolved', { listings: transitByListing.size });
  }

  const scored: ScoredListing[] = merged.map((listing) => {
    const coords = geocoded.get(listing.id) ?? null;
    // Coordonnées géocodées PERSISTÉES sur la fiche quand la source n'en
    // publie pas : la vue carte et le dédoublonnage en profitent. La
    // provenance « geocode » dit honnêtement d'où vient la valeur (§15).
    const enriched =
      coords !== null && listing.latitude.value === null
        ? {
            ...listing,
            latitude: {
              value: coords.latitude,
              sourceId: 'geocode',
              observedAt: new Date(nowMs).toISOString(),
              conflicts: [],
            },
            longitude: {
              value: coords.longitude,
              sourceId: 'geocode',
              observedAt: new Date(nowMs).toISOString(),
              conflicts: [],
            },
          }
        : listing;
    const transitMinutes = transitByListing.get(listing.id);
    return scoreListing(enriched, {
      criteria: config.criteria,
      nowMs,
      referencePricePerSqm: config.referencePricePerSqm,
      referencePoints: options.referencePoints,
      priceDroppedIds,
      resolvedCoordinates: coords,
      ...(transitMinutes !== undefined ? { resolvedTransitMinutes: transitMinutes } : {}),
    });
  });

  const listingReport = await repository.saveListings(scored);
  logger.info('pipeline.listings_written', { ...listingReport });

  // Instantané du jour : ces chiffres ne sont pas reconstituables après coup,
  // il faut les mesurer au moment où ils sont vrais (§33).
  await repository.recordDailyStat();

  // Biens signalés « déjà loués » : on les marque APRÈS l'écriture, pour que le
  // lien occurrence → fiche existe. Ils sortent de la liste active mais restent
  // en favori (grisés) et comptent dans les stats (§32, §33).
  let rentedMarked = 0;
  for (const [sourceId, refs] of rentedBySource) {
    if (refs.length > 0) rentedMarked += await repository.markRented(sourceId, refs);
  }
  if (rentedMarked > 0) logger.info('pipeline.rented_marked', { count: rentedMarked });

  return {
    sourcesRun: plan.selected.map((decision) => decision.sourceId),
    sourcesSkipped: plan.skipped.map((decision) => ({
      sourceId: decision.sourceId,
      reason: decision.reason,
    })),
    outcomes,
    healthTransitions,
    listingsCollected: normalized.length,
    groupsFormed: groups.length,
    comparisons: comparisonCount,
    occurrencesWritten: occurrenceReport,
    written: listingReport,
    durationMs: clock.now() - startedMs,
  };
}
