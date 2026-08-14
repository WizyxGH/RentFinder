/**
 * @rentfinder/collector — API publique du collecteur.
 *
 * Ce paquet regroupe la collecte, la normalisation, le dédoublonnage, le
 * scoring et la persistance. Il est utilisable comme bibliothèque (tests,
 * scripts) ou via ses commandes (`src/cli/`).
 */

export * from './config.js';
export * from './pipeline.js';

export { createLogger, silentLogger, redact, type Logger } from './core/logger.js';
export { systemClock, createTestClock, type Clock, type TestClock } from './core/clock.js';
export { createRegistry, type SourceRegistry } from './core/registry.js';
export { createRateLimiter, type RateLimiter } from './core/rate-limiter.js';
export {
  createHttpClient,
  createMemoryCacheStore,
  BlockedError,
  RateLimitedError,
  type HttpCacheStore,
} from './core/http-client.js';
export { budgetFor, scheduleFor, DEFAULT_BUDGET } from './core/budgets.js';
export { haversineKm, estimateDurationMinutes, type TravelMode } from './core/geo.js';

export { decideForSource, effectiveInterval, planRun } from './scheduler/scheduler.js';

export { normalizeListing, normalizeAll, occurrenceId } from './normalization/normalize.js';
export { cleanText, comparable, slugify, tokenize } from './normalization/text.js';
export { parseFrenchNumber, extractNumber } from './normalization/parse-number.js';
export * from './normalization/parse-listing-fields.js';

export { similarity, jaccard, DUPLICATE_THRESHOLD } from './deduplication/similarity.js';
export { dedupe, blockingKeys } from './deduplication/dedupe.js';
export { mergeGroup, mergeContacts, pickPrimary } from './deduplication/merge.js';

export * from './scoring/index.js';

// La génération de message vit dans @rentfinder/shared : le frontend l'utilise
// aussi pour le mode manuel (§22, §24).
export { prepareMessage, TEMPLATES, type PreparedMessage } from '@rentfinder/shared';
export { evaluateAutoContact, type AutoContactDecision } from './contact/guards.js';

export { openDatabase, openDatabaseFromEnv, type Database } from './db/client.js';
export { migrate, loadMigrations, splitStatements } from './db/migrate.js';
export { createRepository, occurrenceHash, listingHash, type Repository } from './db/repository.js';

export { ALL_SCRAPERS, laforetScraper, LAFORET_DESCRIPTOR } from './sources/index.js';
