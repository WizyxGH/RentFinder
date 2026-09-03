/**
 * Identité d'une occurrence : `id` DÉRIVÉ de la clé naturelle (§68).
 *
 * L'identifiant vaut par construction `${source_id}:${source_ref}`. Les deux
 * peuvent pourtant diverger — un changement passé du schéma de référence des
 * alertes e-mail a laissé 103 lignes dont l'`id` porte l'ancienne forme et
 * `source_ref` la nouvelle. Toute re-collecte de ces annonces échouait alors
 * sur `UNIQUE (source_id, source_ref)` et FAISAIT ÉCHOUER LA COLLECTE ENTIÈRE,
 * puisque les occurrences s'écrivent en un seul lot.
 *
 * Ces tests figent les deux moitiés de la réparation : l'écriture ne peut plus
 * produire la divergence, et le rattrapage répare l'existant.
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

describe('identité d’une occurrence (§68)', () => {
  let db: Database;
  let repository: Repository;

  /** Force la divergence que le schéma de référence historique a produite. */
  async function desynchronize(id: string, newRef: string): Promise<void> {
    await db.execute({
      sql: 'UPDATE occurrences SET source_ref = ? WHERE id = ?',
      args: [newRef, id],
    });
  }

  beforeEach(async () => {
    db = openDatabase({ url: ':memory:' });
    await migrate(db, MIGRATIONS, silentLogger);
    repository = createRepository(db);
  });

  it('réécrit la ligne existante au lieu d’échouer sur la clé naturelle', async () => {
    await repository.upsertOccurrences([
      makeOccurrence({ id: 'email-alerts:ancien-slug', sourceId: 'email-alerts', price: 690 }),
    ]);
    await desynchronize('email-alerts:ancien-slug', 'seloger:26AUM6KIFC9M');

    // La collecte suivante produit l'identifiant du NOUVEAU schéma. Avant la
    // correction, cette écriture violait UNIQUE (source_id, source_ref).
    await repository.upsertOccurrences([
      makeOccurrence({
        id: 'email-alerts:seloger:26AUM6KIFC9M',
        sourceRef: 'seloger:26AUM6KIFC9M',
        sourceId: 'email-alerts',
        price: 650,
      }),
    ]);

    const rows = await db.execute('SELECT id, source_ref, price FROM occurrences');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.['id']).toBe('email-alerts:seloger:26AUM6KIFC9M');
    expect(Number(rows.rows[0]?.['price'])).toBe(650);
  });

  it('réaligne les identifiants hérités sur leur clé naturelle', async () => {
    await repository.upsertOccurrences([
      makeOccurrence({ id: 'email-alerts:ancien-slug', sourceId: 'email-alerts' }),
      makeOccurrence({ id: 'orpi:1', sourceRef: '1', sourceId: 'orpi' }),
    ]);
    await desynchronize('email-alerts:ancien-slug', 'seloger:26AUM6KIFC9M');

    expect(await repository.realignOccurrenceIds()).toBe(1);

    const rows = await db.execute('SELECT id FROM occurrences ORDER BY id');
    expect(rows.rows.map((row) => row['id'])).toEqual([
      'email-alerts:seloger:26AUM6KIFC9M',
      'orpi:1',
    ]);
  });

  it('ne touche à rien quand tout est déjà cohérent', async () => {
    await repository.upsertOccurrences([
      makeOccurrence({ id: 'orpi:1', sourceRef: '1', sourceId: 'orpi' }),
    ]);
    expect(await repository.realignOccurrenceIds()).toBe(0);
  });
});
