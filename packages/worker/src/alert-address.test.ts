import { describe, expect, it } from 'vitest';
import { alertAddress } from './alert-address.js';

const TEMPLATE = 'alertes+{token}@exemple.invalid';

describe('alertAddress', () => {
  it('place le jeton du compte dans le gabarit', () => {
    expect(alertAddress(TEMPLATE, 'a1b2c3d4e5f6a7b8c9')).toBe(
      'alertes+a1b2c3d4e5f6a7b8c9@exemple.invalid',
    );
  });

  /**
   * Une adresse fausse serait PIRE que pas d'adresse : l'utilisateur poserait
   * une règle de transfert vers le vide et attendrait des alertes qui ne
   * viendraient jamais. Rien ne le lui dirait — un transfert qui n'aboutit pas
   * ne fait aucun bruit.
   */
  it('ne rend rien plutôt qu’une adresse à moitié (§17)', () => {
    expect(alertAddress(undefined, 'jeton')).toBeNull();
    expect(alertAddress('  ', 'jeton')).toBeNull();
    expect(alertAddress(TEMPLATE, null)).toBeNull();
    expect(alertAddress(TEMPLATE, '')).toBeNull();
    // Un gabarit sans emplacement pour le jeton donnerait la MÊME adresse à
    // tout le monde : mieux vaut n'en donner aucune.
    expect(alertAddress('alertes@exemple.invalid', 'jeton')).toBeNull();
  });
});
