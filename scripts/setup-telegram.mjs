/**
 * Installation guidée des notifications Telegram (§29).
 *
 *   node scripts/setup-telegram.mjs <JETON_DU_BOT>
 *
 * Ce que fait le script :
 *   1. vérifie le jeton auprès de l'API Bot (`getMe`) ;
 *   2. trouve votre `chat_id` tout seul (`getUpdates`) — il suffit d'avoir
 *      envoyé UN message quelconque à votre bot ;
 *   3. écrit TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID dans `.env` (fichier privé,
 *      gitignoré) SANS toucher aux autres lignes ;
 *   4. envoie un message de test pour prouver que tout marche.
 *
 * La seule étape qui reste humaine — créer le bot — se fait dans Telegram :
 * écrire à @BotFather → /newbot → suivre les 2 questions → copier le jeton.
 * Un bot appartient au compte qui le crée ; personne ne peut le faire à votre
 * place. Le jeton est un SECRET : il ne sort jamais de `.env` (§26).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));
const API = 'https://api.telegram.org';

const token = process.argv[2]?.trim();
if (!token) {
  console.error('Usage : node scripts/setup-telegram.mjs <JETON_DU_BOT>');
  console.error('');
  console.error('Pas encore de jeton ? Dans Telegram : @BotFather → /newbot →');
  console.error('choisir un nom puis un identifiant finissant par "bot" → copier le jeton.');
  process.exit(1);
}

/** Appelle une méthode de l'API Bot et rend le `result`, ou lève. */
async function call(method, params) {
  const response = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) {
    const description = data?.description ?? `HTTP ${response.status}`;
    throw new Error(`${method} a échoué : ${description}`);
  }
  return data.result;
}

// --- 1. Le jeton est-il valide ? -------------------------------------------
let bot;
try {
  bot = await call('getMe');
} catch (error) {
  console.error(`✗ Jeton refusé par Telegram (${error.message}).`);
  console.error('  Vérifiez la copie depuis @BotFather (forme : 123456:ABC-DEF…).');
  process.exit(1);
}
console.log(`✓ Bot reconnu : @${bot.username}`);

// --- 2. Trouver le chat_id ---------------------------------------------------
// getUpdates rend les messages reçus par le bot : le vôtre suffit.
let chatId = null;
for (let attempt = 0; attempt < 12 && chatId === null; attempt += 1) {
  const updates = await call('getUpdates');
  for (const update of updates.reverse()) {
    const chat = update.message?.chat ?? update.my_chat_member?.chat;
    if (chat?.type === 'private') {
      chatId = String(chat.id);
      console.log(`✓ Conversation trouvée : ${chat.first_name ?? ''} (chat_id ${chatId})`);
      break;
    }
  }
  if (chatId === null) {
    if (attempt === 0) {
      console.log(`… En attente d'un message. Ouvrez Telegram et écrivez n'importe`);
      console.log(`  quoi à @${bot.username} (par exemple « start »). Je vérifie toutes les 5 s.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
if (chatId === null) {
  console.error('✗ Aucun message reçu par le bot après 60 s — relancez le script');
  console.error(`  après avoir écrit à @${bot.username}.`);
  process.exit(1);
}

// --- 3. Écrire .env sans toucher au reste -----------------------------------
const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').split(/\r?\n/) : [];
const upsert = (content, key, value) => {
  const line = `${key}=${value}`;
  const index = content.findIndex((l) => l.startsWith(`${key}=`));
  if (index >= 0) content[index] = line;
  else content.push(line);
  return content;
};
let next = [...lines];
next = upsert(next, 'TELEGRAM_BOT_TOKEN', token);
next = upsert(next, 'TELEGRAM_CHAT_ID', chatId);
writeFileSync(ENV_PATH, `${next.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
console.log('✓ .env mis à jour (fichier privé, jamais committé).');

// --- 4. Message de test -------------------------------------------------------
await call('sendMessage', {
  chat_id: chatId,
  text: '🏠 RentFinder connecté ! Vous recevrez ici les nouvelles annonces dans vos critères.',
});
console.log('✓ Message de test envoyé — vérifiez votre téléphone.');
console.log('');
console.log('Dernière étape (collecte automatique) :');
console.log('  powershell -ExecutionPolicy Bypass -File scripts\\schedule-collect.ps1');
