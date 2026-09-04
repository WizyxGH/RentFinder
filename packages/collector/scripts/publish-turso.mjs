/**
 * Publie la base LOCALE vers Turso, pour que l'interface hébergée la lise (§26).
 *
 * Le SCHÉMA part en entier — le collecteur cloud a besoin de toutes les tables
 * pour tourner — mais seules quelques-unes emportent leurs DONNÉES. Les autres
 * arrivent vides : leur contenu est personnel (adresses géocodées, historique
 * de contacts) ou sans objet à distance.
 *
 * Mise en place : voir docs/deployment.md. `--dry-run` montre sans écrire.
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
 * Les distances aux points de référence partent TELLES QUELLES. Combinées aux
 * coordonnées des annonces, elles rendent le point « Travail » calculable par
 * trilatération : la protection repose donc sur l'accès (jeton obligatoire),
 * pas sur la dégradation de la donnée. Si le jeton fuite, ce lieu redevient
 * calculable.
 */

/**
 * Tables dont les DONNÉES sont publiées.
 *
 * `schema_migrations` en fait partie : les tables partent avec leur schéma
 * final, migrations déjà appliquées. Sans le registre, la base distante croit
 * repartir de zéro et rejoue tout — « duplicate column name ».
 */
const DATA_TABLES = ['schema_migrations', 'listings', 'occurrences', 'source_state'];

/** Les tables internes de SQLite ne se recréent pas. */
const isPublishable = (name) => !name.startsWith('sqlite_') && !name.startsWith('_');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const env = { ...loadEnv(), ...process.env };
  const url = env['TURSO_DATABASE_URL'];
  const token = env['TURSO_AUTH_TOKEN'];

  if (!dryRun && (!url || !token)) {
    console.error('✋ TURSO_DATABASE_URL et TURSO_AUTH_TOKEN sont requis dans .env.');
    process.exit(1);
  }

  const local = createClient({ url: `file:${resolve(ROOT, 'data/local.db')}` });

  const schema = await local.execute(
    "SELECT name, sql, type FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END",
  );
  const tables = schema.rows.filter((r) => r.type === 'table' && isPublishable(String(r.name)));

  console.log('📤 Publication vers Turso');
  console.log(`   ${tables.length} table(s) — données pour : ${DATA_TABLES.join(', ')}\n`);

  for (const { name } of tables) {
    if (DATA_TABLES.includes(String(name))) {
      const count = await local.execute(`SELECT COUNT(*) AS n FROM ${name}`);
      console.log(`   ${name} : ${count.rows[0].n} ligne(s)`);
    } else {
      console.log(`   ${name} : schéma seul (contenu personnel ou local)`);
    }
  }

  if (dryRun) {
    console.log('\n(--dry-run : rien n’a été écrit)');
    return;
  }

  const remote = createClient({ url, authToken: token });

  // Sonde d'écriture AVANT de commencer : une base revenue en lecture seule
  // échouerait sinon au milieu du transfert.
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

  for (const { name, sql } of tables) {
    await remote.execute(`DROP TABLE IF EXISTS ${name}`);
    await remote.execute(String(sql));
    if (!DATA_TABLES.includes(String(name))) continue;

    const all = await local.execute(`SELECT * FROM ${name}`);
    if (all.rows.length === 0) continue;

    const columns = all.columns;
    const insert = `INSERT INTO ${name} (${columns.join(', ')}) VALUES (${columns
      .map(() => '?')
      .join(', ')})`;
    // Par lots : une transaction géante saturerait la mémoire et le quota.
    const BATCH = 200;
    for (let i = 0; i < all.rows.length; i += BATCH) {
      await remote.batch(
        all.rows
          .slice(i, i + BATCH)
          .map((row) => ({ sql: insert, args: columns.map((c) => row[c] ?? null) })),
        'write',
      );
    }
    console.log(`   ✓ ${name} : ${all.rows.length} ligne(s)`);
  }

  // Les index portent les contraintes d'unicité : sans eux, des doublons
  // pourraient entrer côté cloud.
  for (const { name, sql, type } of schema.rows) {
    if (type !== 'index' || String(name).startsWith('sqlite_')) continue;
    try {
      await remote.execute(String(sql));
    } catch {
      /* index déjà porté par la définition de la table */
    }
  }

  console.log('\n✅ Publication terminée.');
}

main().catch((error) => {
  console.error('Échec de la publication :', error);
  process.exit(1);
});
