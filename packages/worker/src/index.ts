/**
 * Worker Cloudflare : l'API du site publié, et le seul endroit qui connaisse
 * le jeton Turso (§26, §28).
 *
 * CE QU'IL CHANGE. Le site publié interrogeait Turso DIRECTEMENT : le jeton
 * vivait dans le navigateur, il ouvrait toute la base, et aucun mot de passe
 * ne pouvait donc être vérifié — un écran de connexion posé devant se serait
 * contourné en changeant une variable. Ici le jeton est un secret de la
 * plateforme ; le navigateur ne reçoit qu'un cookie de session signé.
 *
 * IL N'INVENTE PAS D'API. Les routes existent déjà (`routes.ts` du collecteur),
 * écrites pour deux transports dès l'origine : le serveur local et celui-ci.
 * Elles ne dépendent que des standards Web et de l'interface `Client` de
 * libsql. Ce fichier n'ajoute que ce qui lui est propre — l'authentification,
 * et le fait de savoir QUI demande.
 *
 * CE QU'IL NE SERT PAS : les filtres éditables et les pièces du dossier
 * touchent le disque de la machine. `routes.ts` répond 501 pour elles quand le
 * transport ne les fournit pas, ce qui est le cas ici.
 */

import { createClient, type Client } from '@libsql/client/web';
import { route } from '@rentfinder/collector/server/routes';
import { clearedCookie, issueSession, readCookie, readSession, sessionCookie } from './auth.js';
import { deleteDocument, listDocuments, readDocument, saveDocument } from './documents.js';
import { forbiddenOrigin } from './origin.js';

export interface Env {
  /** URL `libsql://…` de la base. Secret de la plateforme, jamais publié. */
  readonly TURSO_DATABASE_URL: string;
  readonly TURSO_AUTH_TOKEN: string;
  /** Clé de signature des sessions. La changer déconnecte tout le monde. */
  readonly SESSION_SECRET: string;
  /** Origine autorisée à appeler l'API (le site). */
  readonly ALLOWED_ORIGIN?: string;
  /**
   * Espace de fichiers des pièces du dossier (§25). Absent = la
   * fonctionnalité répond 501 et le dit, plutôt que d'accepter des fichiers
   * pour les perdre.
   */
  readonly DOCUMENTS?: R2Bucket;
}

function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  // On ne renvoie l'origine que si elle est CELLE QU'ON ATTEND. Un `*` avec
  // des cookies est refusé par les navigateurs, et le serait à raison : il
  // laisserait n'importe quel site appeler l'API avec votre session.
  const allowed = env.ALLOWED_ORIGIN ?? '';
  const same = origin !== null && origin === allowed;
  return {
    'Access-Control-Allow-Origin': same ? origin : allowed,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(body: unknown, cors: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

/**
 * Connexion.
 *
 * LE MÊME MESSAGE POUR UN IDENTIFIANT INCONNU ET UN MAUVAIS MOT DE PASSE.
 * Distinguer les deux dirait à un inconnu quels comptes existent.
 *
 * Et l'empreinte est vérifiée MÊME QUAND L'IDENTIFIANT N'EXISTE PAS, contre
 * une empreinte factice : sans cela, une réponse instantanée trahirait un
 * compte inexistant, et une réponse lente un compte réel.
 */
async function login(db: Client, request: Request, env: Env, cors: Record<string, string>) {
  const { verifyPassword } = await import('./auth.js');
  let body: { login?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête illisible' }, cors, 400);
  }
  const identifiant = typeof body.login === 'string' ? body.login.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (identifiant === '' || password === '') {
    return json({ error: 'Identifiant et mot de passe requis' }, cors, 400);
  }

  const found = await db.execute({
    sql: 'SELECT id, password_hash FROM users WHERE login = ?',
    args: [identifiant],
  });
  const row = found.rows[0];
  const stored = typeof row?.['password_hash'] === 'string' ? row['password_hash'] : DUMMY_HASH;
  const ok = await verifyPassword(password, stored);
  if (!ok || row === undefined) {
    return json({ error: 'Identifiant ou mot de passe incorrect' }, cors, 401);
  }

  const userId = String(row['id']);
  const token = await issueSession(userId, env.SESSION_SECRET, Date.now());
  return new Response(JSON.stringify({ userId }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': sessionCookie(token),
      ...cors,
    },
  });
}

/**
 * Empreinte factice, sur laquelle on vérifie quand l'identifiant n'existe pas.
 * Son mot de passe est inconnu et sans intérêt : seul son COÛT compte.
 */
const DUMMY_HASH =
  'pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * Les pièces du dossier (§25).
 *
 * Elles vivent dans R2, préfixées par le compte : un dossier de candidature
 * contient une fiche de paie et une pièce d'identité, il n'y a pas de pièces
 * communes.
 *
 * RIEN N'EST ENVOYÉ AUTOMATIQUEMENT (§24) : on stocke, on liste, on rend, on
 * supprime. C'est vous qui joignez.
 */
async function documents(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  userId: string,
  name: string | undefined,
): Promise<Response> {
  const bucket = env.DOCUMENTS;
  if (bucket === undefined) {
    return json({ error: 'Aucun espace de fichiers configuré.' }, cors, 501);
  }

  if (request.method === 'GET' && name === undefined) {
    return json({ documents: await listDocuments(bucket, userId) }, cors);
  }
  if (request.method === 'GET' && name !== undefined) {
    const found = await readDocument(bucket, userId, decodeURIComponent(name));
    if (found === null) return json({ error: 'Pièce introuvable' }, cors, 404);
    for (const [key, value] of Object.entries(cors)) found.headers.set(key, value);
    return found;
  }
  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return json({ error: 'Aucun fichier reçu' }, cors, 400);
    const result = await saveDocument(bucket, userId, file.name, await file.arrayBuffer());
    return result.ok ? json(result.document, cors, 201) : json({ error: result.error }, cors, 400);
  }
  if (request.method === 'DELETE' && name !== undefined) {
    const done = await deleteDocument(bucket, userId, decodeURIComponent(name));
    return done
      ? new Response(null, { status: 204, headers: cors })
      : json({ error: 'Nom refusé' }, cors, 400);
  }
  return json({ error: 'Route inconnue' }, cors, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Avant toute lecture de session : une requête d'écriture venue d'ailleurs
    // ne doit pas même atteindre la base.
    if (forbiddenOrigin(request, env)) {
      return json({ error: 'Origine refusée' }, cors, 403);
    }

    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter((part) => part !== '');

    const db = createClient({
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    });

    if (segments[1] === 'login' && request.method === 'POST') {
      return login(db, request, env, cors);
    }
    if (segments[1] === 'logout') {
      return new Response(null, {
        status: 204,
        headers: { 'Set-Cookie': clearedCookie(), ...cors },
      });
    }

    const userId = await readSession(
      readCookie(request.headers.get('Cookie')),
      env.SESSION_SECRET,
      Date.now(),
    );

    // « Qui suis-je ? » — la page s'en sert pour savoir s'il faut afficher
    // l'écran de connexion. Elle répond aussi bien à un inconnu (200 avec
    // `user: null`) qu'à une session valide : ce n'est pas une erreur de ne
    // pas être connecté.
    if (segments[1] === 'me') return json({ user: userId }, cors);

    if (userId === null) return json({ error: 'Connexion requise' }, cors, 401);

    if (segments[1] === 'documents') {
      return documents(request, env, cors, userId, segments[2]);
    }

    // L'API sait maintenant QUI demande : favoris, suivi et archivage sont
    // lus et écrits pour cet utilisateur-là, pas pour la fiche partagée.
    return route(db, request, url, segments, cors, userId);
  },
};
