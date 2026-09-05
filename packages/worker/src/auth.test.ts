/**
 * Le cookie de session, et ce qui le protège.
 *
 * Ces deux règles se tiennent l'une l'autre, et se cassent en silence : un
 * `SameSite` trop strict produit une boucle de connexion sans message d'erreur,
 * et l'attribut relâché sans la vérification d'origine ouvre une porte que rien
 * n'annonce. D'où des tests sur les ATTRIBUTS eux-mêmes.
 */

import { describe, expect, it } from 'vitest';
import { ITERATIONS, MAX_WORKER_ITERATIONS, clearedCookie, sessionCookie } from './auth.js';

describe('sessionCookie', () => {
  const cookie = sessionCookie('jeton');

  it('porte le jeton et une durée de vie', () => {
    expect(cookie.startsWith('session=jeton;')).toBe(true);
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  it('reste hors de portée du JavaScript et du réseau en clair', () => {
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
  });

  it('traverse deux domaines — sans quoi la connexion boucle', () => {
    // Le site vit sur github.io, l'API sur workers.dev : pour un navigateur ce
    // sont deux sites. En `Lax`, le cookie n'accompagne aucun appel de l'un
    // vers l'autre — on se connectait, puis l'écran de connexion revenait.
    expect(cookie).toContain('SameSite=None');
    expect(cookie).not.toContain('SameSite=Lax');
    expect(cookie).not.toContain('SameSite=Strict');
  });
});

describe('clearedCookie', () => {
  it('vide le jeton et l’expire immédiatement', () => {
    const cleared = clearedCookie();
    expect(cleared.startsWith('session=;')).toBe(true);
    expect(cleared).toContain('Max-Age=0');
  });

  it('porte les MÊMES attributs que le cookie qu’il remplace', () => {
    // Un navigateur n'écrase un cookie que si le nom, le chemin et le domaine
    // coïncident : des attributs différents laisseraient la session en place et
    // la déconnexion n'aurait aucun effet.
    const cleared = clearedCookie();
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=None', 'Path=/']) {
      expect(cleared, `« ${flag} » manque au cookie de déconnexion`).toContain(flag);
    }
  });
});

describe('itérations PBKDF2', () => {
  it('ne dépasse jamais ce que les Workers acceptent', () => {
    // OWASP conseille 210 000 ; l'implémentation WebCrypto des Workers refuse
    // au-delà de cent mille et lève une exception. Le piège : `add-user`
    // tourne sous Node, qui accepte — le compte se créait sans avertissement,
    // et c'est la connexion qui échouait ensuite par une 500 muette.
    expect(ITERATIONS).toBeLessThanOrEqual(MAX_WORKER_ITERATIONS);
  });

  it('reste assez élevé pour valoir quelque chose', () => {
    expect(ITERATIONS).toBeGreaterThanOrEqual(100_000);
  });
});
