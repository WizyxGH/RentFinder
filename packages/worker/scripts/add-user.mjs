/**
 * Crée ou met à jour un compte.
 *
 *   pnpm --filter @rentfinder/worker user:add
 *
 * POURQUOI UNE COMMANDE, ET PAS UN ÉCRAN D'INSCRIPTION. Un site ouvert à
 * l'inscription est un site que n'importe qui peut remplir ; celui-ci est un
 * outil personnel, partagé avec les gens qu'on choisit. Créer un compte est
 * donc un geste d'administration, fait depuis la machine qui a déjà accès à la
 * base.
 *
 * LE MOT DE PASSE NE S'AFFICHE PAS et n'est jamais journalisé. Il n'atteint pas
 * non plus la ligne de commande : le passer en argument le laisserait dans
 * l'historique du terminal (§26). Seule son empreinte PBKDF2 est écrite.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { hashPassword } from '../dist/auth.js';

/** Lit `.env` sans écraser ce que l'environnement fournit déjà. */
function loadEnv() {
  try {
    for (const line of readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split(
      /\r?\n/,
    )) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* pas de .env : on comptera sur l'environnement */
  }
}

/** Demande le mot de passe sans l'afficher, deux fois. */
async function askPassword(rl) {
  const hidden = (query) =>
    new Promise((resolve) => {
      const onData = (char) => {
        // Le terminal reçoit les frappes ; on n'en réaffiche aucune.
        if (['\n', '\r', ''].includes(String(char))) stdin.removeListener('data', onData);
      };
      stdin.on('data', onData);
      const previous = rl.output.write.bind(rl.output);
      rl.output.write = (chunk) => (chunk.includes(query) ? previous(chunk) : true);
      rl.question(query).then((answer) => {
        rl.output.write = previous;
        stdout.write('\n');
        resolve(answer);
      });
    });

  const first = await hidden('Mot de passe : ');
  const second = await hidden('Confirmation : ');
  if (first !== second) throw new Error('Les deux saisies diffèrent.');
  if (first.length < 10) throw new Error('Dix caractères au minimum.');
  return first;
}

async function main() {
  loadEnv();
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('TURSO_DATABASE_URL manquante (.env ou environnement).');

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const login = (await rl.question('Identifiant : ')).trim();
    if (login === '') throw new Error('Identifiant vide.');
    const name = (await rl.question('Nom affiché (facultatif) : ')).trim();
    const password = await askPassword(rl);

    const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    const hash = await hashPassword(password);
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE login = ?',
      args: [login],
    });

    if (existing.rows.length > 0) {
      await db.execute({
        sql: 'UPDATE users SET password_hash = ?, display_name = COALESCE(NULLIF(?, %s), display_name) WHERE login = ?'.replace(
          '%s',
          "''",
        ),
        args: [hash, name, login],
      });
      console.log(`Mot de passe mis à jour pour « ${login} ».`);
      return;
    }

    /**
     * LE PREMIER COMPTE ADOPTE LES DONNÉES EXISTANTES.
     *
     * La migration multi-compte a laissé une ligne `moi` sans identifiant de
     * connexion, et TOUT ce qui précède y est rattaché : états d'annonces,
     * favoris, réglages, recherches enregistrées. L'identifiant servant d'id,
     * créer « wizyx » aurait fabriqué un compte vierge à côté — on se serait
     * connecté pour découvrir zéro favori, et conclu à une perte de données.
     *
     * On ne l'adopte que dans le cas où il n'y a rien à trancher : la ligne
     * existe, elle n'a pas de login, et aucun autre compte n'en a un. Dès qu'un
     * vrai compte existe, un nouveau est créé normalement.
     */
    const orphan = await db.execute(
      `SELECT (SELECT COUNT(*) FROM users WHERE login IS NOT NULL) AS named,
              (SELECT COUNT(*) FROM users WHERE id = 'moi' AND login IS NULL) AS placeholder`,
    );
    const named = Number(orphan.rows[0]?.['named'] ?? 0);
    const placeholder = Number(orphan.rows[0]?.['placeholder'] ?? 0);

    if (named === 0 && placeholder === 1) {
      await db.execute({
        sql: `UPDATE users SET login = ?, password_hash = ?, display_name = ?
              WHERE id = 'moi'`,
        args: [login, hash, name === '' ? null : name],
      });
      console.log(`Compte « ${login} » créé, sur les données déjà en base.`);
      console.log('Vos favoris, votre suivi et vos réglages lui restent attachés.');
      return;
    }

    // L'identifiant sert d'id : lisible dans les données, et stable.
    await db.execute({
      // Le jeton d'adresse de transfert est tiré ici, et non à la première
      // visite : un compte sans jeton n'aurait pas d'adresse à afficher, et
      // rien ne viendrait le signaler.
      sql: `INSERT INTO users (id, login, password_hash, display_name, created_at, alert_token)
            VALUES (?, ?, ?, ?, datetime('now'), lower(hex(randomblob(9))))`,
      args: [login, login, hash, name === '' ? null : name],
    });
    console.log(`Compte « ${login} » créé.`);
    console.log(
      'Ses favoris et son suivi lui seront propres ; les annonces, elles, sont communes.',
    );
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
