/**
 * Le garde-fou qui remplace `SameSite`.
 *
 * Le cookie est en `SameSite=None` — il n'a pas le choix, le site et l'API sont
 * sur deux domaines. C'est donc cette fonction, et elle seule, qui empêche un
 * autre site d'utiliser une session ouverte. Une régression ici ne casserait
 * rien de visible : tout continuerait de fonctionner, en grand ouvert.
 */

import { describe, expect, it } from 'vitest';
import { forbiddenOrigin } from './origin.js';

const ENV = { ALLOWED_ORIGIN: 'https://wizyxgh.github.io' } as never;

const requestFrom = (method: string, origin: string | null): Request =>
  new Request('https://api.example.invalid/api/documents', {
    method,
    ...(origin === null ? {} : { headers: { Origin: origin } }),
  });

describe('forbiddenOrigin', () => {
  it('laisse passer le site attendu', () => {
    expect(forbiddenOrigin(requestFrom('POST', 'https://wizyxgh.github.io'), ENV)).toBe(false);
  });

  it('refuse une écriture venue d’ailleurs', () => {
    expect(forbiddenOrigin(requestFrom('POST', 'https://mechant.example'), ENV)).toBe(true);
    expect(forbiddenOrigin(requestFrom('DELETE', 'https://mechant.example'), ENV)).toBe(true);
    expect(forbiddenOrigin(requestFrom('PATCH', 'https://mechant.example'), ENV)).toBe(true);
  });

  it('ne bloque pas les lectures : elles ne changent rien', () => {
    expect(forbiddenOrigin(requestFrom('GET', 'https://mechant.example'), ENV)).toBe(false);
    expect(forbiddenOrigin(requestFrom('OPTIONS', 'https://mechant.example'), ENV)).toBe(false);
  });

  it('laisse passer une requête sans origine : ce n’est pas un navigateur', () => {
    // Un script ou une sonde n'a pas de session qui traîne ; c'est l'absence de
    // cookie valide qui l'arrêtera, pas ce garde-fou.
    expect(forbiddenOrigin(requestFrom('POST', null), ENV)).toBe(false);
  });

  it('refuse un sous-domaine qui ressemble', () => {
    // « github.io.mechant.example » commence par la bonne chaîne : une
    // comparaison par préfixe l'aurait accepté.
    expect(
      forbiddenOrigin(requestFrom('POST', 'https://wizyxgh.github.io.mechant.example'), ENV),
    ).toBe(true);
  });
});
