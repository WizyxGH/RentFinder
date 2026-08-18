/**
 * Connexion à la base (§27).
 *
 * Projet 100% local : un fichier SQLite via `@libsql/client` (protocole libsql,
 * utilisé ici en mode fichier — aucun service cloud). La base de test tourne en
 * mémoire. Aucune configuration, aucun compte, aucun jeton n'est requis, ce qui
 * rend la CI possible sur un dépôt public et garantit que les tests exercent le
 * vrai chemin de code sans jamais toucher de données réelles (§52).
 */

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';

export type Database = Client;

/**
 * Base locale par défaut : `<racine du dépôt>/data/local.db`.
 *
 * Le chemin est résolu depuis CE fichier et non depuis le répertoire courant :
 * les CLI des différents packages (collecte, serveur local) doivent tous
 * tomber sur LE MÊME fichier, quel que soit leur répertoire d'exécution.
 * `data/` est dans le `.gitignore` : rien de collecté n'atteint le dépôt (§26).
 */
export function defaultLocalDatabaseUrl(): string {
  // dist/db/client.js → ../../../../data = racine du dépôt.
  const dataDir = fileURLToPath(new URL('../../../../data/', import.meta.url));
  mkdirSync(dataDir, { recursive: true });
  return `file:${dataDir}local.db`;
}

export interface DatabaseOptions {
  readonly url: string;
  readonly authToken?: string;
}

/**
 * Ouvre une connexion : fichier SQLite local, `:memory:` (tests), ou base
 * Turso distante (mode cloud optionnel, §28).
 *
 * @throws si l'URL pointe vers une base distante sans jeton — mieux vaut
 *         échouer immédiatement qu'écrire dans le vide.
 */
export function openDatabase(options: DatabaseOptions): Database {
  const isRemote = options.url.startsWith('libsql://') || options.url.startsWith('https://');
  if (isRemote && (options.authToken === undefined || options.authToken === '')) {
    throw new Error('TURSO_AUTH_TOKEN est requis pour une base distante (voir .env.example).');
  }

  const client = createClient({
    url: options.url,
    ...(options.authToken !== undefined && options.authToken !== ''
      ? { authToken: options.authToken }
      : {}),
  });
  // WAL : lectures et écritures simultanées sans blocage — le serveur local
  // peut servir l'interface PENDANT qu'une collecte écrit (sinon, risque de
  // « database is locked »). Fichier local uniquement ; best-effort.
  if (options.url.startsWith('file:')) {
    client.execute('PRAGMA journal_mode = WAL').catch(() => {
      /* pragma non supporté : on garde le mode par défaut */
    });
  }
  return client;
}

/**
 * Ouvre la base à partir de l'environnement.
 *
 * Priorités : `TEST_DATABASE_URL` (tests, §52) → `TURSO_DATABASE_URL` (mode
 * cloud optionnel — c'est la variable que renseignent GitHub Actions et le
 * Worker) → `DATABASE_URL` (autre fichier local) → base locale par défaut.
 */
export function openDatabaseFromEnv(env: NodeJS.ProcessEnv = process.env): Database {
  if (env['NODE_ENV'] === 'test' || env['VITEST'] === 'true') {
    return openDatabase({ url: env['TEST_DATABASE_URL'] ?? ':memory:' });
  }

  const turso = env['TURSO_DATABASE_URL'];
  if (turso !== undefined && turso !== '') {
    return openDatabase({ url: turso, authToken: env['TURSO_AUTH_TOKEN'] });
  }

  const url = env['DATABASE_URL'];
  return openDatabase({ url: url !== undefined && url !== '' ? url : defaultLocalDatabaseUrl() });
}
