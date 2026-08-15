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
}

/** Ouvre une connexion vers un fichier SQLite local (ou `:memory:` en test). */
export function openDatabase(options: DatabaseOptions): Database {
  return createClient({ url: options.url });
}

/**
 * Ouvre la base à partir de l'environnement.
 *
 * `TEST_DATABASE_URL` a priorité : c'est la garantie qu'un test ne touchera
 * jamais la base locale de travail (§52). `DATABASE_URL` permet éventuellement
 * de pointer vers un autre fichier local ; sinon, la base locale par défaut.
 */
export function openDatabaseFromEnv(env: NodeJS.ProcessEnv = process.env): Database {
  if (env['NODE_ENV'] === 'test' || env['VITEST'] === 'true') {
    return openDatabase({ url: env['TEST_DATABASE_URL'] ?? ':memory:' });
  }

  const url = env['DATABASE_URL'];
  return openDatabase({ url: url !== undefined && url !== '' ? url : defaultLocalDatabaseUrl() });
}
