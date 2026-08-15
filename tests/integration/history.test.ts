/**
 * Collecte de l'historique (§31).
 *
 * Vérifie qu'une ligne d'historique est écrite à la première observation
 * (baseline) puis UNIQUEMENT quand loyer / surface / disponibilité changent —
 * pas à chaque run (§30).
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
import { makeOccurrence } from '../helpers/factories.js';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../database/migrations');

async function history(db: Database): Promise<Array<Record<string, unknown>>> {
  const result = await db.execute('SELECT * FROM listing_history ORDER BY recorded_at, change');
  return result.rows as Array<Record<string, unknown>>;
}

describe('collecte de l’historique (§31)', () => {
  let db: Database;
  let repository: Repository;

  beforeEach(async () => {
    db = openDatabase({ url: ':memory:' });
    await migrate(db, MIGRATIONS, silentLogger);
    repository = createRepository(db);
  });

  it('écrit une baseline à la première observation', async () => {
    await repository.upsertOccurrences([
      makeOccurrence({ id: 'orpi:1', sourceId: 'orpi', price: 690 }),
    ]);
    const rows = await history(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['change']).toBe('baseline');
    expect(Number(rows[0]?.['price'])).toBe(690);
  });

  it('n’écrit rien de plus quand l’annonce est identique (§30)', async () => {
    const occ = makeOccurrence({ id: 'orpi:1', sourceId: 'orpi', price: 690 });
    await repository.upsertOccurrences([occ]);
    await repository.upsertOccurrences([occ]);
    expect(await history(db)).toHaveLength(1);
  });

  it('enregistre une baisse de loyer', async () => {
    await repository.upsertOccurrences([
      makeOccurrence({ id: 'orpi:1', sourceId: 'orpi', price: 690 }),
    ]);
    await repository.upsertOccurrences([
      makeOccurrence({ id: 'orpi:1', sourceId: 'orpi', price: 650 }),
    ]);
    const rows = await history(db);
    expect(rows).toHaveLength(2);
    const change = rows.find((r) => r['change'] === 'price');
    expect(change).toBeDefined();
    expect(Number(change?.['price'])).toBe(650);
  });

  it('marque « multiple » quand loyer ET surface changent', async () => {
    await repository.upsertOccurrences([
      makeOccurrence({ id: 'orpi:1', sourceId: 'orpi', price: 690, area: 34 }),
    ]);
    await repository.upsertOccurrences([
      makeOccurrence({ id: 'orpi:1', sourceId: 'orpi', price: 650, area: 36 }),
    ]);
    const rows = await history(db);
    expect(rows.some((r) => r['change'] === 'multiple')).toBe(true);
  });
});
