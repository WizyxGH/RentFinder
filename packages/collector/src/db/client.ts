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

/** Où la collecte va écrire, et par quelle règle. */
export interface DatabaseTarget {
  /**
   * `turso` : la base que lit le site. `memory` : les tests. `local` : un
   * fichier sur cette machine, QUE PLUS AUCUNE INTERFACE NE LIT.
   */
  readonly kind: 'turso' | 'local' | 'memory';
  readonly url: string;
}

/**
 * Décide de la cible SANS l'ouvrir.
 *
 * Séparé de l'ouverture pour que les appelants puissent le DIRE avant d'écrire.
 * Le repli local est devenu un piège silencieux le jour où le serveur local a
 * été retiré : une collecte sans `TURSO_DATABASE_URL` annonce « 42 annonces
 * collectées » et les range dans un fichier qu'aucun écran ne saura ouvrir. On
 * a cherché la panne du côté des sources, alors que les données étaient
 * simplement ailleurs.
 *
 * Le repli n'est pas retiré pour autant : il reste la bonne façon d'essayer un
 * nouveau scraper sans toucher à la base de production. Ce qui devait
 * disparaître, c'est son silence.
 *
 * Priorités : tests (§52) → `TURSO_DATABASE_URL` → `DATABASE_URL` → fichier
 * local par défaut.
 */
export function databaseTarget(env: NodeJS.ProcessEnv = process.env): DatabaseTarget {
  if (env['NODE_ENV'] === 'test' || env['VITEST'] === 'true') {
    return { kind: 'memory', url: env['TEST_DATABASE_URL'] ?? ':memory:' };
  }

  const turso = env['TURSO_DATABASE_URL'];
  if (turso !== undefined && turso !== '') return { kind: 'turso', url: turso };

  const url = env['DATABASE_URL'];
  return { kind: 'local', url: url !== undefined && url !== '' ? url : defaultLocalDatabaseUrl() };
}

/** Ouvre la base désignée par l'environnement. Voir `databaseTarget`. */
export function openDatabaseFromEnv(env: NodeJS.ProcessEnv = process.env): Database {
  const target = databaseTarget(env);
  return target.kind === 'turso'
    ? openDatabase({ url: target.url, authToken: env['TURSO_AUTH_TOKEN'] })
    : openDatabase({ url: target.url });
}
