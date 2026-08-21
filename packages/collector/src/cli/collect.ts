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
import { createLogger, narratorSink } from '../core/logger.js';
import { systemClock } from '../core/clock.js';
import { ALL_SCRAPERS } from '../sources/index.js';
import { runPipeline } from '../pipeline.js';
import {
  backfillEnabled,
  collectorUserAgent,
  loadDotEnv,
  loadPublicConfig,
  loadReferenceAddresses,
  loadReferencePoints,
  loadTelegramConfig,
} from '../config.js';
import { createGeocoder } from '../core/geocode.js';
import {
  notifyNewListings,
  editRentedTelegramMessages,
  notifySourceHealth,
} from '../notify/telegram.js';
import { pollTelegramReactions } from '../notify/reactions.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../../../../database/migrations');

async function main(): Promise<void> {
  // Charge la configuration privée locale (.env) avant toute lecture d'env.
  loadDotEnv();
  const args = new Set(process.argv.slice(2));
  // Sortie NARRÉE par défaut (phrases claires) ; `LOG_FORMAT=json` pour le
  // format structuré ; `--verbose` ajoute le détail technique (niveau debug).
  const jsonMode = process.env['LOG_FORMAT'] === 'json';
  const logger = createLogger({
    minLevel: args.has('--verbose') ? 'debug' : 'info',
    ...(jsonMode ? {} : { sink: narratorSink }),
  });

  if (!jsonMode) {
    const started = new Date().toLocaleTimeString('fr-FR');
    console.log(`\n🏠 RentFinder — collecte (${started})\n`);
  }

  // §8 : le backfill exige une intention explicite, en argument ET en
  // configuration. Une seule des deux ne suffit pas.
  const mode = args.has('--backfill') && backfillEnabled() ? 'backfill' : 'live';
  if (args.has('--backfill') && mode === 'live') {
    logger.warn('backfill.refused', {
      reason: 'BACKFILL_ENABLED n’est pas à true — exécution en mode live',
    });
  }

  // §66 : filtres lus depuis config/search.json (éditable), défauts en secours.
  const config = loadPublicConfig((message) => logger.warn('config.invalid', { message }));
  logger.info('config.loaded', {
    cities: config.criteria.cities,
    maxPrice: config.criteria.maxPrice,
    minArea: config.criteria.minArea,
    excludeFlatShare: config.criteria.excludeFlatShare ?? false,
  });

  const db = openDatabaseFromEnv();

  try {
    await migrate(db, MIGRATIONS_DIR, logger);
    const repository = createRepository(db);

    // Points de référence : coordonnées explicites (§20), complétées par les
    // adresses géocodées une fois (REFERENCE_*_ADDRESS) — l'utilisateur peut
    // ainsi saisir « 12 rue X, Nice » au lieu de chercher ses coordonnées GPS.
    const referencePoints = [...loadReferencePoints()];
    const toGeocode = loadReferenceAddresses();
    if (toGeocode.length > 0) {
      const geocoder = createGeocoder({
        cache: repository.geocodeCache(),
        nowMs: systemClock.now(),
        userAgent: collectorUserAgent(),
      });
      for (const point of toGeocode) {
        const coords = await geocoder.geocode(point.address);
        if (coords === null) {
          logger.warn('reference.geocode_failed', { label: point.label });
          continue;
        }
        referencePoints.push({
          label: point.label,
          latitude: coords.latitude,
          longitude: coords.longitude,
          mode: point.mode,
        });
      }
    }

    const report = await runPipeline({
      registry: createRegistry(ALL_SCRAPERS),
      repository,
      config,
      referencePoints,
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

    // §29 : pousse les nouvelles annonces sur Telegram, si configuré. Absent →
    // silencieusement désactivé (le collecteur et la CI tournent sans).
    const telegram = loadTelegramConfig();
    if (telegram !== null) {
      try {
        const notice = await notifyNewListings({ repository, config: telegram, logger });
        logger.info('notify.done', { ...notice });
        // §33 : un bien notifié puis loué voit son message édité en « LOUÉ ».
        await editRentedTelegramMessages({ repository, config: telegram, logger });
        // §69 : alerte quand une source se dégrade/se bloque (ou se rétablit) —
        // sinon un parseur cassé fait perdre des annonces en silence.
        await notifySourceHealth(telegram, report.healthTransitions, logger);
      } catch (error) {
        // Le notifieur ne doit jamais faire échouer la collecte (§69).
        logger.warn('notify.failed', {
          error: error instanceof Error ? error.message : 'erreur inconnue',
        });
      }
      // §29 : un ❤️ posé sur une annonce reçue la bascule en favori.
      const reactions = await pollTelegramReactions({ repository, config: telegram, logger });
      if (reactions.favorited > 0 || reactions.unfavorited > 0) {
        logger.info('reactions.done', { ...reactions });
      }
    }
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
