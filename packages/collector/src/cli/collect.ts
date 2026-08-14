/**
 * Commande : lancer un cycle de collecte (§29).
 *
 *   pnpm collect                 collecte normale
 *   pnpm collect -- --backfill   récupération volontaire d'annonces plus anciennes
 *   pnpm collect -- --dry-run    exécute sans écrire en base
 *
 * C'est cette commande qu'appelle le workflow GitHub Actions. Elle ne prend
 * aucune décision : elle assemble les composants et délègue au pipeline.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDatabaseFromEnv } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { createRepository } from '../db/repository.js';
import { createRegistry } from '../core/registry.js';
import { createLogger } from '../core/logger.js';
import { systemClock } from '../core/clock.js';
import { ALL_SCRAPERS } from '../sources/index.js';
import { runPipeline } from '../pipeline.js';
import {
  backfillEnabled,
  collectorUserAgent,
  loadReferencePoints,
  PUBLIC_CONFIG,
} from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../../../../database/migrations');

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const logger = createLogger({ minLevel: args.has('--verbose') ? 'debug' : 'info' });

  // §8 : le backfill exige une intention explicite, en argument ET en
  // configuration. Une seule des deux ne suffit pas.
  const mode = args.has('--backfill') && backfillEnabled() ? 'backfill' : 'live';
  if (args.has('--backfill') && mode === 'live') {
    logger.warn('backfill.refused', {
      reason: 'BACKFILL_ENABLED n’est pas à true — exécution en mode live',
    });
  }

  const db = openDatabaseFromEnv();

  try {
    await migrate(db, MIGRATIONS_DIR, logger);

    const report = await runPipeline({
      registry: createRegistry(ALL_SCRAPERS),
      repository: createRepository(db),
      config: PUBLIC_CONFIG,
      referencePoints: loadReferencePoints(),
      userAgent: collectorUserAgent(),
      mode,
      clock: systemClock,
      logger,
    });

    logger.info('pipeline.done', {
      mode,
      sourcesRun: report.sourcesRun,
      collected: report.listingsCollected,
      groups: report.groupsFormed,
      written: report.written,
      durationMs: report.durationMs,
    });

    // Une source en échec ne fait pas échouer le run : c'est le principe
    // d'isolation (§69). On le signale sans changer le code de sortie.
    const failed = report.outcomes.filter((outcome) => !outcome.success);
    if (failed.length > 0) {
      logger.warn('pipeline.partial_failure', {
        sources: failed.map((outcome) => outcome.sourceId),
      });
    }
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
