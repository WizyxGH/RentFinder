/**
 * Commande : appliquer les migrations (§68).
 *
 *   pnpm db:migrate
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDatabaseFromEnv } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { createLogger } from '../core/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../../../../database/migrations');

async function main(): Promise<void> {
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
