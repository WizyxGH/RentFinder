/**
 * Élagage des journaux (§30).
 *
 * Les traces d'exécution, l'historique des changements et les événements ne
 * sont lus par personne : ils servent au diagnostic. Rien ne les effaçait —
 * 379 exécutions et 457 changements de prix s'étaient accumulés en trois
 * semaines, sans fin prévue.
 *
 * Ce test vérifie les deux moitiés de la règle : le vieux part, le récent
 * reste. Une purge qui emporterait les quinze derniers jours ferait perdre le
 * signal « prix en baisse », qui les regarde.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createRepository,
  migrate,
  openDatabase,
  silentLogger,
  type Database,
  type Repository,
} from '@rentfinder/collector';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
const NOW = Date.parse('2026-09-04T12:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();

async function count(db: Database, table: string): Promise<number> {
  const result = await db.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(result.rows[0]?.['n'] ?? 0);
}

describe('élagage des journaux', () => {
  let db: Database;
  let repository: Repository;

  beforeEach(async () => {
    db = openDatabase({ url: ':memory:' });
    await migrate(db, MIGRATIONS, silentLogger);
    repository = createRepository(db);

    await db.batch(
      [
        // Une exécution d'hier, une d'il y a six mois.
        ...[daysAgo(1), daysAgo(180)].map((at, index) => ({
          sql: `INSERT INTO collection_runs
                (id, source_id, started_at, finished_at, request_count, pages_fetched,
                 listings_found, listings_new, listings_updated, duplicates, errors, stop_reason)
                VALUES (?, 'fnaim', ?, ?, 1, 1, 0, 0, 0, 0, 0, 'completed')`,
          args: [`run-${index}`, at, at],
        })),
        // Un changement de prix récent, un très ancien.
        ...[daysAgo(10), daysAgo(400)].map((at, index) => ({
          sql: `INSERT INTO listing_history
                (id, occurrence_id, source_id, source_ref, price, area, available_at, change, recorded_at)
                VALUES (?, 'occ', 'fnaim', 'ref', 700, 30, NULL, 'price', ?)`,
          args: [`hist-${index}`, at],
        })),
        ...[daysAgo(2), daysAgo(200)].map((at) => ({
          sql: `INSERT INTO events (kind, occurred_at) VALUES ('listing_discovered', ?)`,
          args: [at],
        })),
      ],
      'write',
    );
  });

  it('efface le vieux et garde le récent', async () => {
    expect(await repository.pruneLogs(NOW)).toBe(3);

    expect(await count(db, 'collection_runs')).toBe(1);
    expect(await count(db, 'listing_history')).toBe(1);
    expect(await count(db, 'events')).toBe(1);
  });

  it('garde les quatorze derniers jours d’historique — le signal « prix en baisse » les lit', async () => {
    await repository.pruneLogs(NOW);
    const rows = await db.execute('SELECT recorded_at FROM listing_history');
    expect(rows.rows).toHaveLength(1);
    expect(String(rows.rows[0]?.['recorded_at'])).toBe(daysAgo(10));
  });

  it('ne fait rien sur une base sans rien à effacer', async () => {
    await repository.pruneLogs(NOW);
    expect(await repository.pruneLogs(NOW)).toBe(0);
  });
});
