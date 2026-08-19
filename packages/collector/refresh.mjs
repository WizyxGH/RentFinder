import { createClient } from '@libsql/client';
import { createRepository } from './dist/db/repository.js';
import { notifyNewListings } from './dist/notify/telegram.js';
import { createLogger } from './dist/core/logger.js';
import { loadDotEnv, loadTelegramConfig } from './dist/config.js';
loadDotEnv();
const config = loadTelegramConfig();
const db = createClient({ url: 'file:../../data/local.db' });

// 1. Supprimer les anciens messages connus (mapping enregistré au dernier envoi).
const rows = await db.execute('SELECT message_id FROM telegram_notifications');
let deleted = 0;
for (const r of rows.rows) {
  const resp = await fetch(`https://api.telegram.org/bot${config.botToken}/deleteMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: config.chatId, message_id: Number(r.message_id) }),
  });
  if (resp.ok) deleted++;
  await new Promise(s => setTimeout(s, 120));
}
console.log('anciens messages supprimés :', deleted);
await db.execute('DELETE FROM telegram_notifications');

// 2. Renvoyer au format album + bouton.
await db.execute("UPDATE listings SET notified=1");
const pend = await db.execute("UPDATE listings SET notified=0 WHERE matches_criteria=1 AND lifecycle='active' AND archived=0");
console.log('à renvoyer en albums :', pend.rowsAffected);
const politeFetch = async (url, init) => {
  for (;;) {
    const resp = await fetch(url, init);
    if (resp.status !== 429) { await new Promise(s => setTimeout(s, 1500)); return resp; }
    const b = await resp.json().catch(()=>null);
    await new Promise(s => setTimeout(s, ((b?.parameters?.retry_after ?? 5)+1)*1000));
  }
};
const report = await notifyNewListings({ repository: createRepository(db), config, logger: createLogger({minLevel:'error'}), fetchImpl: politeFetch });
console.log('rapport :', JSON.stringify(report));
db.close();
