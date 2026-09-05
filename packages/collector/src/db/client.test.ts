/**
 * Où la collecte écrit.
 *
 * Ce choix ne se voit nulle part à l'exécution : on lit « 42 annonces
 * collectées » que les données soient parties vers la base du site ou vers un
 * fichier que plus aucun écran ne sait ouvrir. D'où des tests sur la RÈGLE
 * elle-même.
 */

import { describe, expect, it } from 'vitest';
import { databaseTarget } from './client.js';

describe('databaseTarget', () => {
  it('vise Turso dès que son adresse est fournie', () => {
    const target = databaseTarget({
      TURSO_DATABASE_URL: 'libsql://example-base.turso.io',
    } as never);
    expect(target).toEqual({ kind: 'turso', url: 'libsql://example-base.turso.io' });
  });

  it('signale le repli LOCAL, qu’aucune interface ne lit', () => {
    // C'est tout l'objet de ce type : sans lui, une collecte sans Turso
    // annonçait « 42 annonces collectées » et les rangeait dans un fichier
    // qu'aucun écran ne sait ouvrir depuis le retrait du serveur local.
    expect(databaseTarget({} as never).kind).toBe('local');
    // Variable présente mais vide : le même piège, en plus sournois.
    expect(databaseTarget({ TURSO_DATABASE_URL: '' } as never).kind).toBe('local');
  });

  it('respecte DATABASE_URL pour viser un autre fichier', () => {
    const target = databaseTarget({ DATABASE_URL: 'file:./data/essai.db' } as never);
    expect(target).toEqual({ kind: 'local', url: 'file:./data/essai.db' });
  });

  it('isole les tests en mémoire, même si Turso est configuré (§52)', () => {
    // Le filet le plus important du lot : un test qui viserait la base de
    // production l'écraserait sans prévenir.
    const target = databaseTarget({
      VITEST: 'true',
      TURSO_DATABASE_URL: 'libsql://example-production.turso.io',
    } as never);
    expect(target).toEqual({ kind: 'memory', url: ':memory:' });
  });
});
