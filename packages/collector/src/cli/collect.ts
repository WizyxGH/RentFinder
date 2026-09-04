/**
 * Commande : lancer un cycle de collecte (§29).
 *
 *   pnpm collect                 collecte normale
 *   pnpm collect -- --backfill   récupération volontaire d'annonces plus anciennes
 *   pnpm collect -- --verbose    ajoute le détail technique au journal
 *
 * Il n'y a PAS de `--dry-run` ici. L'en-tête en promettait un, que rien
 * n'implémentait : la collecte écrivait, notifiait, et disait le contraire.
 * Une collecte touche l'état des sources, les occurrences, le cycle de vie,
 * les fiches et les caches — la neutraliser à moitié serait pire que de ne
 * pas l'offrir. Le drapeau est donc refusé explicitement plutôt que ignoré en
 * silence ; `pnpm reprocess -- --dry-run`, lui, existe pour de bon.
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
  loadTransitConfig,
  loadImapConfig,
  withStoredCriteria,
} from '../config.js';
import { SEARCH_CRITERIA_SETTING } from '@rentfinder/shared';
import { resolveReferencePoints } from '../core/reference-points.js';
import { loadVapidConfig, sendWebPush } from '../notify/web-push.js';
import { dropRedundantNotifications } from '../notify/redundancy.js';
import { fetchAlertEmails } from '../core/email-import.js';
import { findUndiscoveredAgencies } from '../sources/email-alerts/agency-discovery.js';

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
  // Refus explicite : mieux vaut ne rien faire que faire l'inverse de ce
  // qu'on annonce. Voir l'en-tête.
  if (args.has('--dry-run')) {
    logger.error('collect.dry_run_unsupported', {
      reason:
        'la collecte écrit toujours ; utilisez `pnpm reprocess -- --dry-run` ' +
        'pour un essai à blanc sur les annonces déjà en base',
    });
    process.exitCode = 2;
    return;
  }

  const mode = args.has('--backfill') && backfillEnabled() ? 'backfill' : 'live';
  if (args.has('--backfill') && mode === 'live') {
    logger.warn('backfill.refused', {
      reason: 'BACKFILL_ENABLED n’est pas à true — exécution en mode live',
    });
  }

  // §66 : filtres lus depuis config/search.json (éditable), défauts en secours.
  const fileConfig = loadPublicConfig((message) => logger.warn('config.invalid', { message }));

  const db = openDatabaseFromEnv();

  try {
    await migrate(db, MIGRATIONS_DIR, logger);
    const repository = createRepository(db);

    // Les critères réglés DEPUIS LE SITE priment sur le fichier : le site
    // déployé n'a pas accès à cette machine, la base est leur seul point de
    // rencontre. Base vide → comportement d'avant, à l'identique.
    const config = withStoredCriteria(
      fileConfig,
      await repository.readSetting(SEARCH_CRITERIA_SETTING),
    );
    logger.info('config.loaded', {
      cities: config.criteria.cities,
      maxPrice: config.criteria.maxPrice,
      minArea: config.criteria.minArea,
      excludeFlatShare: config.criteria.excludeFlatShare ?? false,
    });

    // Points de référence : coordonnées explicites (§20), complétées par les
    // adresses géocodées une fois (REFERENCE_*_ADDRESS) — l'utilisateur peut
    // ainsi saisir « 12 rue X, Nice » au lieu de chercher ses coordonnées GPS.
    const referencePoints = await resolveReferencePoints({
      cache: repository.geocodeCache(),
      nowMs: systemClock.now(),
      logger,
    });

    // §20 : routage transports en commun si un jeton Navitia est configuré,
    // sinon estimation vol d'oiseau. `null` = simplement désactivé.
    const transitConfig = loadTransitConfig();
    if (transitConfig !== null) {
      logger.info('transit.enabled', { arrivalTime: transitConfig.arrivalTime });
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
      ...(transitConfig !== null ? { transitConfig } : {}),
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

    // §69 : un changement d'état de santé d'une source (dégradée/bloquée/
    // rétablie) est signalé dans le log de collecte — le panneau « Sources »
    // du site en donne le détail. Pas d'alerte poussée : la santé des sources
    // est une info d'exploitation, pas une nouveauté à signaler.
    for (const t of report.healthTransitions) {
      logger.warn('source.health_changed', {
        source: t.sourceId,
        from: t.from,
        to: t.to,
        listings: t.listingsFound,
      });
    }

    // §29 : alerte les nouvelles annonces par Web Push. Sans clés VAPID, le
    // canal est silencieusement désactivé (le collecteur et la CI tournent
    // sans). Les annonces parties sont marquées signalées dans la foulée :
    // sans quoi les mêmes repartiraient à chaque collecte, et l'historique
    // daté resterait vide.
    const vapid = loadVapidConfig();
    if (vapid !== null) {
      try {
        // Une alerte e-mail qui décrit le même bien qu'une source directe est
        // tue : la source directe porte un lien vers la vraie fiche, souvent un
        // téléphone, et les honoraires. Les deux fiches restent visibles sur le
        // site — seule la sonnerie en double disparaît (§29).
        const pending = dropRedundantNotifications(
          await repository.pendingNotifications(0),
          await repository.directListingSpecKeys(),
        );
        const report = await sendWebPush({
          repository,
          config: vapid,
          listings: pending,
          siteUrl: process.env['SITE_URL'] ?? 'https://wizyxgh.github.io/RentFinder/',
          logger,
        });
        await repository.markNotified(report.notifiedIds);
      } catch (error) {
        // Le notifieur ne fait jamais échouer une collecte réussie (§69).
        logger.warn('push.failed', {
          error: error instanceof Error ? error.message : 'erreur inconnue',
        });
      }
    }

    // §47 : repérage d'agences NON scrapées citées dans les e-mails de
    // confirmation (candidates à ajouter). Lecture seule, à chaque collecte,
    // silencieux si IMAP non configuré ou si rien de nouveau. Ne fait jamais
    // échouer la collecte (§69).
    const imap = loadImapConfig();
    if (imap !== null) {
      try {
        const bodies = await fetchAlertEmails({
          config: imap,
          log: (event, fields) => logger.debug(event, fields),
          sinceDays: 30,
        });
        const known = ALL_SCRAPERS.map((scraper) => scraper.descriptor.name);
        const agencies = findUndiscoveredAgencies(bodies, known);
        if (agencies.length > 0) logger.info('agencies.undiscovered', { agencies });
      } catch (error) {
        logger.debug('agencies.discovery_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
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
