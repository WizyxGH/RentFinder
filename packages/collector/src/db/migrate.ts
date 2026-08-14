/**
 * Exécution des migrations (§68).
 *
 * Les migrations sont des fichiers SQL numérotés dans `database/migrations/`.
 * Elles sont appliquées dans l'ordre, une seule fois, et tracées dans
 * `schema_migrations`. Le schéma de production n'est jamais modifié à la main :
 * toute évolution passe par un nouveau fichier.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from './client.js';
import type { Logger } from '../core/logger.js';

/** Nom de fichier attendu : `0001_description.sql`. */
const MIGRATION_PATTERN = /^(\d{4})_(.+)\.sql$/;

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** Charge les migrations depuis un répertoire, triées par version croissante. */
export async function loadMigrations(directory: string): Promise<Migration[]> {
  const entries = await readdir(directory);
  const migrations: Migration[] = [];

  for (const entry of entries.sort()) {
    const match = MIGRATION_PATTERN.exec(entry);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    migrations.push({
      version: Number.parseInt(match[1], 10),
      name: match[2],
      sql: await readFile(join(directory, entry), 'utf8'),
    });
  }

  return migrations.sort((a, b) => a.version - b.version);
}

/**
 * Découpe un fichier SQL en instructions exécutables.
 *
 * libsql n'accepte qu'une instruction par appel. Le découpage retire au
 * préalable les commentaires en fin de ligne, afin qu'un `;` situé dans un
 * commentaire ne coupe pas une instruction.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Applique les migrations non encore exécutées. */
export async function migrate(
  db: Database,
  directory: string,
  logger: Logger,
): Promise<{ applied: number[] }> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const existing = await db.execute('SELECT version FROM schema_migrations');
  const applied = new Set(existing.rows.map((row) => Number(row['version'])));

  const migrations = await loadMigrations(directory);
  const newlyApplied: number[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    logger.info('db.migration.apply', { version: migration.version, name: migration.name });
    for (const statement of splitStatements(migration.sql)) {
      await db.execute(statement);
    }
    await db.execute({
      sql: 'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      args: [migration.version, migration.name, new Date().toISOString()],
    });
    newlyApplied.push(migration.version);
  }

  if (newlyApplied.length === 0) logger.info('db.migration.up_to_date');
  return { applied: newlyApplied };
}
