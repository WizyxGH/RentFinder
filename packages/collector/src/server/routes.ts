/**
 * Routes de l'API (§36, §37, §35, §33, §63).
 *
 * Servi par le Worker Cloudflare, seul détenteur du jeton Turso. Ce module ne
 * dépend que des standards Web (`Request`, `Response`, `URL`) et de l'interface
 * `Client` de libsql — jamais de `node:fs`.
 *
 * IL A EU UN SECOND TRANSPORT, un serveur local qui servait aussi le site
 * depuis la machine. Il a été retiré (décision du 2026-09-04) : deux chemins
 * pour le même écran, c'était deux fois les mêmes cas à tenir, et le mode
 * publié couvre désormais tout ce que faisait l'autre. Ce qui est parti avec
 * lui : le dépôt et le téléchargement des PIÈCES du dossier, qui vivaient sur
 * ce disque-là. La route répond 501 et le dit.
 *
 * Routes :
 *   GET   /api/listings              liste triée par priorité d'action (§36)
 *   GET   /api/listings/:id          fiche complète (§37)
 *   PATCH /api/listings/:id          mise à jour du statut de suivi (§35)
 *   POST  /api/listings/:id/contact  enregistrement d'un contact manuel (§22)
 *   GET   /api/sources               état des sources (§63)
 *   GET   /api/stats                 statistiques de suivi (§33)
 *   GET/PUT /api/config              critères de recherche (§66)
 *   GET/PUT /api/settings/<clé>      réglages du compte (recherches, repères)
 *   GET     /api/agencies            annuaire des agences rencontrées
 *   GET     /api/agencies/<nom>      une agence et ses annonces
 *   POST    /api/push                abonnement Web Push du compte (§29)
 *   POST    /api/push/unsubscribe    désabonnement
 *   /api/documents…                  501 : elles vivaient sur le disque local
 */

import type { Client } from '@libsql/client';
import {
  CURRENT_USER,
  MVP_CRITERIA,
  NOTIFICATION_PREFERENCES_SETTING,
  REFERENCE_POINTS_SETTING,
  SAVED_SEARCHES_SETTING,
  SEARCH_CRITERIA_SETTING,
} from '@rentfinder/shared';

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

/**
 * Une fiche VUE PAR QUELQU'UN.
 *
 * Les annonces sont communes ; « je l'ai mise en favori », « je l'ai
 * contactée », « je l'ai archivée » ne le sont pas. Ces états vivent dans
 * `listing_user_state`, une ligne par (utilisateur, annonce), et seulement pour
 * les annonces sur lesquelles quelqu'un a fait quelque chose.
 *
 * D'où la jointure GAUCHE et les `COALESCE` : une annonce que vous n'avez
 * jamais touchée n'a pas de ligne, et vaut donc « ni vue, ni archivée, ni
 * favorite, statut nouveau ». Les colonnes de même nom sur `listings` sont
 * masquées par celles-ci — c'est voulu : elles ne servent plus qu'à la
 * collecte, qui ne connaît qu'un utilisateur.
 */
const USER_STATE_JOIN = `LEFT JOIN listing_user_state AS us
   ON us.listing_id = listings.id AND us.user_id = ?`;

const USER_STATE_COLUMNS = `listings.*,
  COALESCE(us.viewed, 0) AS viewed,
  COALESCE(us.archived, 0) AS archived,
  COALESCE(us.favorite, 0) AS favorite,
  COALESCE(us.tracking, 'new') AS tracking,
  COALESCE(us.notified, 0) AS notified,
  us.notified_at AS notified_at,
  COALESCE(us.drafted, 0) AS drafted`;

async function listListings(
  db: Client,
  url: URL,
  userId: string,
  filters?: LiveFilters,
): Promise<unknown> {
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
    conditions.push('COALESCE(us.archived, 0) = 0');
  }
  // Vue « favoris uniquement » sur demande.
  if (url.searchParams.get('favorite') === 'true') {
    conditions.push('COALESCE(us.favorite, 0) = 1');
  }
  // Un bien LOUÉ sort de la liste, définitivement — même en favori (décision
  // utilisateur : ni grisé, ni montré). §32/§33.
  conditions.push('rented = 0');

  const filter = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.execute({
    sql: `SELECT ${USER_STATE_COLUMNS} FROM listings ${USER_STATE_JOIN} ${filter}
          ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    args: [userId, ...filterArgs, limit, offset],
  });

  const total = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM listings ${USER_STATE_JOIN} ${filter}`,
    args: [userId, ...filterArgs],
  });

  return {
    listings: result.rows.map((row) => rowToListing(row as Record<string, unknown>)),
    total: Number(total.rows[0]?.['n'] ?? 0),
    limit,
    offset,
  };
}

async function getListing(db: Client, id: string, userId: string): Promise<unknown | null> {
  const result = await db.execute({
    sql: `SELECT ${USER_STATE_COLUMNS} FROM listings ${USER_STATE_JOIN} WHERE listings.id = ?`,
    args: [userId, id],
  });
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

/**
 * L'annuaire des agences rencontrées.
 *
 * IL N'EXISTAIT PAS. Le nom d'une agence apparaissait sur une fiche, sans rien
 * derrière : impossible de savoir combien d'annonces elle publiait, ni de
 * retrouver son numéro sans rouvrir une annonce au hasard. Or c'est une
 * question qu'on se pose vraiment — une agence qu'on a déjà appelée, un
 * interlocuteur qui a plusieurs biens dans le quartier.
 *
 * L'AGRÉGATION SE FAIT EN BASE, en une requête. La faire côté navigateur
 * aurait demandé de transporter les coordonnées de toutes les annonces, que la
 * liste retire précisément pour ne pas les payer (§30).
 *
 * Le nom est la clé, faute de mieux : les sources ne publient pas
 * d'identifiant d'agence. Deux orthographes donneront donc deux entrées — on
 * préfère ça à un regroupement inventé (§17).
 */
async function listAgencies(db: Client): Promise<unknown> {
  const result = await db.execute(`
    SELECT o.contact_agency                AS name,
           COUNT(DISTINCT o.listing_id)    AS listings,
           MAX(o.contact_phone)            AS phone,
           MAX(o.contact_email)            AS email,
           GROUP_CONCAT(DISTINCT o.source_id) AS sources,
           MAX(l.last_seen_at)             AS lastSeenAt
    FROM occurrences o
    JOIN listings l ON l.id = o.listing_id
    WHERE o.contact_agency IS NOT NULL AND TRIM(o.contact_agency) != ''
      AND l.lifecycle != 'inactive' AND l.rented = 0
    GROUP BY o.contact_agency
    ORDER BY listings DESC, name ASC
  `);

  return {
    agencies: result.rows.map((row) => ({
      name: String(row['name']),
      listings: Number(row['listings']),
      phone: row['phone'] ?? null,
      email: row['email'] ?? null,
      sources: String(row['sources'] ?? '')
        .split(',')
        .filter((one) => one !== ''),
      lastSeenAt: row['lastSeenAt'] ?? null,
    })),
  };
}

/** Une agence et ce qu'elle propose en ce moment. */
async function getAgency(db: Client, name: string, userId: string): Promise<unknown> {
  const listings = await db.execute({
    sql: `SELECT ${USER_STATE_COLUMNS} FROM listings ${USER_STATE_JOIN}
          WHERE listings.id IN (
            SELECT listing_id FROM occurrences WHERE contact_agency = ?
          )
          AND listings.lifecycle != 'inactive' AND listings.rented = 0
          ORDER BY listings.action_priority DESC, listings.last_seen_at DESC
          LIMIT 200`,
    args: [userId, name],
  });

  const contact = await db.execute({
    sql: `SELECT MAX(contact_phone) AS phone, MAX(contact_email) AS email,
                 GROUP_CONCAT(DISTINCT source_id) AS sources
          FROM occurrences WHERE contact_agency = ?`,
    args: [name],
  });
  const row = contact.rows[0];

  return {
    agency: {
      name,
      listings: listings.rows.length,
      phone: row?.['phone'] ?? null,
      email: row?.['email'] ?? null,
      sources: String(row?.['sources'] ?? '')
        .split(',')
        .filter((one) => one !== ''),
    },
    listings: listings.rows.map((one) => rowToListing(one as Record<string, unknown>)),
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
             -- « Pertinentes » ne compte QUE les annonces encore ACTIVES.
             -- Auparavant ce total incluait aussi les « possiblement
             -- inactives » — disparues de leur source depuis plusieurs
             -- collectes, donc probablement louées : le chiffre annonçait
             -- près du double d'opportunités réelles (§33, §17).
             SUM(CASE WHEN matches_criteria = 1 AND lifecycle = 'active' AND archived = 0
                      AND rented = 0 THEN 1 ELSE 0 END) AS matching,
             -- Comptées à part : toujours affichées et consultables, mais à
             -- vérifier avant de s'en réjouir.
             SUM(CASE WHEN matches_criteria = 1 AND lifecycle = 'possiblyInactive'
                      AND archived = 0 AND rented = 0 THEN 1 ELSE 0 END) AS uncertain,
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

  // Historique de l'inventaire, du plus ancien au plus récent (§33).
  const history = await db.execute('SELECT * FROM daily_stats ORDER BY day DESC LIMIT 90');

  return {
    history: history.rows
      .map((r) => ({
        day: String(r['day']),
        matching: Number(r['matching']),
        uncertain: Number(r['uncertain']),
        rented: Number(r['rented']),
        total: Number(r['total']),
        activeSources: Number(r['active_sources']),
      }))
      .reverse(),
    listings: {
      total: Number(listings.rows[0]?.['total'] ?? 0),
      matching: Number(listings.rows[0]?.['matching'] ?? 0),
      uncertain: Number(listings.rows[0]?.['uncertain'] ?? 0),
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
  userId: string,
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
  await writeUserState(db, id, userId, userStatePatch(body));
  return { id, ...body };
}

/** Les champs du corps qui sont des décisions personnelles, en colonnes SQL. */
function userStatePatch(body: {
  viewed?: unknown;
  archived?: unknown;
  favorite?: unknown;
  tracking?: unknown;
}): Record<string, string | number> {
  const patch: Record<string, string | number> = {};
  if (typeof body.viewed === 'boolean') patch['viewed'] = body.viewed ? 1 : 0;
  if (typeof body.archived === 'boolean') patch['archived'] = body.archived ? 1 : 0;
  if (typeof body.favorite === 'boolean') patch['favorite'] = body.favorite ? 1 : 0;
  if (typeof body.tracking === 'string') patch['tracking'] = body.tracking;
  return patch;
}

/**
 * Consigne une décision PERSONNELLE : favori, archivage, statut, consultation.
 *
 * C'est ici que vit désormais la vérité, `listing_user_state` étant lu par les
 * requêtes de liste et de fiche. Les colonnes de même nom sur `listings` sont
 * encore écrites juste au-dessus — elles servent à la COLLECTE, qui ne connaît
 * qu'un utilisateur (notifications déjà envoyées, brouillons écrits) — mais
 * elles ne sont plus ce que l'API renvoie.
 */
async function writeUserState(
  db: Client,
  listingId: string,
  userId: string,
  patch: Readonly<Record<string, string | number>>,
): Promise<void> {
  const columns = Object.keys(patch);
  if (columns.length === 0) return;
  await db.execute({
    sql: `INSERT INTO listing_user_state (user_id, listing_id, ${columns.join(', ')}, updated_at)
          VALUES (?, ?, ${columns.map(() => '?').join(', ')}, ?)
          ON CONFLICT(user_id, listing_id) DO UPDATE SET ${columns
            .map((column) => `${column} = excluded.${column}`)
            .concat('updated_at = excluded.updated_at')
            .join(', ')}`,
    args: [
      userId,
      listingId,
      ...columns.map((column) => patch[column] ?? null),
      new Date().toISOString(),
    ],
  });
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
  userId: string,
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
  await writeUserState(db, id, userId, { tracking: 'contacted' });

  return { id, followUpIndex, sentAt: now, documents };
}

/**
 * Abonnements Web Push (§29).
 *
 * ILS N'AVAIENT AUCUNE ROUTE. Seul l'accès direct à Turso savait les écrire,
 * depuis le navigateur — si bien que sur l'installation recommandée, celle qui
 * passe par le Worker, activer les notifications ne s'enregistrait nulle part.
 * Le navigateur acceptait l'abonnement, la page affichait « activé », et aucune
 * alerte n'arrivait jamais.
 *
 * L'abonnement APPARTIENT À UN COMPTE : c'est ce qui permettra d'envoyer à la
 * bonne personne quand ils seront plusieurs.
 *
 * Le désabonnement passe par un POST et non un DELETE : l'identifiant d'un
 * abonnement est une URL entière, trop longue et trop chargée pour un segment
 * de chemin, et tous les intermédiaires ne transmettent pas le corps d'un
 * DELETE.
 */
async function handlePushRoute(
  db: Client,
  method: string,
  action: string | undefined,
  request: Request,
  cors: Record<string, string>,
  userId: string,
): Promise<Response> {
  if (method !== 'POST') return jsonError(404, 'Route inconnue');
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null) return jsonError(400, 'Corps illisible');

  const endpoint = typeof body['endpoint'] === 'string' ? body['endpoint'] : '';
  if (endpoint === '') return jsonError(400, 'Abonnement incomplet');

  if (action === 'unsubscribe') {
    await db.execute({
      sql: 'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
      args: [endpoint, userId],
    });
    return json({ ok: true }, cors);
  }

  const p256dh = typeof body['p256dh'] === 'string' ? body['p256dh'] : '';
  const auth = typeof body['auth'] === 'string' ? body['auth'] : '';
  // Sans les deux clés, la collecte ne pourrait pas chiffrer l'envoi : on
  // refuse plutôt que d'enregistrer un abonnement qui échouera en silence.
  if (p256dh === '' || auth === '') return jsonError(400, 'Abonnement incomplet');

  await db.execute({
    sql: `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, user_id)
          VALUES (?,?,?,?,?)
          ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh,
                                              auth = excluded.auth,
                                              user_id = excluded.user_id,
                                              failures = 0`,
    args: [endpoint, p256dh, auth, new Date().toISOString(), userId],
  });
  return json({ ok: true }, cors);
}

/**
 * Réglages de compte, un par clé (`/api/settings/<clé>`).
 *
 * Les recherches enregistrées et les points de référence vivaient dans
 * `app_settings` mais n'avaient AUCUNE route : seul l'accès direct à Turso
 * savait les écrire, depuis le navigateur. Sur l'installation recommandée —
 * celle qui passe par le Worker — ils ne se conservaient donc pas, sans que
 * rien ne le dise.
 *
 * La liste des clés est FERMÉE. Ouvrir `app_settings` à une clé arbitraire
 * laisserait n'importe quel compte écrire n'importe quoi dans une table que la
 * collecte relit.
 */
const WRITABLE_SETTINGS: readonly string[] = [
  SAVED_SEARCHES_SETTING,
  REFERENCE_POINTS_SETTING,
  NOTIFICATION_PREFERENCES_SETTING,
];

async function handleSettingsRoute(
  db: Client,
  method: string,
  key: string | undefined,
  request: Request,
  cors: Record<string, string>,
  userId: string,
): Promise<Response> {
  if (key === undefined || !WRITABLE_SETTINGS.includes(key)) {
    return jsonError(404, 'Réglage inconnu');
  }

  if (method === 'GET') {
    const stored = await db.execute({
      sql: 'SELECT value FROM app_settings WHERE user_id = ? AND key = ?',
      args: [userId, key],
    });
    const raw = stored.rows[0]?.['value'];
    if (typeof raw !== 'string') return json(null, cors);
    try {
      return json(JSON.parse(raw), cors);
    } catch {
      // Valeur illisible : on rend « rien de réglé » plutôt que de bloquer
      // l'écran sur une ligne qu'on ne sait plus lire.
      return json(null, cors);
    }
  }

  if (method === 'PUT') {
    const body = await request.json().catch(() => undefined);
    if (body === undefined) return jsonError(400, 'Corps illisible');
    await db.execute({
      sql: `INSERT INTO app_settings (user_id, key, value, updated_at) VALUES (?,?,?,?)
            ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value,
                                                    updated_at = excluded.updated_at`,
      args: [userId, key, JSON.stringify(body), new Date().toISOString()],
    });
    return json(body, cors);
  }

  return jsonError(404, 'Route inconnue');
}

/** Filtres de recherche éditables depuis l'interface, en mode local (§66). */
/**
 * Critères de recherche (§66).
 *
 * ILS VIVENT EN BASE, ET NULLE PART AILLEURS. Ils ont longtemps eu deux
 * domiciles : `config/search.json` sur la machine de collecte, et
 * `app_settings` pour le site. Les deux ne disaient pas toujours la même
 * chose, et rien n'indiquait lequel faisait autorité. Le fichier a été retiré ;
 * la base suit l'utilisateur d'un appareil à l'autre, ce qu'un fichier ne
 * saura jamais faire.
 *
 * Chaque compte a les siens : la clé est (utilisateur, réglage).
 */
async function handleConfigRoute(
  db: Client,
  method: string,
  request: Request,
  cors: Record<string, string>,
  userId: string,
): Promise<Response> {
  if (method === 'GET') {
    const stored = await db.execute({
      sql: 'SELECT value FROM app_settings WHERE user_id = ? AND key = ?',
      args: [userId, SEARCH_CRITERIA_SETTING],
    });
    const raw = stored.rows[0]?.['value'];
    if (typeof raw !== 'string') return json(DEFAULT_FILTERS, cors);
    try {
      return json(JSON.parse(raw), cors);
    } catch {
      // Valeur illisible : on rend les défauts plutôt que de bloquer l'écran.
      return json(DEFAULT_FILTERS, cors);
    }
  }
  if (method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== 'object') return jsonError(400, 'Filtres invalides');
    await db.execute({
      sql: `INSERT INTO app_settings (user_id, key, value, updated_at) VALUES (?,?,?,?)
            ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value,
                                                    updated_at = excluded.updated_at`,
      args: [userId, SEARCH_CRITERIA_SETTING, JSON.stringify(body), new Date().toISOString()],
    });
    return json(body, cors);
  }
  return json({ error: 'Route inconnue' }, cors, 404);
}

/** Ce qu'on rend tant que personne n'a rien réglé. */
const DEFAULT_FILTERS = {
  cities: [...MVP_CRITERIA.cities],
  maxPrice: MVP_CRITERIA.maxPrice,
  minArea: MVP_CRITERIA.minArea,
  ...(MVP_CRITERIA.minPrice !== undefined ? { minPrice: MVP_CRITERIA.minPrice } : {}),
};

/**
 * Budget et surface tels que CET utilisateur les a réglés, appliqués en direct
 * à la liste : resserrer son budget doit se voir tout de suite, sans attendre
 * la collecte suivante. Les exclusions (colocation, étudiant) restent figées à
 * la collecte — elles demandent le texte de l'annonce, pas un nombre.
 */
async function liveFilters(db: Client, userId: string): Promise<LiveFilters | undefined> {
  const stored = await db.execute({
    sql: 'SELECT value FROM app_settings WHERE user_id = ? AND key = ?',
    args: [userId, SEARCH_CRITERIA_SETTING],
  });
  const raw = stored.rows[0]?.['value'];
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<LiveFilters>;
    if (typeof parsed.maxPrice !== 'number' || typeof parsed.minArea !== 'number') return undefined;
    return {
      maxPrice: parsed.maxPrice,
      minArea: parsed.minArea,
      ...(typeof parsed.minPrice === 'number' ? { minPrice: parsed.minPrice } : {}),
    };
  } catch {
    return undefined;
  }
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
  userId: string,
): Promise<Response> {
  // Collection : GET /api/listings
  if (id === undefined && method === 'GET') {
    return json(await listListings(db, url, userId, await liveFilters(db, userId)), cors);
  }
  if (id === undefined) return json({ error: 'Route inconnue' }, cors, 404);

  // Sous-ressource : POST /api/listings/:id/contact
  if (action === 'contact') {
    if (method !== 'POST') return json({ error: 'Route inconnue' }, cors, 404);
    const result = await recordContact(db, id, request, userId);
    return result instanceof Response ? result : json(result, cors, 201);
  }
  if (action !== undefined) return json({ error: 'Route inconnue' }, cors, 404);

  // Élément : GET ou PATCH /api/listings/:id
  if (method === 'GET') {
    const listing = await getListing(db, id, userId);
    return listing === null
      ? json({ error: 'Annonce introuvable' }, cors, 404)
      : json(listing, cors);
  }
  if (method === 'PATCH') {
    const result = await updateListing(db, id, request, userId);
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
  /**
   * QUI demande. Le serveur local n'a qu'un utilisateur — c'est votre machine,
   * il n'y a personne d'autre — et prend donc le défaut. Le Worker, lui,
   * transmet l'identifiant lu dans le cookie de session : c'est là que le
   * multi-compte prend son sens.
   */
  userId: string = CURRENT_USER,
): Promise<Response> {
  const method = request.method;
  const resource = segments[1];
  // Le chemin n'est pas décodé par le transport : un id d'annonce contient un
  // « : » (`source:référence`), encodé `%3A` par certains appels du client.
  // On décode ici une fois pour toutes, sinon la fiche ne correspond plus.
  const id = segments[2] !== undefined ? decodeURIComponent(segments[2]) : undefined;

  // Les pièces du dossier tiennent à un espace de fichiers, que ce module n'a
  // pas : le Worker les traite AVANT d'arriver ici. Un transport qui monterait
  // ces routes sans cet espace doit le dire, pas rendre une liste vide qui
  // laisserait croire qu'il n'y a rien à joindre.
  if (resource === 'documents') {
    return jsonError(501, "Ce transport n'héberge pas les pièces du dossier.");
  }
  if (resource === 'config') {
    return handleConfigRoute(db, method, request, cors, userId);
  }
  if (resource === 'settings') {
    return handleSettingsRoute(db, method, id, request, cors, userId);
  }
  if (resource === 'push') {
    return handlePushRoute(db, method, id, request, cors, userId);
  }
  if (resource === 'agencies' && method === 'GET') {
    return json(id === undefined ? await listAgencies(db) : await getAgency(db, id, userId), cors);
  }
  if (resource === 'sources' && method === 'GET') return json(await listSources(db), cors);
  if (resource === 'stats' && method === 'GET') return json(await getStats(db), cors);
  if (resource === 'listings') {
    return handleListingsRoute(db, method, id, segments[3], url, request, cors, userId);
  }
  return json({ error: 'Route inconnue' }, cors, 404);
}
