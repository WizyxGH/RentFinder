/**
 * Tests d'intégration du pipeline complet (§52, §53).
 *
 * Chaîne exercée en entier :
 *   SCRAPER → NORMALISATION → DÉDOUBLONNAGE → SCORING → BASE
 *
 * Deux garanties de méthode :
 *   - la base est un SQLite EN MÉMOIRE, jamais Turso (§52) ;
 *   - le réseau est simulé par une fonction `fetch` injectée, alimentée par
 *     les fixtures locales (§59). Aucun test ne sort de la machine.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Scraper } from '@rentfinder/shared';
import { MVP_CRITERIA } from '@rentfinder/shared';
import {
  createRegistry,
  createRepository,
  createTestClock,
  migrate,
  openDatabase,
  runPipeline,
  silentLogger,
  laforetScraper,
  type Database,
  type Repository,
} from '@rentfinder/collector';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, '../fixtures/laforet');
const MIGRATIONS = resolve(here, '../../database/migrations');

const fixture = (name: string): string => readFileSync(resolve(FIXTURES, name), 'utf8');

const NOW = Date.parse('2026-08-14T12:00:00.000Z');

const CONFIG = {
  criteria: MVP_CRITERIA,
  maxSourcesPerRun: 6,
  referencePricePerSqm: 20,
  missingRunsBeforePossiblyInactive: 2,
  missingRunsBeforeInactive: 6,
};

/**
 * Fabrique un `fetch` simulé.
 * @param handler reçoit l'URL et rend le statut, le corps et les en-têtes.
 */
function fakeFetch(
  handler: (url: string) => { status: number; body: string; headers?: Record<string, string> },
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const { status, body, headers } = handler(url);
    return new Response(status === 304 ? null : body, { status, headers });
  }) as typeof fetch;
}

/** Sert la fixture nominale sur toute page de Nice. */
const serveNominal = fakeFetch(() => ({ status: 200, body: fixture('nice-page1.html') }));

async function setupDatabase(): Promise<{ db: Database; repository: Repository }> {
  const db = openDatabase({ url: ':memory:' });
  await migrate(db, MIGRATIONS, silentLogger);
  return { db, repository: createRepository(db) };
}

function pipelineOptions(
  repository: Repository,
  fetchImpl: typeof fetch,
  scrapers: readonly Scraper[] = [laforetScraper],
  nowMs = NOW,
) {
  return {
    registry: createRegistry(scrapers),
    repository,
    config: CONFIG,
    referencePoints: [],
    userAgent: 'RentFinderBot/0.1 (test)',
    mode: 'live' as const,
    clock: createTestClock({ startMs: nowMs, random: 0 }),
    logger: silentLogger,
    fetchImpl,
  };
}

describe('scénario 1 — une nouvelle annonce est détectée (§53)', () => {
  let db: Database;
  let repository: Repository;

  beforeEach(async () => {
    ({ db, repository } = await setupDatabase());
  });

  it('collecte, normalise, score et enregistre', async () => {
    const report = await runPipeline(pipelineOptions(repository, serveNominal));

    expect(report.sourcesRun).toEqual(['laforet']);
    expect(report.listingsCollected).toBeGreaterThan(0);
    expect(report.written.inserted).toBeGreaterThan(0);

    const rows = await db.execute('SELECT * FROM listings ORDER BY action_priority DESC');
    expect(rows.rows.length).toBeGreaterThan(0);

    // Les quatre scores sont calculés pour chaque fiche.
    for (const row of rows.rows) {
      expect(row['match_score']).not.toBeNull();
      expect(row['opportunity_score']).not.toBeNull();
      expect(row['visit_score']).not.toBeNull();
      expect(row['risk_score']).not.toBeNull();
    }
  });

  it('donne le statut « Nouveau » aux annonces découvertes', async () => {
    await runPipeline(pipelineOptions(repository, serveNominal));
    const rows = await db.execute('SELECT tracking FROM listings');
    expect(rows.rows.every((row) => row['tracking'] === 'new')).toBe(true);
  });

  it('retient l’annonce à 690 € / 34 m² comme correspondant aux critères', async () => {
    await runPipeline(pipelineOptions(repository, serveNominal));
    const rows = await db.execute(
      'SELECT price, area, matches_criteria FROM listings WHERE price = 690',
    );
    expect(rows.rows[0]?.['matches_criteria']).toBe(1);
  });

  it('enregistre le run pour l’observabilité (§63)', async () => {
    await runPipeline(pipelineOptions(repository, serveNominal));
    const runs = await db.execute('SELECT * FROM collection_runs');
    expect(runs.rows).toHaveLength(1);
    expect(Number(runs.rows[0]?.['request_count'])).toBeGreaterThan(0);
  });
});

describe('scénario 2 — la même annonce sur deux sources (§53)', () => {
  it('ne produit qu’une fiche, avec deux sources et deux URLs', async () => {
    const { db, repository } = await setupDatabase();

    // Deux sources servant la MÊME annonce : même agence, même référence.
    const cloned: Scraper = {
      descriptor: { ...laforetScraper.descriptor, id: 'laforet-miroir', priority: 3 },
      run: laforetScraper.run.bind(laforetScraper),
    };

    await runPipeline(pipelineOptions(repository, serveNominal, [laforetScraper, cloned]));

    const occurrences = await db.execute(
      "SELECT * FROM occurrences WHERE contact_reference = '40000001'",
    );
    expect(occurrences.rows).toHaveLength(2);

    // Les deux occurrences pointent vers la même fiche agrégée.
    const groupIds = new Set(occurrences.rows.map((row) => String(row['group_id'])));
    expect(groupIds.size).toBe(1);

    // Et l'utilisateur ne voit qu'une seule fiche pour ce logement.
    const listing = await db.execute({
      sql: 'SELECT payload FROM listings WHERE id = ?',
      args: [[...groupIds][0]!],
    });
    const payload = JSON.parse(String(listing.rows[0]?.['payload'])) as {
      occurrences: { sourceId: string; sourceUrl: string }[];
    };
    expect(payload.occurrences).toHaveLength(2);
    expect(new Set(payload.occurrences.map((o) => o.sourceId)).size).toBe(2);
    // §13 : les URLs originales sont conservées.
    for (const occurrence of payload.occurrences) {
      expect(occurrence.sourceUrl).toMatch(/^https:\/\/www\.laforet\.com\//);
    }
  });
});

describe('scénario 3 — annonce hors critères (§53)', () => {
  it('collecte l’annonce mais la marque hors critères', async () => {
    const { db, repository } = await setupDatabase();
    await runPipeline(pipelineOptions(repository, serveNominal));

    // L'annonce à 1 890 € est bien en base…
    const stored = await db.execute('SELECT * FROM listings WHERE price = 1890');
    expect(stored.rows).toHaveLength(1);
    // …mais exclue de la liste principale.
    expect(stored.rows[0]?.['matches_criteria']).toBe(0);
  });

  it('exclut aussi une annonce sous la surface minimale', async () => {
    const { db, repository } = await setupDatabase();
    await runPipeline(pipelineOptions(repository, serveNominal));

    // La chambre de 9 m² est sous le minimum de 12 m².
    const stored = await db.execute('SELECT * FROM listings WHERE area = 9');
    expect(stored.rows[0]?.['matches_criteria']).toBe(0);
  });
});

describe('scénario 6 — la source répond 429 (§53)', () => {
  it('arrête la source, applique le cooldown et laisse les autres continuer', async () => {
    const { repository } = await setupDatabase();

    const rateLimited = fakeFetch((url) =>
      url.includes('laforet.com') ? { status: 429, body: '' } : { status: 200, body: '' },
    );

    const report = await runPipeline(pipelineOptions(repository, rateLimited));

    const outcome = report.outcomes.find((entry) => entry.sourceId === 'laforet');
    expect(outcome?.success).toBe(true);
    // Le scraper capture l'erreur et s'arrête proprement.
    expect(outcome?.result?.stopReason).toBe('rateLimited');

    // Aucune annonce n'a été extraite, et le run n'a pas échoué.
    expect(report.listingsCollected).toBe(0);
  });

  it('n’émet aucune requête vers une source en cooldown au run suivant (§10)', async () => {
    const { repository } = await setupDatabase();

    // On force l'état « cooldown » comme après un 429.
    await repository.saveSourceState({
      sourceId: 'laforet',
      health: 'cooldown',
      lastRunAt: new Date(NOW - 60_000).toISOString(),
      lastSuccessAt: null,
      last429At: new Date(NOW - 60_000).toISOString(),
      lastBlockedAt: null,
      cooldownUntil: new Date(NOW + 3_600_000).toISOString(),
      consecutiveErrors: 1,
      lastNewListingCount: 0,
      averageNewListingCount: 0,
    });

    let requests = 0;
    const counting = fakeFetch(() => {
      requests += 1;
      return { status: 200, body: fixture('nice-page1.html') };
    });

    const report = await runPipeline(pipelineOptions(repository, counting));

    expect(report.sourcesRun).toEqual([]);
    expect(requests).toBe(0);
    expect(report.sourcesSkipped.some((entry) => entry.reason.includes('cooldown'))).toBe(true);
  });
});

describe('scénario 7 — la structure de la source change (§53)', () => {
  it('échoue proprement, journalise, et laisse le reste fonctionner', async () => {
    const { db, repository } = await setupDatabase();

    // Le site renvoie désormais une page sans aucune annonce reconnaissable.
    const changed = fakeFetch(() => ({
      status: 200,
      body: '<html><body><div class="new-layout">Rien de reconnaissable</div></body></html>',
    }));

    const report = await runPipeline(pipelineOptions(repository, changed));

    // Le run se termine sans exception.
    expect(report.outcomes[0]?.success).toBe(true);
    expect(report.listingsCollected).toBe(0);

    // La source passe en DEGRADED plutôt que d'être perdue.
    const state = await repository.loadSourceState('laforet');
    expect(state.health).toBe('degraded');

    // L'application reste utilisable : aucune donnée existante n'est détruite.
    const listings = await db.execute('SELECT COUNT(*) AS n FROM listings');
    expect(Number(listings.rows[0]?.['n'])).toBe(0);
  });

  it('une source en échec n’empêche pas les autres de collecter (§69)', async () => {
    const { db, repository } = await setupDatabase();

    const broken: Scraper = {
      descriptor: { ...laforetScraper.descriptor, id: 'source-cassee', priority: 1 },
      run: async () => {
        throw new Error('parser totalement cassé');
      },
    };

    const report = await runPipeline(
      pipelineOptions(repository, serveNominal, [broken, laforetScraper]),
    );

    expect(report.outcomes.find((o) => o.sourceId === 'source-cassee')?.success).toBe(false);
    expect(report.outcomes.find((o) => o.sourceId === 'laforet')?.success).toBe(true);

    // Les annonces de la source saine sont bien enregistrées.
    const listings = await db.execute('SELECT COUNT(*) AS n FROM listings');
    expect(Number(listings.rows[0]?.['n'])).toBeGreaterThan(0);
  });
});

describe('économie des écritures (§27, §30)', () => {
  it('ne réécrit pas une occurrence dont le contenu n’a pas changé', async () => {
    const { repository } = await setupDatabase();

    const first = await runPipeline(pipelineOptions(repository, serveNominal));
    expect(first.occurrencesWritten.inserted).toBeGreaterThan(0);
    expect(first.written.inserted).toBeGreaterThan(0);

    // Deuxième passage, contenu identique, une heure plus tard pour que le
    // scheduler autorise une nouvelle exécution.
    const second = await runPipeline(
      pipelineOptions(repository, serveNominal, [laforetScraper], NOW + 3_600_000),
    );

    // C'est ici que se joue l'économie promise au §30 : les annonces sont
    // revues à l'identique, donc AUCUNE ligne n'est réécrite. Seule la date de
    // dernière observation est rafraîchie, en une requête groupée.
    expect(second.occurrencesWritten.inserted).toBe(0);
    expect(second.occurrencesWritten.updated).toBe(0);
    expect(second.occurrencesWritten.unchanged).toBe(first.occurrencesWritten.inserted);

    // Aucune nouvelle fiche non plus.
    expect(second.written.inserted).toBe(0);
  });

  it('réécrit une occurrence dont le loyer a changé', async () => {
    const { repository } = await setupDatabase();
    await runPipeline(pipelineOptions(repository, serveNominal));

    // Le loyer de l'annonce 40000001 passe de 690 € à 720 €.
    const updated = fakeFetch(() => ({
      status: 200,
      body: fixture('nice-page1.html').replace('690 €/mois', '720 €/mois'),
    }));

    const second = await runPipeline(
      pipelineOptions(repository, updated, [laforetScraper], NOW + 3_600_000),
    );

    expect(second.occurrencesWritten.updated).toBeGreaterThan(0);
  });

  it('n’analyse même pas la page quand le serveur répond 304 (§30)', async () => {
    const { repository } = await setupDatabase();

    // Premier passage : le serveur fournit un ETag.
    await runPipeline(
      pipelineOptions(
        repository,
        fakeFetch(() => ({
          status: 200,
          body: fixture('nice-page1.html'),
          headers: { etag: 'W/"v1"' },
        })),
      ),
    );

    // Deuxième passage : rien n'a changé.
    const report = await runPipeline(
      pipelineOptions(
        repository,
        fakeFetch(() => ({ status: 304, body: '' })),
        [laforetScraper],
        NOW + 3_600_000,
      ),
    );

    expect(report.listingsCollected).toBe(0);
  });
});

describe('cycle de vie des annonces (§32)', () => {
  it('ne supprime pas une annonce disparue, mais fait évoluer son statut', async () => {
    const { db, repository } = await setupDatabase();

    await runPipeline(pipelineOptions(repository, serveNominal));
    const before = await db.execute('SELECT COUNT(*) AS n FROM occurrences');
    const initialCount = Number(before.rows[0]?.['n']);
    expect(initialCount).toBeGreaterThan(0);

    // La page ne contient plus qu'une seule annonce : les autres ont disparu.
    const shrunk = fakeFetch(() => ({
      status: 200,
      body: `<a href="https://www.laforet.com/agence-immobiliere/nice-centre/louer/nice/appartement-1-piece-40000001">
               Appartement 690 €/mois NICE (06000) 34 m² • 1 pièce
             </a>`,
    }));

    // Deux passages pour franchir le seuil `possiblyInactive`.
    await runPipeline(pipelineOptions(repository, shrunk, [laforetScraper], NOW + 3_600_000));
    await runPipeline(pipelineOptions(repository, shrunk, [laforetScraper], NOW + 7_200_000));

    const after = await db.execute('SELECT COUNT(*) AS n FROM occurrences');
    // Rien n'a été supprimé.
    expect(Number(after.rows[0]?.['n'])).toBe(initialCount);

    const inactive = await db.execute(
      "SELECT COUNT(*) AS n FROM occurrences WHERE lifecycle = 'possiblyInactive'",
    );
    expect(Number(inactive.rows[0]?.['n'])).toBeGreaterThan(0);
  });
});
