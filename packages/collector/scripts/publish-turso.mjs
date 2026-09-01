/**
 * Publie la base LOCALE vers Turso, pour que l'interface hébergée puisse la
 * lire (§26, §28).
 *
 * PRINCIPE : on ne pousse QUE ce que l'interface affiche. Tout le reste reste
 * sur la machine. Ce n'est pas une réplication, c'est une publication.
 *
 * Les tables volontairement EXCLUES, et pourquoi :
 *
 *  - `geocode_cache` / `transit_cache` : elles contiennent les adresses de
 *    RÉFÉRENCE géocodées — domicile, travail. C'est la donnée la plus
 *    personnelle du projet, et l'interface n'en a aucun besoin : elle ne reçoit
 *    que des libellés neutres (« Travail ») avec une distance et une durée.
 *  - `contact_attempts` : l'historique de qui a été contacté, et quand.
 *  - `telegram_notifications` / `telegram_state` : identifiants de conversation.
 *  - `http_cache` : sans objet à distance, et volumineux.
 *  - `events`, `collection_runs` : journal d'exploitation local.
 *
 * Utilisation :
 *   1. `wsl ~/.turso/turso auth login` puis `turso db create rentfinder`
 *   2. renseigner TURSO_DATABASE_URL / TURSO_AUTH_TOKEN dans `.env`
 *   3. `pnpm publish:turso`  (ou `node packages/collector/scripts/publish-turso.mjs`)
 *
 * `--dry-run` montre ce qui serait publié sans rien écrire.
 */

import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Le script vit dans le paquet collector (c'est lui qui porte @libsql/client) ;
// la racine du dépôt est trois niveaux au-dessus.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Lit `.env` sans dépendance, pour rester utilisable seul. */
function loadEnv() {
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/*
 * POURQUOI LES DISTANCES SONT PUBLIÉES TELLES QUELLES.
 *
 * Chaque fiche porte ses coordonnées et sa distance au point « Travail » au
 * centième de kilomètre : trois fiches suffisent, en principe, à retrouver ce
 * point par trilatération. Une version de ce script arrondissait donc les
 * durées et retirait la distance.
 *
 * Ce n'est plus le cas, sur décision de l'utilisateur : la protection est
 * portée par l'ACCÈS, pas par la dégradation de la donnée. L'API (voir
 * `packages/api`) exige un jeton porteur sur TOUTES les routes — le contrôle
 * est fait à l'entrée, avant le routage, avec une comparaison à temps constant,
 * une origine CORS explicite (jamais `*`), et un refus par défaut si le jeton
 * n'est pas configuré côté serveur. Les données publiées ne sont donc jamais
 * accessibles publiquement.
 *
 * Cette garantie repose entièrement sur le secret du jeton `API_ACCESS_TOKEN` :
 * s'il fuite, le lieu de travail redevient calculable. À régénérer au moindre
 * doute (`npx wrangler secret put API_ACCESS_TOKEN`).
 */

/** Les seules tables publiées, dans un ordre qui respecte les dépendances. */
const PUBLISHED_TABLES = ['listings', 'occurrences', 'source_state'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const env = { ...loadEnv(), ...process.env };
  const url = env['TURSO_DATABASE_URL'];
  const token = env['TURSO_AUTH_TOKEN'];

  if (!dryRun && (!url || !token)) {
    console.error(
      '✋ TURSO_DATABASE_URL et TURSO_AUTH_TOKEN sont requis dans .env.\n' +
        '   Créez la base : wsl ~/.turso/turso auth login puis turso db create rentfinder',
    );
    process.exit(1);
  }

  const local = createClient({ url: `file:${resolve(ROOT, 'data/local.db')}` });

  console.log('📤 Publication vers Turso — tables publiées :', PUBLISHED_TABLES.join(', '));
  console.log('   Exclues (données personnelles ou sans objet) : geocode_cache, transit_cache,');
  console.log('   contact_attempts, telegram_notifications, telegram_state, http_cache, events.\n');

  const rowsByTable = {};
  for (const table of PUBLISHED_TABLES) {
    const count = await local.execute(`SELECT COUNT(*) AS n FROM ${table}`);
    rowsByTable[table] = Number(count.rows[0].n);
    console.log(`   ${table} : ${rowsByTable[table]} ligne(s)`);
  }

  if (dryRun) {
    console.log('\n(--dry-run : rien n’a été écrit)');
    return;
  }

  const remote = createClient({ url, authToken: token });

  // Vérification d'écriture AVANT de commencer : une base Turso revenue en
  // lecture seule (quota dépassé) échouerait au milieu du transfert.
  try {
    await remote.execute('CREATE TABLE IF NOT EXISTS _publish_probe (id INTEGER PRIMARY KEY)');
    await remote.execute('DROP TABLE _publish_probe');
  } catch (error) {
    console.error(
      '✋ La base distante refuse l’écriture (lecture seule ou quota dépassé) :\n   ' +
        (error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }

  for (const table of PUBLISHED_TABLES) {
    const schema = await local.execute({
      sql: 'SELECT sql FROM sqlite_master WHERE type = ? AND name = ?',
      args: ['table', table],
    });
    const createSql = schema.rows[0]?.sql;
    if (typeof createSql !== 'string') {
      console.warn(`   ⚠️  ${table} : schéma introuvable, ignorée`);
      continue;
    }

    await remote.execute(`DROP TABLE IF EXISTS ${table}`);
    await remote.execute(createSql);

    const all = await local.execute(`SELECT * FROM ${table}`);
    if (all.rows.length === 0) {
      console.log(`   ${table} : vide`);
      continue;
    }

    const columns = all.columns;
    const placeholders = columns.map(() => '?').join(', ');
    const insert = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

    // Par lots : une transaction géante saturerait la mémoire et le quota.
    const BATCH = 200;
    for (let i = 0; i < all.rows.length; i += BATCH) {
      const slice = all.rows.slice(i, i + BATCH);
      await remote.batch(
        slice.map((row) => ({
          sql: insert,
          args: columns.map((c) => row[c] ?? null),
        })),
        'write',
      );
    }
    console.log(`   ${table} : ${all.rows.length} ligne(s) publiée(s)`);
  }

  console.log('\n✅ Publication terminée.');
}

main().catch((error) => {
  console.error('Échec de la publication :', error);
  process.exit(1);
});
