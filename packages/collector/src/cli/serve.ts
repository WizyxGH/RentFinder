/**
 * Commande : serveur local du mode ZÉRO-CLOUD.
 *
 *   pnpm local        (racine : construit l'interface puis lance ce serveur)
 *   pnpm --filter @rentfinder/collector serve
 *
 * Sert sur 127.0.0.1 :
 *   - l'API (routes de `../server/routes.js`), branchée sur la base locale
 *     (fichier SQLite) ;
 *   - l'interface construite en mode `selfhost` (`frontend/dist-local`).
 *
 * SÉCURITÉ. Pas de jeton ici, et c'est un choix : le serveur n'écoute QUE sur
 * l'adresse de bouclage (127.0.0.1), il n'est joignable ni depuis le réseau
 * local ni depuis Internet. Ne jamais changer l'adresse d'écoute sans
 * réintroduire l'authentification (§26).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route } from '../server/routes.js';
import { loadDotEnv } from '../config.js';
import { openDatabaseFromEnv } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { createLogger } from '../core/logger.js';

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env['PORT'] ?? '8788', 10);

const here = fileURLToPath(new URL('.', import.meta.url));
// dist/cli/ → racine du dépôt, puis les artefacts.
const MIGRATIONS_DIR = join(here, '../../../../database/migrations');
const STATIC_DIR = join(here, '../../../../frontend/dist-local');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

/** Reconstruit une `Request` standard depuis la requête Node. */
async function toWebRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }

  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

/** Recopie une `Response` standard vers la réponse Node. */
async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Sert un fichier de l'interface construite, `index.html` par défaut. */
async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  // `normalize` neutralise les `..` ; on vérifie ensuite que le chemin résolu
  // reste bien dans le répertoire servi.
  const relative = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\])+/, '');
  const filePath = join(STATIC_DIR, relative);
  if (!filePath.startsWith(normalize(STATIC_DIR))) {
    res.writeHead(403).end();
    return;
  }

  try {
    const content = await readFile(filePath);
    const mime = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime });
    res.end(content);
  } catch {
    // SPA : toute route inconnue retombe sur l'index.
    try {
      const index = await readFile(join(STATIC_DIR, 'index.html'));
      res.writeHead(200, { 'content-type': MIME_TYPES['.html'] ?? 'text/html' });
      res.end(index);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        "Interface non construite. Lancer d'abord : pnpm --filter frontend run build:selfhost " +
          '(ou simplement : pnpm local)',
      );
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const logger = createLogger({ minLevel: 'info' });
  const db = openDatabaseFromEnv();

  // §68 : le schéma est toujours à jour avant de servir quoi que ce soit.
  const { applied } = await migrate(db, MIGRATIONS_DIR, logger);
  if (applied.length > 0) logger.info('db.migration.done', { applied });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    const segments = url.pathname.split('/').filter(Boolean);

    const handle = async (): Promise<void> => {
      if (segments[0] === 'api') {
        const request = await toWebRequest(req, url);
        // Même origine : aucun en-tête CORS nécessaire.
        const response = await route(db, request, url, segments, {});
        await sendWebResponse(response, res);
        return;
      }
      await serveStatic(url.pathname, res);
    };

    handle().catch((error: unknown) => {
      // §62 : le message d'erreur suffit, jamais de contenu sensible.
      logger.error('serve.request_failed', {
        path: url.pathname,
        error: error instanceof Error ? error.message : 'erreur inconnue',
      });
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Le port ${PORT} est déjà utilisé — un serveur RentFinder tourne probablement déjà.\n` +
          `Ouvrez http://${HOST}:${PORT}, ou lancez avec un autre port : PORT=8789 pnpm local`,
      );
      process.exit(1);
    }
    throw error;
  });

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  RentFinder — mode local (aucun compte cloud requis)');
    console.log(`  Interface : http://${HOST}:${PORT}`);
    console.log('');
    console.log('  Pour collecter les annonces : pnpm collect   (dans un autre terminal)');
    console.log('  Arrêt : Ctrl+C');
    console.log('');
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
