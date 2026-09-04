/**
 * Commande : appliquer les migrations (§68).
 *
 *   pnpm db:migrate
 *
 * ELLE LIT `.env`, et c'est essentiel : sans cela `TURSO_DATABASE_URL` n'était
 * pas chargée, `openDatabaseFromEnv` retombait sur le fichier local, et la
 * commande annonçait « 19 migrations appliquées » — sur une base vide, pendant
 * que la vraie restait en arrière. Un outil de migration qui migre la mauvaise
 * base et le dit d'un ton satisfait est pire que pas d'outil du tout.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDatabaseFromEnv } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { createLogger } from '../core/logger.js';
import { loadDotEnv } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../../../../database/migrations');

async function main(): Promise<void> {
  loadDotEnv();
  const logger = createLogger({ minLevel: 'info' });
  const db = openDatabaseFromEnv();

  try {
    const { applied } = await migrate(db, MIGRATIONS_DIR, logger);
    logger.info('db.migration.done', { applied });
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
