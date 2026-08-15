/**
 * Connexion à la base (§27).
 *
 * Turso en production, fichier SQLite local en développement et en test.
 * L'API `@libsql/client` étant identique dans les deux cas, aucun code métier
 * ne sait sur quoi il tourne — ce qui garantit que les tests d'intégration
 * exercent le vrai chemin de code sans jamais toucher la base de production
 * (§52).
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
 * Ouvre une connexion.
 *
 * @throws si l'URL pointe vers Turso sans jeton d'authentification — mieux vaut
 *         échouer immédiatement qu'écrire dans le vide.
 */
export function openDatabase(options: DatabaseOptions): Database {
  const isRemote = options.url.startsWith('libsql://') || options.url.startsWith('https://');
  if (isRemote && !options.authToken) {
    throw new Error(
      'TURSO_AUTH_TOKEN est requis pour une base distante. ' +
        'Voir .env.example et docs/database.md.',
    );
  }

  return createClient({
    url: options.url,
    ...(options.authToken !== undefined ? { authToken: options.authToken } : {}),
  });
}

/**
 * Ouvre la base à partir de l'environnement.
 *
 * `TEST_DATABASE_URL` a priorité : c'est la garantie qu'un test lancé avec un
 * `.env` de production ne l'atteindra pas (§52).
 */
export function openDatabaseFromEnv(env: NodeJS.ProcessEnv = process.env): Database {
  const testUrl = env['TEST_DATABASE_URL'];
  if (env['NODE_ENV'] === 'test' || env['VITEST'] === 'true') {
    return openDatabase({ url: testUrl ?? ':memory:' });
  }

  const url = env['TURSO_DATABASE_URL'];
  if (url === undefined || url === '') {
    // En CI, une URL absente est une erreur de configuration : un fallback
    // silencieux écrirait dans un fichier éphémère et perdrait la collecte.
    if (env['CI'] !== undefined) {
      throw new Error('TURSO_DATABASE_URL manquant. Voir .env.example.');
    }
    // En local, le mode zéro-configuration prend le relais : tout fonctionne
    // sans compte cloud, dans un fichier SQLite du dépôt (ignoré par git).
    const localUrl = defaultLocalDatabaseUrl();
    console.error(`TURSO_DATABASE_URL absent — base locale utilisée : ${localUrl}`);
    return openDatabase({ url: localUrl });
  }

  const token = env['TURSO_AUTH_TOKEN'];
  return openDatabase({ url, ...(token !== undefined ? { authToken: token } : {}) });
}
