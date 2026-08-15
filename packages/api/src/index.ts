/**
 * API RentFinder — transport Cloudflare Worker (§28).
 *
 * Rôle : exposer à l'interface les données de Turso, sans que le frontend
 * public n'ait jamais connaissance des credentials de la base. Toutes les
 * routes exigent le jeton d'accès (§26).
 *
 * La logique des routes vit dans `routes.ts`, partagée avec le serveur local
 * du mode zéro-cloud ; ce fichier ne gère que le protocole : CORS,
 * authentification, gestion d'erreur.
 */

import { createClient } from '@libsql/client/web';
import { corsHeaders, requireAuth } from './auth.js';
import { route } from './routes.js';

export interface Env {
  readonly TURSO_DATABASE_URL: string;
  readonly TURSO_AUTH_TOKEN: string;
  readonly API_ACCESS_TOKEN: string;
  readonly API_ALLOWED_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env.API_ALLOWED_ORIGIN ?? '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const unauthorized = requireAuth(request, env.API_ACCESS_TOKEN);
    if (unauthorized !== null) {
      // Les en-têtes CORS doivent accompagner l'erreur, sinon le navigateur
      // masque le 401 derrière une erreur réseau opaque et l'interface ne peut
      // pas proposer de ressaisir le jeton.
      const headers = new Headers(unauthorized.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      return new Response(unauthorized.body, { status: unauthorized.status, headers });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'api') {
      return new Response(JSON.stringify({ error: 'Route inconnue' }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
      });
    }

    const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

    try {
      return await route(db, request, url, segments, cors);
    } catch (error) {
      // §62 : jamais de secret dans la réponse ni dans les logs.
      console.error('api.error', error instanceof Error ? error.message : 'erreur inconnue');
      return new Response(JSON.stringify({ error: 'Erreur interne' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
      });
    }
  },
};
