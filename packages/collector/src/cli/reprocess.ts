/**
 * Commande : rejouer l'extraction et le scoring sur les données DÉJÀ EN BASE.
 *
 *   pnpm reprocess              rattrapage complet
 *   pnpm reprocess -- --dry-run montre ce qui changerait, sans rien écrire
 *
 * POURQUOI. Une annonce est normalisée UNE FOIS, le jour de sa collecte : la
 * valeur qu'on en a tirée dépend de ce que l'extraction savait faire ce jour-là.
 * Quand elle s'améliore — reconnaître « Rue Smolett » sans numéro, repérer un
 * bail étudiant de neuf mois — les annonces déjà en base n'en profitent pas, et
 * il faudrait attendre qu'elles soient recollectées, ce qui n'arrive jamais pour
 * une annonce stable.
 *
 * Cette commande ne sollicite AUCUNE source : elle relit le texte déjà stocké
 * (§30). Elle géocode en revanche les adresses nouvellement trouvées, sans quoi
 * elles n'apparaîtraient pas sur la carte — c'est le même étage que la collecte,
 * donc les mêmes plafonds et le même cache.
 *
 * PRUDENCE. Le rejeu ne RESSUSCITE rien : `updateDerivedFields` ne touche ni au
 * cycle de vie ni au compteur d'absence (§32), et n'écrase jamais une adresse
 * publiée par une source.
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
import { regroupAndScore } from '../pipeline.js';
import { rederiveFromText } from '../normalization/normalize.js';
import {
  collectorUserAgent,
  loadDotEnv,
  loadPublicConfig,
  loadTransitConfig,
  withStoredCriteria,
} from '../config.js';
import { SEARCH_CRITERIA_SETTING } from '@rentfinder/shared';
import { referencePointsDeclared, resolveReferencePoints } from '../core/reference-points.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../../../../database/migrations');

async function main(): Promise<void> {
  loadDotEnv();
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const jsonMode = process.env['LOG_FORMAT'] === 'json';
  const logger = createLogger({
    minLevel: args.has('--verbose') ? 'debug' : 'info',
    ...(jsonMode ? {} : { sink: narratorSink }),
  });

  if (!jsonMode) {
    console.log(
      `\n🧹 RentFinder — rattrapage des données existantes${dryRun ? ' (à blanc)' : ''}\n`,
    );
  }

  const fileConfig = loadPublicConfig((message) => logger.warn('config.invalid', { message }));
  const db = openDatabaseFromEnv();

  try {
    await migrate(db, MIGRATIONS_DIR, logger);
    const repository = createRepository(db);
    const config = withStoredCriteria(
      fileConfig,
      await repository.readSetting(SEARCH_CRITERIA_SETTING),
    );

    // --- 1. Réaligner les identifiants d'occurrence -------------------------
    //
    // Un changement passé du schéma de référence des alertes e-mail a laissé
    // des lignes dont l'id porte l'ancienne forme : toute re-collecte de ces
    // annonces échouait sur la contrainte d'unicité (source_id, source_ref).
    const realigned = dryRun ? 0 : await repository.realignOccurrenceIds();
    if (realigned > 0) logger.info('reprocess.ids_realigned', { occurrences: realigned });

    // --- 2. Absorber les fiches orphelines d'une fusion passée --------------
    const absorbed = dryRun ? 0 : await repository.absorbOrphanListings();
    if (absorbed > 0) logger.info('reprocess.orphans_absorbed', { listings: absorbed });

    // --- 3. Rejouer l'extraction sur le texte déjà stocké -------------------
    const corpus = await repository.allActiveOccurrences();
    const corrected = corpus
      .map((occurrence) => ({ before: occurrence, after: rederiveFromText(occurrence) }))
      .filter(
        (pair): pair is { before: (typeof corpus)[number]; after: (typeof corpus)[number] } =>
          pair.after !== null,
      );

    const addressesFound = corrected.filter(
      (pair) => pair.before.address === null && pair.after.address !== null,
    );
    logger.info('reprocess.rederived', {
      occurrences: corpus.length,
      changed: corrected.length,
      addressesFound: addressesFound.length,
    });
    for (const pair of addressesFound.slice(0, 20)) {
      logger.debug('reprocess.address', { id: pair.before.id, address: pair.after.address });
    }

    if (dryRun) {
      logger.info('reprocess.dry_run', { wouldUpdate: corrected.length });
      if (!jsonMode) {
        console.log(
          `\nÀ blanc : ${corrected.length} occurrence(s) seraient corrigées, ` +
            `dont ${addressesFound.length} adresse(s) retrouvée(s). Rien n'a été écrit.\n`,
        );
      }
      return;
    }

    const written = await repository.updateDerivedFields(corrected.map((pair) => pair.after));
    logger.info('reprocess.written', { occurrences: written });

    // --- 4. Regrouper, scorer, persister — le même étage que la collecte ----
    //
    // Les points de référence conditionnent les DISTANCES de chaque fiche. Les
    // résoudre à vide reviendrait à les effacer de tout l'inventaire : on
    // s'arrête plutôt que d'écrire une régression silencieuse (§17).
    const registry = createRegistry(ALL_SCRAPERS);
    const referencePoints = await resolveReferencePoints({
      cache: repository.geocodeCache(),
      nowMs: systemClock.now(),
      logger,
    });
    if (referencePoints.length === 0 && referencePointsDeclared()) {
      throw new Error(
        'Points de référence déclarés mais non résolus : rescoring interrompu ' +
          '(il effacerait les distances de toutes les fiches).',
      );
    }
    const transitConfig = loadTransitConfig();
    const report = await regroupAndScore(
      {
        registry,
        repository,
        config,
        referencePoints,
        userAgent: collectorUserAgent(),
        mode: 'live',
        clock: systemClock,
        logger,
        ...(transitConfig !== null ? { transitConfig } : {}),
      },
      systemClock.now(),
    );

    if (!jsonMode) {
      console.log(
        `\n✅ ${written} occurrence(s) corrigée(s), ${addressesFound.length} adresse(s) ` +
          `retrouvée(s) ; ${report.groups.length} fiche(s) rescorée(s) ` +
          `(${report.listingReport.updated} mise(s) à jour).\n`,
      );
    }
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
