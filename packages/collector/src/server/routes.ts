/**
 * Routes de l'API locale (§36, §37, §35, §33, §63).
 *
 * Le projet est 100% local : ce module est consommé par le serveur local
 * (`cli/serve.ts`, mode zéro-cloud, fichier SQLite, limité à 127.0.0.1). Il ne
 * dépend que des standards Web (`Request`, `Response`, `URL`) et de l'interface
 * `Client` de libsql.
 *
 * Routes :
 *   GET   /api/listings              liste triée par priorité d'action (§36)
 *   GET   /api/listings/:id          fiche complète (§37)
 *   PATCH /api/listings/:id          mise à jour du statut de suivi (§35)
 *   POST  /api/listings/:id/contact  enregistrement d'un contact manuel (§22)
 *   GET   /api/sources               état des sources (§63)
 *   GET   /api/stats                 statistiques de suivi (§33)
 */

import type { Client } from '@libsql/client';
import { readSearchFilters, writeSearchFilters } from '../config.js';

/** Statuts de suivi acceptés par l'API (§35). */
const TRACKING_STATUSES = new Set([
  'new',
  'toContact',
  'contacted',
  'replied',
  'visitOffered',
  'visitScheduled',
  'visited',
  'rejected',
  'rented',
  'ignored',
]);

/** Réponse d'erreur JSON, sans détail exploitable. */
function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function json(data: unknown, cors: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Les données sont personnelles : aucun cache intermédiaire.
      'cache-control': 'private, no-store',
      ...cors,
    },
  });
}

/** Reconstitue une fiche à partir de sa ligne et de son payload JSON. */
function rowToListing(row: Record<string, unknown>): Record<string, unknown> {
  const payload = JSON.parse(String(row['payload'] ?? '{}')) as Record<string, unknown>;
  return {
    id: String(row['id']),
    lifecycle: row['lifecycle'],
    tracking: row['tracking'],
    firstSeenAt: row['first_seen_at'],
    lastSeenAt: row['last_seen_at'],
    matchesCriteria: Number(row['matches_criteria']) === 1,
    actionPriority: Number(row['action_priority'] ?? 0),
    ...payload,
  };
}

async function listListings(db: Client, url: URL): Promise<unknown> {
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '30', 10)),
  );
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10));

  // §36 : par défaut, le classement suit la priorité d'action — pas le prix.
  const sort = url.searchParams.get('sort') ?? 'priority';
  const orderBy =
    sort === 'recent'
      ? 'last_seen_at DESC'
      : sort === 'price'
        ? 'price ASC'
        : 'action_priority DESC, last_seen_at DESC';

  // §53 scénario 3 : les annonces hors critères ne remontent pas par défaut.
  const includeAll = url.searchParams.get('all') === 'true';
  const conditions: string[] = [];
  const filterArgs: Array<string | number> = [];

  if (!includeAll) {
    conditions.push('matches_criteria = 1', "lifecycle != 'inactive'");

    // Filtres NUMÉRIQUES appliqués en direct : ajuster le budget ou la surface
    // depuis l'interface se répercute immédiatement, sans re-collecter. Un
    // champ NULL n'exclut jamais (§17). Les exclusions coloc/étudiant, elles,
    // sont figées à la collecte (matches_criteria) et changent au prochain run.
    const f = readSearchFilters();
    conditions.push('(price IS NULL OR price <= ?)');
    filterArgs.push(f.maxPrice);
    if (f.minPrice !== undefined) {
      conditions.push('(price IS NULL OR price >= ?)');
      filterArgs.push(f.minPrice);
    }
    conditions.push('(area IS NULL OR area >= ?)');
    filterArgs.push(f.minArea);
  }

  const filter = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.execute({
    sql: `SELECT * FROM listings ${filter} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    args: [...filterArgs, limit, offset],
  });

  const total = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM listings ${filter}`,
    args: filterArgs,
  });

  return {
    listings: result.rows.map((row) => rowToListing(row as Record<string, unknown>)),
    total: Number(total.rows[0]?.['n'] ?? 0),
    limit,
    offset,
  };
}

async function getListing(db: Client, id: string): Promise<unknown | null> {
  const result = await db.execute({ sql: 'SELECT * FROM listings WHERE id = ?', args: [id] });
  const row = result.rows[0];
  if (row === undefined) return null;

  const attempts = await db.execute({
    sql: 'SELECT * FROM contact_attempts WHERE listing_id = ? ORDER BY sent_at DESC',
    args: [id],
  });

  return {
    ...rowToListing(row as Record<string, unknown>),
    contactAttempts: attempts.rows.map((attempt) => ({
      id: attempt['id'],
      channel: attempt['channel'],
      trigger: attempt['trigger'],
      sentAt: attempt['sent_at'],
      followUpIndex: Number(attempt['follow_up_index']),
      outcome: attempt['outcome'],
    })),
  };
}

async function listSources(db: Client): Promise<unknown> {
  const states = await db.execute('SELECT * FROM source_state ORDER BY source_id');
  const runs = await db.execute(`
    SELECT source_id, started_at, listings_found, listings_new, request_count, stop_reason, errors
    FROM collection_runs ORDER BY started_at DESC LIMIT 50
  `);

  return {
    sources: states.rows.map((row) => ({
      sourceId: row['source_id'],
      health: row['health'],
      lastRunAt: row['last_run_at'],
      lastSuccessAt: row['last_success_at'],
      last429At: row['last_429_at'],
      cooldownUntil: row['cooldown_until'],
      consecutiveErrors: Number(row['consecutive_errors']),
      averageNewListingCount: Number(row['average_new_listing_count']),
    })),
    recentRuns: runs.rows,
  };
}

async function getStats(db: Client): Promise<unknown> {
  // §33 : statistiques simples pour commencer, pas de modèle complexe.
  const [listings, contacts, outcomes] = await Promise.all([
    db.execute(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN matches_criteria = 1 THEN 1 ELSE 0 END) AS matching,
             SUM(CASE WHEN lifecycle = 'active' THEN 1 ELSE 0 END) AS active
      FROM listings
    `),
    db.execute('SELECT COUNT(*) AS total FROM contact_attempts'),
    db.execute('SELECT outcome, COUNT(*) AS n FROM contact_attempts GROUP BY outcome'),
  ]);

  const byOutcome: Record<string, number> = {};
  for (const row of outcomes.rows) byOutcome[String(row['outcome'])] = Number(row['n']);

  return {
    listings: {
      total: Number(listings.rows[0]?.['total'] ?? 0),
      matching: Number(listings.rows[0]?.['matching'] ?? 0),
      active: Number(listings.rows[0]?.['active'] ?? 0),
    },
    contacts: { total: Number(contacts.rows[0]?.['total'] ?? 0), byOutcome },
  };
}

async function updateTracking(
  db: Client,
  id: string,
  request: Request,
): Promise<Response | unknown> {
  const body = (await request.json().catch(() => null)) as { tracking?: string } | null;
  const tracking = body?.tracking;

  if (tracking === undefined || !TRACKING_STATUSES.has(tracking)) {
    return jsonError(400, 'Statut de suivi invalide');
  }

  const result = await db.execute({
    sql: 'UPDATE listings SET tracking = ?, updated_at = ? WHERE id = ?',
    args: [tracking, new Date().toISOString(), id],
  });

  if (result.rowsAffected === 0) return jsonError(404, 'Annonce introuvable');
  return { id, tracking };
}

/**
 * Enregistre une prise de contact déclenchée manuellement (§22).
 *
 * L'API n'envoie RIEN : l'utilisateur a envoyé son message lui-même, cette
 * route ne fait que consigner le fait pour le suivi et les statistiques (§33).
 */
async function recordContact(
  db: Client,
  id: string,
  request: Request,
): Promise<Response | unknown> {
  const body = (await request.json().catch(() => null)) as {
    channel?: string;
    message?: string;
    sourceId?: string;
  } | null;

  const channel = body?.channel ?? 'manual';
  const now = new Date().toISOString();

  const previous = await db.execute({
    sql: 'SELECT COUNT(*) AS n FROM contact_attempts WHERE listing_id = ?',
    args: [id],
  });
  const followUpIndex = Number(previous.rows[0]?.['n'] ?? 0);

  await db.execute({
    sql: `INSERT INTO contact_attempts
            (id, listing_id, source_id, channel, trigger, sent_at, message, follow_up_index, outcome, updated_at)
          VALUES (?,?,?,?,'manual',?,?,?, 'pending', ?)`,
    args: [
      crypto.randomUUID(),
      id,
      body?.sourceId ?? 'unknown',
      channel,
      now,
      body?.message ?? '',
      followUpIndex,
      now,
    ],
  });

  await db.execute({
    sql: 'UPDATE listings SET tracking = ?, updated_at = ? WHERE id = ?',
    args: ['contacted', now, id],
  });

  return { id, followUpIndex, sentAt: now };
}

/**
 * Aiguillage des routes. La clé de routage combine méthode et forme du chemin.
 * Les segments sont validés par le transport avant d'arriver ici (§75).
 */
export async function route(
  db: Client,
  request: Request,
  url: URL,
  segments: readonly string[],
  cors: Record<string, string>,
): Promise<Response> {
  const method = request.method;
  const resource = segments[1];
  const id = segments[2];
  const action = segments[3];

  // Filtres de recherche éditables depuis l'interface (§66).
  if (resource === 'config') {
    if (method === 'GET') return json(readSearchFilters(), cors);
    if (method === 'PUT') {
      const body = await request.json().catch(() => null);
      try {
        return json(writeSearchFilters(body), cors);
      } catch (error) {
        return jsonError(400, error instanceof Error ? error.message : 'Filtres invalides');
      }
    }
    return json({ error: 'Route inconnue' }, cors, 404);
  }

  if (resource === 'sources' && method === 'GET') {
    return json(await listSources(db), cors);
  }

  if (resource === 'stats' && method === 'GET') {
    return json(await getStats(db), cors);
  }

  if (resource !== 'listings') {
    return json({ error: 'Route inconnue' }, cors, 404);
  }

  // Collection : GET /api/listings
  if (id === undefined && method === 'GET') {
    return json(await listListings(db, url), cors);
  }
  if (id === undefined) {
    return json({ error: 'Route inconnue' }, cors, 404);
  }

  // Sous-ressource : POST /api/listings/:id/contact
  if (action === 'contact') {
    if (method !== 'POST') return json({ error: 'Route inconnue' }, cors, 404);
    const result = await recordContact(db, id, request);
    return result instanceof Response ? result : json(result, cors, 201);
  }
  if (action !== undefined) {
    return json({ error: 'Route inconnue' }, cors, 404);
  }

  // Élément : GET ou PATCH /api/listings/:id
  if (method === 'GET') {
    const listing = await getListing(db, id);
    return listing === null
      ? json({ error: 'Annonce introuvable' }, cors, 404)
      : json(listing, cors);
  }
  if (method === 'PATCH') {
    const result = await updateTracking(db, id, request);
    return result instanceof Response ? result : json(result, cors);
  }

  return json({ error: 'Route inconnue' }, cors, 404);
}
