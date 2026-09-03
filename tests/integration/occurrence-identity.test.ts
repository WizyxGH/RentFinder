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
  scoreListing,
  silentLogger,
  type Database,
  type Repository,
} from '@rentfinder/collector';
import { MVP_CRITERIA, type ScoredListing } from '@rentfinder/shared';
import { makeAggregated, makeOccurrence } from '../helpers/factories.js';

/** Fiche scorée minimale : ces tests portent sur la PERSISTANCE, pas le score. */
function makeScoredListing(over: { id: string; occurrenceIds: readonly string[] }): ScoredListing {
  return scoreListing(
    makeAggregated({
      id: over.id,
      occurrences: over.occurrenceIds.map((id) => makeOccurrence({ id, sourceId: 'email-alerts' })),
    }),
    { criteria: MVP_CRITERIA, nowMs: Date.now(), referencePricePerSqm: 20, referencePoints: [] },
  );
}

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

describe('fusion de deux fiches : la décision de l’utilisateur remonte (§14, §35)', () => {
  let db: Database;
  let repository: Repository;

  beforeEach(async () => {
    db = openDatabase({ url: ':memory:' });
    await migrate(db, MIGRATIONS, silentLogger);
    repository = createRepository(db);
  });

  /** Le suivi se règle par l'API, pas par le dépôt : on écrit directement. */
  async function setTracking(id: string, tracking: string): Promise<void> {
    await db.execute({
      sql: 'UPDATE listings SET tracking = ? WHERE id = ?',
      args: [tracking, id],
    });
  }

  /** Écrit deux fiches distinctes, chacune sur son occurrence. */
  async function twoSeparateListings(): Promise<void> {
    await repository.upsertOccurrences([
      makeOccurrence({ id: 'email-alerts:ancien', sourceId: 'email-alerts' }),
      makeOccurrence({ id: 'email-alerts:recent', sourceId: 'email-alerts' }),
    ]);
    await repository.saveListings([
      makeScoredListing({ id: 'email-alerts:ancien', occurrenceIds: ['email-alerts:ancien'] }),
      makeScoredListing({ id: 'email-alerts:recent', occurrenceIds: ['email-alerts:recent'] }),
    ]);
  }

  it('reprend le suivi de la fiche absorbée, puis supprime la ligne morte', async () => {
    // Le doublon observé le 2026-09-03 : la fiche absorbée portait
    // « contactée », la purge l'épargnait donc — et elle restait affichée.
    await twoSeparateListings();
    await setTracking('email-alerts:ancien', 'contacted');

    // Les deux occurrences se retrouvent dans un seul groupe.
    await repository.saveListings([
      makeScoredListing({
        id: 'email-alerts:recent',
        occurrenceIds: ['email-alerts:recent', 'email-alerts:ancien'],
      }),
    ]);

    const rows = await db.execute('SELECT id, tracking FROM listings');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.['id']).toBe('email-alerts:recent');
    expect(rows.rows[0]?.['tracking']).toBe('contacted');
  });

  it('cumule les drapeaux : un favori absorbé reste un favori', async () => {
    await twoSeparateListings();
    await repository.setListingFavorite('email-alerts:ancien', true);

    await repository.saveListings([
      makeScoredListing({
        id: 'email-alerts:recent',
        occurrenceIds: ['email-alerts:recent', 'email-alerts:ancien'],
      }),
    ]);

    const rows = await db.execute('SELECT id, favorite FROM listings');
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0]?.['favorite'])).toBe(1);
  });

  it('ne fait jamais RECULER un suivi déjà plus avancé', async () => {
    await twoSeparateListings();
    await setTracking('email-alerts:ancien', 'new');
    await setTracking('email-alerts:recent', 'visited');

    await repository.saveListings([
      makeScoredListing({
        id: 'email-alerts:recent',
        occurrenceIds: ['email-alerts:recent', 'email-alerts:ancien'],
      }),
    ]);

    const rows = await db.execute('SELECT tracking FROM listings');
    expect(rows.rows[0]?.['tracking']).toBe('visited');
  });
});

describe('absorbOrphanListings — rattrapage d’une fusion passée (§14)', () => {
  let db: Database;
  let repository: Repository;

  beforeEach(async () => {
    db = openDatabase({ url: ':memory:' });
    await migrate(db, MIGRATIONS, silentLogger);
    repository = createRepository(db);
  });

  it('transmet la décision à la remplaçante, puis supprime la ligne morte', async () => {
    // Reproduit l'état laissé par une fusion antérieure au transfert d'état :
    // l'orpheline porte « contactée », ses occurrences vivent ailleurs.
    await repository.upsertOccurrences([
      makeOccurrence({ id: 'email-alerts:a', sourceId: 'email-alerts' }),
      makeOccurrence({ id: 'email-alerts:b', sourceId: 'email-alerts' }),
    ]);
    await repository.saveListings([
      makeScoredListing({ id: 'email-alerts:a', occurrenceIds: ['email-alerts:a'] }),
      makeScoredListing({ id: 'email-alerts:b', occurrenceIds: ['email-alerts:b'] }),
    ]);
    await db.execute({
      sql: 'UPDATE listings SET tracking = ? WHERE id = ?',
      args: ['contacted', 'email-alerts:a'],
    });
    // La fusion a eu lieu : les deux occurrences pointent vers `b`, mais la
    // ligne `a` a survécu parce qu'elle portait une décision.
    await db.execute(
      "UPDATE occurrences SET group_id = 'email-alerts:b' WHERE id = 'email-alerts:a'",
    );

    expect(await repository.absorbOrphanListings()).toBe(1);

    const rows = await db.execute('SELECT id, tracking FROM listings');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.['id']).toBe('email-alerts:b');
    expect(rows.rows[0]?.['tracking']).toBe('contacted');
  });

  it('ne touche à rien quand aucune fiche n’est orpheline', async () => {
    await repository.upsertOccurrences([makeOccurrence({ id: 'orpi:1', sourceId: 'orpi' })]);
    await repository.saveListings([makeScoredListing({ id: 'orpi:1', occurrenceIds: ['orpi:1'] })]);
    expect(await repository.absorbOrphanListings()).toBe(0);
  });
});
