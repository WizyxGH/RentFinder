/**
 * Accès DIRECT à la base Turso, depuis le navigateur (§28).
 *
 * Évite un service intermédiaire : le navigateur interroge Turso lui-même, avec
 * une URL et un jeton que l'utilisateur saisit une fois. Rien n'est embarqué
 * dans le bundle publié, qui est public.
 *
 * CE QUE ÇA IMPLIQUE : le jeton donne accès en lecture ET écriture à la base.
 * Choix assumé — il permet de mettre un favori ou de noter un contact depuis le
 * téléphone. Le dommage d'une fuite reste réparable : les annonces se
 * régénèrent (`pnpm collect` puis `pnpm publish:turso`), et rien de personnel
 * n'est publié — ni les adresses de référence, ni l'historique de contacts.
 */

import { createClient, type Client } from '@libsql/client/web';
import type { ListingView, SourceStateView, StatsData } from '../types.js';

const URL_KEY = 'rentfinder.tursoUrl';
const TOKEN_KEY = 'rentfinder.tursoToken';

export interface TursoCredentials {
  readonly url: string;
  readonly token: string;
}

/** Lit les identifiants conservés dans le navigateur. */
export function readCredentials(): TursoCredentials | null {
  try {
    const url = localStorage.getItem(URL_KEY);
    const token = localStorage.getItem(TOKEN_KEY);
    return url !== null && token !== null && url !== '' ? { url, token } : null;
  } catch {
    // Navigation privée ou stockage refusé : on dégrade sans casser.
    return null;
  }
}

export function writeCredentials({ url, token }: TursoCredentials): void {
  try {
    localStorage.setItem(URL_KEY, normalizeUrl(url));
    localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    /* stockage indisponible — vaudra pour la session courante */
  }
}

export function clearCredentials(): void {
  try {
    localStorage.removeItem(URL_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* rien à faire */
  }
}

let cached: { key: string; client: Client } | null = null;

/** Client Turso, recréé seulement si les identifiants changent. */
function client(): Client {
  const credentials = readCredentials();
  if (credentials === null) throw new Error('Identifiants Turso absents');
  const key = `${credentials.url}|${credentials.token}`;
  if (cached?.key !== key) {
    cached = { key, client: createClient({ url: credentials.url, authToken: credentials.token }) };
  }
  return cached.client;
}

/**
 * Nettoie l'adresse saisie.
 *
 * On colle rarement la valeur exacte : ligne entière du `.env`, guillemets,
 * schéma `https://`, barre finale, ou carrément l'URL du tableau de bord. Sans
 * ce nettoyage, l'erreur qui remonte est incompréhensible — un « 405 Not
 * Allowed » d'un serveur qui n'a rien à voir.
 */
export function normalizeUrl(raw: string): string {
  let value = raw.trim().replace(/^TURSO_DATABASE_URL\s*=\s*/i, '');
  value = value.replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  // Le client web accepte les deux schémas ; on garde celui de Turso.
  value = value.replace(/^https?:\/\//i, 'libsql://');
  if (!/^libsql:\/\//i.test(value)) value = `libsql://${value}`;
  return value;
}

/** Message clair quand l'adresse ne peut pas être celle d'une base Turso. */
export function urlProblem(url: string): string | null {
  let host: string;
  try {
    host = new URL(url.replace(/^libsql:/i, 'https:')).hostname;
  } catch {
    return 'Adresse illisible. Elle ressemble à « libsql://… » et finit par turso.io';
  }
  if (host.startsWith('app.') || host.startsWith('web.')) {
    return 'C’est l’adresse du tableau de bord Turso, pas celle de la base. Ouvrez votre base, bouton « Connect ».';
  }
  if (!/\.turso\.io$/i.test(host)) {
    return `« ${host} » n’est pas une base Turso. L’adresse se termine par .turso.io`;
  }
  return null;
}

/** Vérifie que les identifiants donnent bien accès à la base. */
export async function testCredentials(credentials: TursoCredentials): Promise<void> {
  const url = normalizeUrl(credentials.url);
  const problem = urlProblem(url);
  if (problem !== null) throw new Error(problem);
  const probe = createClient({ url, authToken: credentials.token.trim() });
  // On lit une table du projet, pas seulement `SELECT 1` : des identifiants
  // valides sur une base VIDE ne serviraient à rien, autant le dire tout de
  // suite plutôt qu'afficher une liste vide sans explication.
  await probe.execute('SELECT COUNT(*) AS n FROM listings');
}

/**
 * Reconstitue une fiche depuis sa ligne. Mêmes règles que l'API (§15) : le
 * payload porte les champs fusionnés, les colonnes portent l'état.
 */
function rowToListing(row: Record<string, unknown>): ListingView {
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
  } as unknown as ListingView;
}

/**
 * Cache de l'inventaire, avec SONDE avant tout rapatriement.
 *
 * Turso facture les lignes lues. Rapatrier l'inventaire — ~700 lignes, 350 ko —
 * à chaque minute d'ouverture du site était une dépense inutile : la collecte
 * ne publie que quelques fois par jour, l'immense majorité de ces lectures ne
 * rapportait rien de neuf.
 *
 * On interroge donc d'abord une SONDE : un agrégat qui ne lit qu'une ligne et
 * dit si quelque chose a bougé (combien de fiches, et la plus récemment vue).
 * Le rapatriement complet n'a lieu que si cette empreinte a changé.
 *
 * Le cache survit au rechargement (`localStorage`) : rouvrir le site ne coûte
 * alors que la sonde.
 */
const STORE_KEY = 'rentfinder.inventory';
const PROBE_MS = 30_000;

interface Snapshot {
  readonly mark: string;
  readonly rows: readonly ListingView[];
}

let memo: Snapshot | null = null;
let probedAt = 0;

function readStore(): Snapshot | null {
  if (memo !== null) return memo;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw === null) return null;
    memo = JSON.parse(raw) as Snapshot;
    return memo;
  } catch {
    return null;
  }
}

function writeStore(snapshot: Snapshot): void {
  memo = snapshot;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota dépassé ou stockage refusé : le cache mémoire suffit à la session.
  }
}

/** Vide le cache — après une écriture, pour que l'affichage suive. */
export function invalidate(): void {
  memo = null;
  probedAt = 0;
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* rien à faire */
  }
}

/** Empreinte de l'inventaire : une seule ligne lue. */
async function probe(): Promise<string> {
  const result = await client().execute(
    "SELECT COUNT(*) AS n, MAX(last_seen_at) AS seen, MAX(updated_at) AS upd FROM listings WHERE rented = 0 AND lifecycle != 'inactive'",
  );
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  return `${String(row['n'])}|${String(row['seen'])}|${String(row['upd'])}`;
}

async function loadAll(): Promise<readonly ListingView[]> {
  const cached = readStore();
  // La sonde elle-même est espacée : deux appels rapprochés (liste puis
  // statistiques) n'ont pas à la relancer.
  if (cached !== null && Date.now() - probedAt < PROBE_MS) return cached.rows;

  const mark = await probe();
  probedAt = Date.now();
  if (cached !== null && cached.mark === mark) return cached.rows;

  // Le SURENSEMBLE : archivées et hors critères comprises, puisque des
  // bascules d'affichage peuvent les demander sans nouvelle requête.
  const result = await client().execute(
    "SELECT * FROM listings WHERE rented = 0 AND lifecycle != 'inactive' ORDER BY action_priority DESC, last_seen_at DESC LIMIT 1000",
  );
  const rows = result.rows.map((row) => rowToListing(row as Record<string, unknown>));
  writeStore({ mark, rows });
  return rows;
}

export interface ListOptions {
  readonly sort?: string;
  readonly includeOutOfCriteria?: boolean;
  readonly includeArchived?: boolean;
  readonly favoritesOnly?: boolean;
}

export async function listListings(options: ListOptions = {}): Promise<readonly ListingView[]> {
  const all = await loadAll();
  const kept = all.filter((l) => {
    if (options.includeOutOfCriteria !== true && !l.matchesCriteria) return false;
    if (options.includeArchived !== true && l.archived === true) return false;
    if (options.favoritesOnly === true && l.favorite !== true) return false;
    return true;
  });

  const sorted = [...kept];
  if (options.sort === 'price') {
    sorted.sort((a, b) => (a.price.value ?? Infinity) - (b.price.value ?? Infinity));
  } else if (options.sort === 'recent') {
    sorted.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  }
  // Le tri par priorité vient déjà de la requête.
  return sorted;
}

export async function getListing(id: string): Promise<ListingView> {
  // L'inventaire est déjà en cache : ouvrir une fiche ne doit rien coûter.
  // On ne redescend en base que pour une annonce absente du surensemble
  // (inactive ou louée), cas rare mais atteignable par un lien direct.
  const known = (await loadAll()).find((listing) => listing.id === id);
  if (known !== undefined) return known;

  const result = await client().execute({
    sql: 'SELECT * FROM listings WHERE id = ?',
    args: [id],
  });
  const row = result.rows[0];
  if (row === undefined) throw new Error('Annonce introuvable');
  return rowToListing(row as Record<string, unknown>);
}

/** Met à jour l'état d'une fiche. Colonnes closes : jamais d'entrée libre. */
export async function patchListing(
  id: string,
  patch: Partial<Record<'viewed' | 'archived' | 'favorite' | 'tracking', boolean | string>>,
): Promise<void> {
  const assignments: string[] = [];
  const args: (string | number)[] = [];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    args.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }
  if (assignments.length === 0) return;
  args.push(id);
  await client().execute({
    sql: `UPDATE listings SET ${assignments.join(', ')} WHERE id = ?`,
    args,
  });
  invalidate();
}

/**
 * Consigne une prise de contact effectuée par l'utilisateur (§22) : cette
 * fonction n'envoie rien, elle enregistre que l'action a eu lieu.
 */
export async function recordContact(
  id: string,
  payload: { channel: string; message: string; sourceId: string },
): Promise<void> {
  await client().execute(
    `CREATE TABLE IF NOT EXISTS contact_attempts (
       id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, source_id TEXT,
       channel TEXT, message TEXT, outcome TEXT, sent_at TEXT NOT NULL
     )`,
  );
  await client().execute({
    sql: `INSERT INTO contact_attempts (id, listing_id, source_id, channel, message, outcome, sent_at)
          VALUES (?, ?, ?, ?, ?, 'sent', ?)`,
    args: [
      crypto.randomUUID(),
      id,
      payload.sourceId,
      payload.channel,
      payload.message,
      new Date().toISOString(),
    ],
  });
}

export async function listSources(): Promise<readonly SourceStateView[]> {
  const result = await client().execute('SELECT * FROM source_state ORDER BY source_id');
  return result.rows.map((row) => ({
    sourceId: String(row['source_id']),
    health: row['health'] as SourceStateView['health'],
    lastRunAt: (row['last_run_at'] as string | null) ?? null,
    lastSuccessAt: (row['last_success_at'] as string | null) ?? null,
    last429At: (row['last_429_at'] as string | null) ?? null,
    cooldownUntil: (row['cooldown_until'] as string | null) ?? null,
    consecutiveErrors: Number(row['consecutive_errors'] ?? 0),
    averageNewListingCount: Number(row['average_new_listing_count'] ?? 0),
  }));
}

export async function getStats(): Promise<StatsData> {
  // Une seule requête, et un agrégat : elle ne lit qu'une ligne. La répartition
  // par statut et par source se DÉDUIT de l'inventaire déjà en cache — la
  // calculer côté base coûtait deux balayages complets à chaque affichage.
  const counts = await client().execute(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN matches_criteria = 1 AND lifecycle = 'active'
                AND archived = 0 AND rented = 0 THEN 1 ELSE 0 END) AS matching,
      SUM(CASE WHEN matches_criteria = 1 AND lifecycle = 'possiblyInactive'
                AND archived = 0 AND rented = 0 THEN 1 ELSE 0 END) AS uncertain,
      SUM(CASE WHEN matches_criteria = 1 AND rented = 1 THEN 1 ELSE 0 END) AS rented,
      SUM(CASE WHEN lifecycle = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(viewed) AS viewed, SUM(archived) AS archived
    FROM listings
  `);

  const inventory = await loadAll();
  const byTracking: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const listing of inventory) {
    if (listing.matchesCriteria) {
      byTracking[listing.tracking] = (byTracking[listing.tracking] ?? 0) + 1;
    }
    for (const source of new Set(listing.occurrences.map((o) => o.sourceId))) {
      bySource[source] = (bySource[source] ?? 0) + 1;
    }
  }

  const row = (counts.rows[0] ?? {}) as Record<string, unknown>;
  return {
    listings: {
      total: Number(row['total'] ?? 0),
      matching: Number(row['matching'] ?? 0),
      uncertain: Number(row['uncertain'] ?? 0),
      rented: Number(row['rented'] ?? 0),
      active: Number(row['active'] ?? 0),
      viewed: Number(row['viewed'] ?? 0),
      archived: Number(row['archived'] ?? 0),
    },
    byTracking,
    bySource,
    contacts: { total: 0, byOutcome: {} },
  };
}
