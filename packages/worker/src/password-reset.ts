/**
 * Réinitialisation d'un mot de passe oublié (§26).
 *
 * IL N'Y AVAIT AUCUN RECOURS. Un mot de passe perdu, c'était un compte perdu —
 * ses favoris, son suivi, ses pièces déposées, sa recherche enregistrée. Le
 * seul remède demandait quelqu'un ayant accès à la base et à un script.
 *
 * TROIS RÈGLES GOUVERNENT CE FICHIER, et chacune répare une façon différente de
 * transformer un service rendu en porte ouverte :
 *
 *   1. ON NE DIT JAMAIS SI UN COMPTE EXISTE. La demande répond toujours la même
 *      chose, que l'identifiant soit connu ou non, qu'une adresse soit
 *      renseignée ou non. Un formulaire qui répond « compte inconnu » est un
 *      annuaire : il suffit de l'interroger en boucle pour dresser la liste des
 *      comptes, et ces identifiants servent ensuite ailleurs.
 *
 *   2. LE JETON N'EST PAS STOCKÉ, seule son empreinte l'est. Une base qui
 *      fuite ne doit pas livrer des laissez-passer utilisables — c'est la même
 *      règle que pour les mots de passe, pour la même raison.
 *
 *   3. IL EXPIRE ET NE SERT QU'UNE FOIS. Une heure suffit à relever ses
 *      messages ; un lien qui reste valable des mois dans une boîte est une
 *      porte laissée entrouverte, et une boîte se compromet.
 *
 * CE MODULE NE SAIT NI ENVOYER UN E-MAIL NI VÉRIFIER UNE SESSION : il rend le
 * texte à envoyer et l'appelant s'en charge. C'est ce qui le rend testable sans
 * réseau (§59).
 */

import type { Client } from '@libsql/client/web';
import { hashPassword } from './auth.js';

/** Durée de validité d'un lien. Assez pour relever ses messages, pas plus. */
const VALID_MINUTES = 60;

/**
 * Longueur du jeton, en octets.
 *
 * Trente-deux octets tirés au sort, soit 256 bits : deviner celui d'un compte
 * demanderait plus d'essais qu'il n'y a d'atomes à portée. La contrainte
 * pratique est ailleurs — il doit tenir dans une URL sans être réécrit —, d'où
 * l'encodage base64url.
 */
const TOKEN_BYTES = 32;

/** Le jeton, en clair, tel qu'il partira dans le lien. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** L'empreinte d'un jeton, seule forme conservée en base. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Le corps du message envoyé au demandeur.
 *
 * IL DIT QUOI FAIRE SI L'ON N'A RIEN DEMANDÉ, et ce n'est pas une politesse :
 * un message de réinitialisation reçu sans l'avoir demandé est le premier
 * signal qu'un compte est visé. Le taire priverait son propriétaire du seul
 * avertissement qu'il recevra.
 */
export function resetEmailBody(link: string): string {
  return [
    'Vous avez demandé à réinitialiser votre mot de passe Maïoun.',
    '',
    'Suivez ce lien pour en choisir un nouveau :',
    link,
    '',
    `Le lien expire dans ${VALID_MINUTES} minutes et ne fonctionne qu'une fois.`,
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre",
    "mot de passe actuel reste valable. Quelqu'un a saisi votre identifiant, sans",
    'nécessairement le connaître.',
  ].join('\n');
}

/** L'adresse à laquelle le lien mène, préfixe du site compris. */
export function resetLink(siteUrl: string, token: string): string {
  const base = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;
  return `${base}/reset/${encodeURIComponent(token)}`;
}

export interface PendingReset {
  /** À qui écrire. */
  readonly email: string;
  /** Le jeton en clair, à glisser dans le lien. Il n'existe qu'ici. */
  readonly token: string;
}

/**
 * Ouvre une demande de réinitialisation. `null` si rien n'est à envoyer.
 *
 * `null` couvre DEUX cas qu'il ne faut surtout pas distinguer au-dehors : le
 * compte n'existe pas, ou il n'a pas d'adresse. L'appelant répond la même chose
 * dans les deux cas, et dans le cas où tout s'est bien passé.
 *
 * Les demandes précédentes du même compte sont annulées : deux liens valables
 * en même temps doublent la surface d'attaque pour aucun service rendu, et l'on
 * clique de toute façon sur le dernier reçu.
 */
export async function openReset(
  db: Client,
  login: string,
  nowMs: number,
): Promise<PendingReset | null> {
  const found = await db.execute({
    sql: 'SELECT id, email FROM users WHERE login = ? LIMIT 1',
    args: [login.trim()],
  });
  const row = found.rows[0];
  const userId = row?.['id'];
  const email = row?.['email'];
  if (typeof userId !== 'string' || typeof email !== 'string' || email.trim() === '') return null;

  const token = newToken();
  const tokenHash = await hashToken(token);
  const now = new Date(nowMs);
  const expires = new Date(nowMs + VALID_MINUTES * 60_000);

  await db.batch(
    [
      { sql: 'DELETE FROM password_resets WHERE user_id = ?', args: [userId] },
      {
        sql: `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at)
              VALUES (?, ?, ?, ?)`,
        args: [tokenHash, userId, now.toISOString(), expires.toISOString()],
      },
    ],
    'write',
  );

  return { email: email.trim(), token };
}

export type ResetOutcome = 'ok' | 'invalid' | 'weak';

/**
 * Longueur minimale d'un mot de passe.
 *
 * Huit caractères : le plancher en deçà duquel une attaque hors ligne n'a plus
 * besoin d'être maligne. On ne réclame ni majuscule ni chiffre — ces règles
 * produisent surtout des mots de passe notés sur un papier.
 */
const MIN_PASSWORD = 8;

/**
 * Consomme un jeton et pose le nouveau mot de passe.
 *
 * `invalid` recouvre jeton inconnu, expiré ou déjà servi : les distinguer
 * apprendrait à qui essaie au hasard qu'un jeton a existé, et ne changerait
 * rien pour le demandeur légitime, qui n'a qu'une chose à faire — redemander
 * un lien.
 */
export async function completeReset(
  db: Client,
  token: string,
  password: string,
  nowMs: number,
): Promise<ResetOutcome> {
  if (password.length < MIN_PASSWORD) return 'weak';

  const tokenHash = await hashToken(token);
  const found = await db.execute({
    sql: 'SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ? LIMIT 1',
    args: [tokenHash],
  });
  const row = found.rows[0];
  if (row === undefined) return 'invalid';

  const userId = row['user_id'];
  const expiresAt = row['expires_at'];
  if (typeof userId !== 'string' || typeof expiresAt !== 'string') return 'invalid';
  if (row['used_at'] !== null && row['used_at'] !== undefined) return 'invalid';
  if (Date.parse(expiresAt) <= nowMs) return 'invalid';

  const hash = await hashPassword(password);
  await db.batch(
    [
      { sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, userId] },
      {
        sql: 'UPDATE password_resets SET used_at = ? WHERE token_hash = ?',
        args: [new Date(nowMs).toISOString(), tokenHash],
      },
    ],
    'write',
  );
  return 'ok';
}
