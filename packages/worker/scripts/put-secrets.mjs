/**
 * Dépose les trois secrets du Worker (§26, §28).
 *
 * POURQUOI UN SCRIPT PLUTÔT QUE TROIS COMMANDES. `wrangler secret put` ouvre
 * une invite : on y colle une adresse `libsql://` et un jeton de deux cents
 * caractères, lus dans `.env`. Un copier-coller de cette longueur se rate — un
 * espace de trop, une coupure — et l'erreur ne se voit qu'à la première requête
 * du site, sous la forme d'une panne sans rapport apparent.
 *
 * LES VALEURS NE SONT JAMAIS AFFICHÉES, ni ici ni ailleurs : elles vont
 * directement de `.env` à l'entrée standard de wrangler. Ce script ne journalise
 * que des noms.
 *
 * `SESSION_SECRET` N'EXISTE NULLE PART : il ne sert qu'à signer les cookies de
 * session, personne n'a à le connaître, et il est donc TIRÉ AU HASARD ici. Le
 * perdre n'a qu'une conséquence — chacun se reconnecte.
 *
 * Usage, depuis `packages/worker` :
 *   node scripts/put-secrets.mjs
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));

/** Lit `.env` sans rien en afficher. Tolère CRLF, guillemets et commentaires. */
function readEnv() {
  const values = new Map();
  let raw;
  try {
    raw = readFileSync(ENV_PATH, 'utf8');
  } catch {
    return values;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    values.set(
      line.slice(0, at).trim(),
      line
        .slice(at + 1)
        .trim()
        .replace(/^["']|["']$/g, ''),
    );
  }
  return values;
}

/**
 * Confie une valeur à `wrangler secret put`, par l'entrée standard.
 *
 * `shell: true` sur Windows : sans lui, `npx` n'est pas trouvé — c'est un
 * script de commandes, pas un exécutable.
 */
function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', 'secret', 'put', name], {
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler a répondu ${code} pour ${name}`));
    });
    child.stdin.write(value);
    child.stdin.end();
  });
}

const env = readEnv();
const missing = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'].filter(
  (name) => (env.get(name) ?? '') === '',
);

if (missing.length > 0) {
  console.error(
    `\n✗ ${missing.join(' et ')} ${missing.length > 1 ? 'sont absents' : 'est absent'} de .env.\n` +
      '  Ces valeurs viennent de votre base Turso — voir docs/deployment.md, étape 1.\n',
  );
  process.exit(1);
}

// Trente-deux octets : bien au-delà de ce qu'une signature HMAC demande, et
// sans coût. `base64url` évite toute question d'échappement dans un shell.
const secrets = [
  ['TURSO_DATABASE_URL', env.get('TURSO_DATABASE_URL')],
  ['TURSO_AUTH_TOKEN', env.get('TURSO_AUTH_TOKEN')],
  ['SESSION_SECRET', env.get('SESSION_SECRET') || randomBytes(32).toString('base64url')],
];

console.log('\nDépôt des secrets du Worker. Aucune valeur ne sera affichée.\n');
for (const [name, value] of secrets) {
  process.stdout.write(`  → ${name} `);
  await putSecret(name, value);
}
console.log(
  '\n✓ Terminé. Vérifiez avec `npx wrangler secret list` : trois noms, sans leurs valeurs.\n' +
    '  SESSION_SECRET a été tiré au hasard et n’est stocké nulle part : le\n' +
    '  redéposer déconnectera simplement tout le monde.\n',
);
