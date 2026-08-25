/**
 * Commande `pnpm draft` — crée des BROUILLONS Gmail pour les annonces
 * pertinentes (§22).
 *
 * Pour chaque annonce dans les critères, active, dotée d'un e-mail de contact et
 * sans brouillon déjà créé, on compose le message (profil + message fixe
 * éventuel) et on dépose un brouillon dans le dossier « Brouillons » de la boîte
 * IMAP configurée. RIEN N'EST ENVOYÉ : l'utilisateur relit et envoie lui-même.
 *
 * Nécessite IMAP_* et un profil locataire (TENANT_*). Idempotent : un brouillon
 * n'est créé qu'une fois par annonce (colonne `drafted`).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMessage } from '@rentfinder/shared';
import { openDatabaseFromEnv } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { createRepository } from '../db/repository.js';
import { createLogger } from '../core/logger.js';
import { loadDotEnv, loadImapConfig, loadTenantProfile } from '../config.js';
import { createGmailDrafts, type DraftContent } from '../notify/gmail-draft.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../../../../database/migrations');

async function main(): Promise<void> {
  loadDotEnv();
  const logger = createLogger({ minLevel: 'info' });

  const imap = loadImapConfig();
  if (imap === null) {
    console.log('⚠️  IMAP non configuré (IMAP_USER / IMAP_APP_PASSWORD). Rien à faire.');
    return;
  }
  const profile = loadTenantProfile();
  if (profile === null) {
    console.log(
      '⚠️  Profil locataire non renseigné (TENANT_*). Impossible de composer un message.',
    );
    return;
  }

  const db = openDatabaseFromEnv();
  try {
    await migrate(db, MIGRATIONS_DIR, logger);
    const repository = createRepository(db);

    const pending = await repository.pendingDrafts();
    console.log(`✉️  ${pending.length} annonce(s) pertinente(s) avec e-mail, sans brouillon.`);
    if (pending.length === 0) return;

    const drafts: DraftContent[] = pending.map((entry) => {
      const message = prepareMessage(entry.listing, profile);
      return {
        listingId: entry.id,
        to: entry.email,
        subject: message.subject,
        body: message.body,
      };
    });

    const created = await createGmailDrafts({
      config: imap,
      drafts,
      log: (event, fields) => logger.info(event, fields),
    });
    await repository.markDrafted(created);

    console.log(`📝 ${created.length} brouillon(s) créé(s) dans « Brouillons » (${imap.user}).`);
    console.log('   Relis-les et envoie-les toi-même — rien n’est parti automatiquement (§22).');
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error('Échec de la création des brouillons :', error);
  process.exitCode = 1;
});
