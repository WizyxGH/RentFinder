import { describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client/web';
import {
  completeReset,
  hashToken,
  newToken,
  openReset,
  resetEmailBody,
  resetLink,
} from './password-reset.js';

type Row = Record<string, unknown>;

/**
 * Une base en mémoire réduite aux deux tables que ce module touche.
 *
 * Un vrai libsql demanderait un serveur ; ce qu'on veut vérifier ici est une
 * suite de RÈGLES — expiration, usage unique, silence sur l'existence d'un
 * compte — et elles se lisent entièrement dans les allers-retours SQL (§59).
 */
function fakeDb(users: Row[]): Client & { resets: Row[]; passwords: Row[] } {
  const resets: Row[] = [];
  const passwords: Row[] = [];

  const run = (sql: string, args: unknown[]): Row[] => {
    if (sql.includes('SELECT id, email FROM users')) {
      return users.filter((user) => user['login'] === args[0]);
    }
    if (sql.includes('SELECT user_id, expires_at, used_at FROM password_resets')) {
      return resets.filter((reset) => reset['token_hash'] === args[0]);
    }
    if (sql.startsWith('DELETE FROM password_resets')) {
      for (let i = resets.length - 1; i >= 0; i -= 1) {
        if (resets[i]?.['user_id'] === args[0]) resets.splice(i, 1);
      }
      return [];
    }
    if (sql.includes('INSERT INTO password_resets')) {
      resets.push({
        token_hash: args[0],
        user_id: args[1],
        created_at: args[2],
        expires_at: args[3],
        used_at: null,
      });
      return [];
    }
    if (sql.includes('UPDATE users SET password_hash')) {
      passwords.push({ hash: args[0], user_id: args[1] });
      return [];
    }
    if (sql.includes('UPDATE password_resets SET used_at')) {
      const found = resets.find((reset) => reset['token_hash'] === args[1]);
      if (found !== undefined) found['used_at'] = args[0];
      return [];
    }
    throw new Error(`SQL non prévu par le double : ${sql}`);
  };

  const client = {
    resets,
    passwords,
    execute: (statement: { sql: string; args: unknown[] }) =>
      Promise.resolve({ rows: run(statement.sql, statement.args) }),
    batch: (statements: { sql: string; args: unknown[] }[]) => {
      for (const statement of statements) run(statement.sql, statement.args);
      return Promise.resolve([]);
    },
  };
  return client as unknown as Client & { resets: Row[]; passwords: Row[] };
}

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const USERS: Row[] = [
  { id: 'moi', login: 'florian', email: 'florian@example.invalid' },
  { id: 'sans-adresse', login: 'muet', email: null },
];

describe('jetons', () => {
  it('ne se répète pas', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newToken()));
    expect(tokens.size).toBe(50);
  });

  it('tient dans une URL sans être réécrit', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it('ne se retrouve pas depuis son empreinte', async () => {
    const token = newToken();
    const hash = await hashToken(token);
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64);
    // Déterministe : c'est ce qui permet de retrouver la ligne sans stocker le
    // jeton lui-même.
    expect(await hashToken(token)).toBe(hash);
  });
});

describe('openReset', () => {
  it('ouvre une demande pour un compte connu et adressable', async () => {
    const db = fakeDb(USERS);
    const pending = await openReset(db, 'florian', NOW);
    expect(pending?.email).toBe('florian@example.invalid');
    expect(db.resets).toHaveLength(1);
    // Le jeton EN CLAIR n'est jamais rangé : seule son empreinte l'est.
    expect(db.resets[0]?.['token_hash']).toBe(await hashToken(pending!.token));
    expect(JSON.stringify(db.resets)).not.toContain(pending!.token);
  });

  /**
   * Les deux refus rendent `null` SANS SE DISTINGUER, et l'appelant répond la
   * même chose dans les deux cas comme dans le cas qui réussit. Un formulaire
   * qui dirait « compte inconnu » serait un annuaire de comptes.
   */
  it('ne distingue pas compte inconnu et compte sans adresse', async () => {
    const db = fakeDb(USERS);
    expect(await openReset(db, 'personne', NOW)).toBeNull();
    expect(await openReset(db, 'muet', NOW)).toBeNull();
    expect(db.resets).toHaveLength(0);
  });

  it('annule la demande précédente du même compte', async () => {
    const db = fakeDb(USERS);
    const first = await openReset(db, 'florian', NOW);
    await openReset(db, 'florian', NOW + 1000);
    expect(db.resets).toHaveLength(1);
    // Deux liens valables à la fois doublent la surface d'attaque sans rendre
    // service : on clique de toute façon sur le dernier reçu.
    expect(db.resets[0]?.['token_hash']).not.toBe(await hashToken(first!.token));
  });
});

describe('completeReset', () => {
  it('pose le nouveau mot de passe et brûle le jeton', async () => {
    const db = fakeDb(USERS);
    const pending = await openReset(db, 'florian', NOW);
    expect(await completeReset(db, pending!.token, 'un-mot-de-passe', NOW + 60_000)).toBe('ok');
    expect(db.passwords).toHaveLength(1);
    expect(db.passwords[0]?.['user_id']).toBe('moi');
    // Le mot de passe est HACHÉ, jamais rangé en clair.
    expect(String(db.passwords[0]?.['hash'])).toMatch(/^pbkdf2\$/);
  });

  it('refuse un jeton déjà servi', async () => {
    const db = fakeDb(USERS);
    const pending = await openReset(db, 'florian', NOW);
    await completeReset(db, pending!.token, 'un-mot-de-passe', NOW + 60_000);
    expect(await completeReset(db, pending!.token, 'un-autre-encore', NOW + 120_000)).toBe(
      'invalid',
    );
    expect(db.passwords).toHaveLength(1);
  });

  it('refuse un jeton expiré', async () => {
    const db = fakeDb(USERS);
    const pending = await openReset(db, 'florian', NOW);
    // Une heure et une minute plus tard.
    expect(await completeReset(db, pending!.token, 'un-mot-de-passe', NOW + 61 * 60_000)).toBe(
      'invalid',
    );
    expect(db.passwords).toHaveLength(0);
  });

  it('refuse un jeton inconnu', async () => {
    const db = fakeDb(USERS);
    expect(await completeReset(db, newToken(), 'un-mot-de-passe', NOW)).toBe('invalid');
  });

  it('refuse un mot de passe trop court, sans consommer le jeton', async () => {
    const db = fakeDb(USERS);
    const pending = await openReset(db, 'florian', NOW);
    expect(await completeReset(db, pending!.token, 'court', NOW)).toBe('weak');
    // Le jeton reste utilisable : une saisie trop courte n'est pas une attaque,
    // et forcer à redemander un lien pour cela serait une punition.
    expect(await completeReset(db, pending!.token, 'assez-long-cette-fois', NOW)).toBe('ok');
  });
});

describe('le message envoyé', () => {
  it('porte un lien absolu, quelle que soit la forme de SITE_URL', () => {
    expect(resetLink('https://exemple.invalid/App/', 'jeton')).toBe(
      'https://exemple.invalid/App/reset/jeton',
    );
    expect(resetLink('https://exemple.invalid/App', 'jeton')).toBe(
      'https://exemple.invalid/App/reset/jeton',
    );
  });

  /**
   * Un message reçu sans l'avoir demandé est le PREMIER SIGNAL qu'un compte est
   * visé. Le taire priverait son propriétaire du seul avertissement qu'il aura.
   */
  it('dit quoi faire quand on n’a rien demandé', () => {
    const body = resetEmailBody('https://exemple.invalid/reset/jeton');
    expect(body).toContain('https://exemple.invalid/reset/jeton');
    expect(body).toMatch(/n'êtes pas à l'origine|n’êtes pas à l’origine/);
    expect(body).toContain('expire');
  });
});
