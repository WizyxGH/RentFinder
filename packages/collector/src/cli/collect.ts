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
import { databaseTarget, openDatabaseFromEnv } from '../db/client.js';
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
import {
  NOTIFICATION_PREFERENCES_SETTING,
  REFERENCE_POINTS_SETTING,
  SEARCH_CRITERIA_SETTING,
  parseNotificationPreferences,
} from '@rentfinder/shared';
import { resolveReferencePoints } from '../core/reference-points.js';
import type { Logger } from '../core/logger.js';
import type { NearMatch, NearMatchCriteria, Repository } from '../db/repository.js';
import type { VapidConfig } from '../notify/web-push.js';
import {
  goneContentFor,
  loadVapidConfig,
  nearMatchContentFor,
  reminderContentFor,
  sendListingAlerts,
  sendWebPush,
} from '../notify/web-push.js';
import { dropRedundantNotifications } from '../notify/redundancy.js';
import { fetchAlertEmails } from '../core/email-import.js';
import { findUndiscoveredAgencies } from '../sources/email-alerts/agency-discovery.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../../../../database/migrations');

/**
 * Au bout de combien de temps rappeler qu'un favori attend toujours.
 *
 * Vingt-quatre heures : assez pour ne pas harceler quelqu'un qui vient de
 * mettre un logement de côté en pensant appeler le soir même, assez court pour
 * que le rappel serve encore à quelque chose sur un marché où les biens
 * partent en deux ou trois jours.
 */
const APPLICATION_REMINDER_HOURS = 24;

/** Lit une valeur de réglage JSON, sans lever si elle est illisible (§69). */
function jsonOrNull(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Toutes les familles d'alertes, dans l'ordre où elles comptent.
 *
 * EXTRAITE DE `main`, qui avait fini par dépasser le seuil de complexité de ce
 * dépôt. Ce bloc a sa propre logique — lire des préférences, choisir quoi
 * envoyer, marquer ce qui est parti — sans rapport avec l'enchaînement de la
 * collecte.
 *
 * NE LÈVE JAMAIS (§69) : un canal secondaire ne doit pas faire échouer une
 * collecte réussie.
 */
async function notifyAll(deps: {
  readonly repository: Repository;
  readonly vapid: VapidConfig;
  readonly logger: Logger;
  /** Les critères actifs : nécessaires pour juger de la « proximité ». */
  readonly criteria: NearMatchCriteria;
}): Promise<void> {
  const { repository, vapid, logger, criteria } = deps;
  try {
    // CE DONT L'UTILISATEUR VEUT ÊTRE PRÉVENU (§29). Les préférences se
    // règlent depuis le site et se lisent ICI : filtrer côté navigateur
    // n'aurait rien filtré, la notification partant d'ici vers le service
    // de push sans passer par la page.
    const preferences = parseNotificationPreferences(
      jsonOrNull(await repository.readSetting(NOTIFICATION_PREFERENCES_SETTING)),
    );
    const siteUrl = process.env['SITE_URL'] ?? 'https://wizyxgh.github.io/RentFinder/';
    const common = { repository, config: vapid, siteUrl, logger };

    if (preferences.newListings) {
      // Une alerte e-mail qui décrit le même bien qu'une source directe est
      // tue : la source directe porte un lien vers la vraie fiche, souvent un
      // téléphone, et les honoraires. Les deux fiches restent visibles sur le
      // site — seule la sonnerie en double disparaît (§29).
      const pending = dropRedundantNotifications(
        await repository.pendingNotifications(0),
        await repository.directListingSpecKeys(),
      );
      const report = await sendWebPush({ ...common, listings: pending });
      await repository.markNotified(report.notifiedIds);
    }

    // JUSTE AU-DESSUS DES CRITÈRES, si l'utilisateur l'a demandé. Éteint par
    // défaut : c'est un élargissement de la recherche, pas un canal de plus.
    if (preferences.nearMatches) {
      const near = await repository.nearMatches({
        cities: [...criteria.cities],
        maxPrice: criteria.maxPrice,
        minArea: criteria.minArea,
      });
      const report = await sendListingAlerts({ ...common, listings: near }, (listing, url) =>
        nearMatchContentFor(listing as NearMatch, url),
      );
      await repository.markNotified(report.notifiedIds);
    }

    // UN FAVORI QUI DISPARAÎT. Il quittait la liste sans un mot : on
    // continuait d'attendre une réponse pour un bien déjà loué.
    if (preferences.favoriteGone) {
      const gone = await repository.goneFavorites();
      const report = await sendListingAlerts({ ...common, listings: gone }, goneContentFor);
      await repository.markGoneNotified(report.notifiedIds);
    }

    // UN FAVORI JAMAIS CONTACTÉ. Le marché ne patiente pas : mis de côté
    // lundi, oublié jusqu'à jeudi, c'est une occasion manquée faute d'un
    // rappel.
    if (preferences.applicationReminders) {
      const stale = await repository.staleFavorites(APPLICATION_REMINDER_HOURS);
      const report = await sendListingAlerts({ ...common, listings: stale }, reminderContentFor);
      await repository.markReminded(report.notifiedIds);
    }
  } catch (error) {
    logger.warn('push.failed', {
      error: error instanceof Error ? error.message : 'erreur inconnue',
    });
  }
}

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

  // §66 : défauts du projet, que les critères réglés depuis le site
  // remplacent juste en dessous. Il n’y a plus de fichier de configuration :
  // un réglage à deux domiciles est un réglage dont personne ne sait lequel
  // fait autorité.
  const fileConfig = loadPublicConfig((message) => logger.warn('config.invalid', { message }));

  // OÙ L'ON ÉCRIT, DIT AVANT D'ÉCRIRE. Sans `TURSO_DATABASE_URL`, la collecte
  // range tout dans un fichier local qu'aucune interface ne lit depuis le
  // retrait du serveur local : on lisait « 42 annonces collectées » et rien
  // n'apparaissait sur le site, sans que rien n'explique pourquoi.
  const target = databaseTarget();
  if (target.kind === 'local') {
    logger.warn('database.local_only', {
      url: target.url,
      message:
        'TURSO_DATABASE_URL absent : la collecte écrit dans un fichier local, ' +
        'que le site publié ne lit pas. Utile pour essayer un scraper ; sans effet visible ailleurs.',
    });
  }

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

    // Points de référence (§20) : ceux réglés depuis l'écran Paramètres s'ils
    // existent, sinon ceux de `.env`. Les adresses sont géocodées une fois puis
    // mises en cache — on saisit « 12 rue X, Nice », pas des coordonnées.
    const referencePoints = await resolveReferencePoints({
      cache: repository.geocodeCache(),
      nowMs: systemClock.now(),
      logger,
      stored: await repository.readSetting(REFERENCE_POINTS_SETTING),
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
      await notifyAll({ repository, vapid, logger, criteria: config.criteria });
    }

    // Élagage des journaux : ils ne servent qu'au diagnostic, et personne ne
    // les effaçait. L'échec n'a aucune conséquence — on réessaiera au prochain
    // passage (§69).
    try {
      const pruned = await repository.pruneLogs(systemClock.now());
      if (pruned > 0) logger.info('db.pruned', { rows: pruned });
    } catch (error) {
      logger.debug('db.prune_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
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
