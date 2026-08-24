/**
 * Routes de l'API (§36, §37, §35, §33, §63).
 *
 * Consommé par DEUX transports : le serveur local (`cli/serve.ts`, fichier
 * SQLite, 127.0.0.1) et le Worker Cloudflare du mode cloud optionnel
 * (`packages/api`, Turso, jeton). Il ne dépend que des standards Web
 * (`Request`, `Response`, `URL`) et de l'interface `Client` de libsql — JAMAIS
 * de `node:fs` : les fonctionnalités liées au disque (filtres éditables,
 * documents de candidature) sont INJECTÉES par le serveur local via
 * `LocalFeatures`, et répondent 501 quand elles sont absentes (mode cloud).
 *
 * Routes :
 *   GET   /api/listings              liste triée par priorité d'action (§36)
 *   GET   /api/listings/:id          fiche complète (§37)
 *   PATCH /api/listings/:id          mise à jour du statut de suivi (§35)
 *   POST  /api/listings/:id/contact  enregistrement d'un contact manuel (§22)
 *   GET   /api/sources               état des sources (§63)
 *   GET   /api/stats                 statistiques de suivi (§33)
 *   GET/PUT /api/config              filtres de recherche (§66 — local seulement)
 *   /api/documents…                  pièces de candidature (§25 — local seulement)
 */

import type { Client } from '@libsql/client';

/**
 * Fonctionnalités disponibles uniquement en mode local (elles touchent le
 * disque de l'utilisateur). Le Worker cloud ne les fournit pas : les pièces de
 * candidature et le fichier de filtres ne quittent jamais la machine (§25, §26).
 */
/** Sous-ensemble des filtres utilisé pour le raffinage « live » des listes. */
export interface LiveFilters {
  readonly maxPrice: number;
  readonly minPrice?: number;
  readonly minArea: number;
}

export interface LocalFeatures {
  readonly readSearchFilters: () => LiveFilters;
  readonly writeSearchFilters: (input: unknown) => unknown;
  readonly listDocuments: () => unknown;
  readonly saveDocument: (
    name: string,
    bytes: Uint8Array,
  ) => { ok: true; document: unknown } | { ok: false; error: string };
  readonly readDocument: (name: string) => { bytes: Uint8Array; contentType: string } | null;
  readonly deleteDocument: (name: string) => boolean;
}

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
    viewed: Number(row['viewed'] ?? 0) === 1,
    archived: Number(row['archived'] ?? 0) === 1,
    favorite: Number(row['favorite'] ?? 0) === 1,
    rented: Number(row['rented'] ?? 0) === 1,
    ...payload,
  };
}

async function listListings(db: Client, url: URL, filters?: LiveFilters): Promise<unknown> {
  const limit = Math.min(
    500,
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
    // En mode cloud (pas d'accès au fichier de filtres), `matches_criteria`
    // calculé à la collecte fait seul autorité.
    if (filters !== undefined) {
      conditions.push('(price IS NULL OR price <= ?)');
      filterArgs.push(filters.maxPrice);
      if (filters.minPrice !== undefined) {
        conditions.push('(price IS NULL OR price >= ?)');
        filterArgs.push(filters.minPrice);
      }
      conditions.push('(area IS NULL OR area >= ?)');
      filterArgs.push(filters.minArea);
    }
  }

  // Les annonces archivées sont masquées, sauf demande explicite (§ archivage).
  if (url.searchParams.get('archived') !== 'true') {
    conditions.push('archived = 0');
  }
  // Vue « favoris uniquement » sur demande.
  if (url.searchParams.get('favorite') === 'true') {
    conditions.push('favorite = 1');
  }
  // Un bien LOUÉ sort de la liste, définitivement — même en favori (décision
  // utilisateur : ni grisé, ni montré). §32/§33.
  conditions.push('rented = 0');

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

  /** Relit la liste JSON des pièces jointes, tolérante aux valeurs anciennes. */
  function parseDocumentsList(raw: unknown): string[] {
    if (typeof raw !== 'string' || raw === '') return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  return {
    ...rowToListing(row as Record<string, unknown>),
    contactAttempts: attempts.rows.map((attempt) => ({
      id: attempt['id'],
      channel: attempt['channel'],
      trigger: attempt['trigger'],
      sentAt: attempt['sent_at'],
      followUpIndex: Number(attempt['follow_up_index']),
      outcome: attempt['outcome'],
      documents: parseDocumentsList(attempt['documents']),
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
  const [listings, engagement, contacts, outcomes, byTracking, bySource] = await Promise.all([
    db.execute(`
      SELECT COUNT(*) AS total,
             -- « Pertinentes » = EXACTEMENT ce que montre l'onglet Annonces
             -- (dans les critères, encore disponibles, non archivées), sinon
             -- le compteur diverge de la liste (§33).
             SUM(CASE WHEN matches_criteria = 1 AND lifecycle != 'inactive' AND archived = 0
                      AND rented = 0 THEN 1 ELSE 0 END) AS matching,
             SUM(CASE WHEN lifecycle = 'active' THEN 1 ELSE 0 END) AS active,
             SUM(CASE WHEN matches_criteria = 1 AND rented = 1 THEN 1 ELSE 0 END) AS rented
      FROM listings
    `),
    db.execute(
      'SELECT SUM(viewed) AS viewed, SUM(archived) AS archived FROM listings WHERE matches_criteria = 1',
    ),
    db.execute('SELECT COUNT(*) AS total FROM contact_attempts'),
    db.execute('SELECT outcome, COUNT(*) AS n FROM contact_attempts GROUP BY outcome'),
    db.execute(
      'SELECT tracking, COUNT(*) AS n FROM listings WHERE matches_criteria = 1 GROUP BY tracking',
    ),
    db.execute(`
      SELECT source_id, COUNT(*) AS n FROM occurrences
      WHERE lifecycle IN ('active', 'possiblyInactive') GROUP BY source_id ORDER BY n DESC
    `),
  ]);

  const toMap = (rows: readonly Record<string, unknown>[], key: string): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const row of rows) map[String(row[key])] = Number(row['n']);
    return map;
  };

  return {
    listings: {
      total: Number(listings.rows[0]?.['total'] ?? 0),
      matching: Number(listings.rows[0]?.['matching'] ?? 0),
      rented: Number(listings.rows[0]?.['rented'] ?? 0),
      active: Number(listings.rows[0]?.['active'] ?? 0),
      viewed: Number(engagement.rows[0]?.['viewed'] ?? 0),
      archived: Number(engagement.rows[0]?.['archived'] ?? 0),
    },
    byTracking: toMap(byTracking.rows as Record<string, unknown>[], 'tracking'),
    bySource: toMap(bySource.rows as Record<string, unknown>[], 'source_id'),
    contacts: {
      total: Number(contacts.rows[0]?.['total'] ?? 0),
      byOutcome: toMap(outcomes.rows as Record<string, unknown>[], 'outcome'),
    },
  };
}

/**
 * Met à jour l'état d'une fiche : statut de suivi (§35), « consultée » (§37)
 * et/ou « archivée ». Chaque champ est optionnel ; on ne touche que ceux
 * fournis. Ces colonnes ne sont jamais écrasées par la collecte, donc l'état
 * survit aux re-collectes et aux redémarrages.
 */
async function updateListing(
  db: Client,
  id: string,
  request: Request,
): Promise<Response | unknown> {
  const body = (await request.json().catch(() => null)) as {
    tracking?: string;
    viewed?: boolean;
    archived?: boolean;
    favorite?: boolean;
  } | null;
  if (body === null) return jsonError(400, 'Corps de requête invalide');

  const sets: string[] = [];
  const args: Array<string | number> = [];

  if (body.tracking !== undefined) {
    if (!TRACKING_STATUSES.has(body.tracking)) return jsonError(400, 'Statut de suivi invalide');
    sets.push('tracking = ?');
    args.push(body.tracking);
  }
  if (typeof body.viewed === 'boolean') {
    sets.push('viewed = ?');
    args.push(body.viewed ? 1 : 0);
  }
  if (typeof body.archived === 'boolean') {
    sets.push('archived = ?');
    args.push(body.archived ? 1 : 0);
  }
  if (typeof body.favorite === 'boolean') {
    sets.push('favorite = ?');
    args.push(body.favorite ? 1 : 0);
  }

  if (sets.length === 0) return jsonError(400, 'Aucun champ à mettre à jour');

  sets.push('updated_at = ?');
  args.push(new Date().toISOString(), id);

  const result = await db.execute({
    sql: `UPDATE listings SET ${sets.join(', ')} WHERE id = ?`,
    args,
  });

  if (result.rowsAffected === 0) return jsonError(404, 'Annonce introuvable');
  return { id, ...body };
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
    documents?: unknown;
  } | null;

  const channel = body?.channel ?? 'manual';
  const now = new Date().toISOString();

  // §25 : trace locale des pièces déclarées jointes. On ne conserve que des
  // noms (chaînes), jamais le contenu — les fichiers vivent dans data/.
  const documents = Array.isArray(body?.documents)
    ? body.documents.filter((name): name is string => typeof name === 'string')
    : [];

  const previous = await db.execute({
    sql: 'SELECT COUNT(*) AS n FROM contact_attempts WHERE listing_id = ?',
    args: [id],
  });
  const followUpIndex = Number(previous.rows[0]?.['n'] ?? 0);

  await db.execute({
    sql: `INSERT INTO contact_attempts
            (id, listing_id, source_id, channel, trigger, sent_at, message, follow_up_index, outcome, documents, updated_at)
          VALUES (?,?,?,?,'manual',?,?,?, 'pending', ?, ?)`,
    args: [
      crypto.randomUUID(),
      id,
      body?.sourceId ?? 'unknown',
      channel,
      now,
      body?.message ?? '',
      followUpIndex,
      JSON.stringify(documents),
      now,
    ],
  });

  await db.execute({
    sql: 'UPDATE listings SET tracking = ?, updated_at = ? WHERE id = ?',
    args: ['contacted', now, id],
  });

  return { id, followUpIndex, sentAt: now, documents };
}

/** Filtres de recherche éditables depuis l'interface, en mode local (§66). */
async function handleConfigRoute(
  method: string,
  request: Request,
  cors: Record<string, string>,
  local: LocalFeatures,
): Promise<Response> {
  if (method === 'GET') return json(local.readSearchFilters(), cors);
  if (method === 'PUT') {
    const body = await request.json().catch(() => null);
    try {
      return json(local.writeSearchFilters(body), cors);
    } catch (error) {
      return jsonError(400, error instanceof Error ? error.message : 'Filtres invalides');
    }
  }
  return json({ error: 'Route inconnue' }, cors, 404);
}

/**
 * Documents de candidature (§25) : stockés dans data/ (gitignoré), servis
 * uniquement en local. Aucun envoi automatique, jamais (§24).
 */
async function handleDocumentsRoute(
  method: string,
  id: string | undefined,
  url: URL,
  request: Request,
  cors: Record<string, string>,
  local: LocalFeatures,
): Promise<Response> {
  if (id === undefined && method === 'GET') {
    return json({ documents: local.listDocuments() }, cors);
  }
  if (id === undefined && method === 'POST') {
    const name = url.searchParams.get('name') ?? '';
    const bytes = new Uint8Array(await request.arrayBuffer());
    const result = local.saveDocument(name, bytes);
    return result.ok ? json(result.document, cors, 201) : jsonError(400, result.error);
  }
  if (id !== undefined && method === 'GET') {
    const document = local.readDocument(id);
    if (document === null) return jsonError(404, 'Document introuvable');
    return new Response(new Uint8Array(document.bytes), {
      headers: {
        'content-type': document.contentType,
        'content-disposition': 'inline',
        'cache-control': 'private, no-store',
        ...cors,
      },
    });
  }
  if (id !== undefined && method === 'DELETE') {
    return local.deleteDocument(id)
      ? json({ deleted: true }, cors)
      : jsonError(404, 'Document introuvable');
  }
  return json({ error: 'Route inconnue' }, cors, 404);
}

/** Ressource `listings` : collection, élément et sous-ressource `contact`. */
async function handleListingsRoute(
  db: Client,
  method: string,
  id: string | undefined,
  action: string | undefined,
  url: URL,
  request: Request,
  cors: Record<string, string>,
  local: LocalFeatures | undefined,
): Promise<Response> {
  // Collection : GET /api/listings
  if (id === undefined && method === 'GET') {
    return json(await listListings(db, url, local?.readSearchFilters()), cors);
  }
  if (id === undefined) return json({ error: 'Route inconnue' }, cors, 404);

  // Sous-ressource : POST /api/listings/:id/contact
  if (action === 'contact') {
    if (method !== 'POST') return json({ error: 'Route inconnue' }, cors, 404);
    const result = await recordContact(db, id, request);
    return result instanceof Response ? result : json(result, cors, 201);
  }
  if (action !== undefined) return json({ error: 'Route inconnue' }, cors, 404);

  // Élément : GET ou PATCH /api/listings/:id
  if (method === 'GET') {
    const listing = await getListing(db, id);
    return listing === null
      ? json({ error: 'Annonce introuvable' }, cors, 404)
      : json(listing, cors);
  }
  if (method === 'PATCH') {
    const result = await updateListing(db, id, request);
    return result instanceof Response ? result : json(result, cors);
  }
  return json({ error: 'Route inconnue' }, cors, 404);
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
  local?: LocalFeatures,
): Promise<Response> {
  const method = request.method;
  const resource = segments[1];
  // Le chemin n'est pas décodé par le transport : un id d'annonce contient un
  // « : » (`source:référence`), encodé `%3A` par certains appels du client.
  // On décode ici une fois pour toutes, sinon la fiche ne correspond plus.
  const id = segments[2] !== undefined ? decodeURIComponent(segments[2]) : undefined;

  // Filtres et documents touchent le DISQUE de l'utilisateur : disponibles
  // uniquement quand le transport les fournit (mode local, §25/§66).
  if ((resource === 'config' || resource === 'documents') && local === undefined) {
    return jsonError(501, 'Disponible uniquement en mode local (pnpm local)');
  }
  if (resource === 'config' && local !== undefined) {
    return handleConfigRoute(method, request, cors, local);
  }
  if (resource === 'documents' && local !== undefined) {
    return handleDocumentsRoute(method, id, url, request, cors, local);
  }
  if (resource === 'sources' && method === 'GET') return json(await listSources(db), cors);
  if (resource === 'stats' && method === 'GET') return json(await getStats(db), cors);
  if (resource === 'listings') {
    return handleListingsRoute(db, method, id, segments[3], url, request, cors, local);
  }
  return json({ error: 'Route inconnue' }, cors, 404);
}
