import { createClient } from '@libsql/client';
import { createRepository } from './dist/db/repository.js';
import { notifyNewListings } from './dist/notify/telegram.js';
import { createLogger } from './dist/core/logger.js';
import { loadDotEnv, loadTelegramConfig } from './dist/config.js';

loadDotEnv();
const config = loadTelegramConfig();
if (!config) {
  console.log('Telegram non configuré');
  process.exit(1);
}
const db = createClient({ url: 'file:../../data/local.db' });

const r = await db.execute(`UPDATE listings SET notified=0
  WHERE matches_criteria=1 AND lifecycle='active' AND archived=0`);
console.log('annonces à envoyer :', r.rowsAffected);

// ~1 envoi / 3,5 s + gestion du 429 : sous les limites Telegram.
const politeFetch = async (url, init) => {
  for (;;) {
    const resp = await fetch(url, init);
    if (resp.status !== 429) {
      await new Promise((s) => setTimeout(s, 3500));
      return resp;
    }
    const body = await resp.json().catch(() => null);
    const wait = (body?.parameters?.retry_after ?? 10) + 1;
    console.log('429 — pause', wait, 's');
    await new Promise((s) => setTimeout(s, wait * 1000));
  }
};

const report = await notifyNewListings({
  repository: createRepository(db),
  config,
  logger: createLogger({ minLevel: 'error' }),
  fetchImpl: politeFetch,
});
console.log('rapport final :', JSON.stringify(report));
db.close();
