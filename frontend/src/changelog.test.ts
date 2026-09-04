/**
 * Le repère de lecture est la seule chose qui empêche la modale de reparaître.
 * Ses cas limites — jamais lu, repère inconnu, déjà à jour — se traduisent tous
 * par la même faute visible : une fenêtre qui revient à chaque visite.
 */

import { describe, expect, it } from 'vitest';
import { CHANGELOG, latestEntryId, unseenEntries } from './changelog.js';

describe('CHANGELOG', () => {
  it('a des identifiants uniques', () => {
    // Deux entrées de même identifiant rendraient le repère ambigu, et
    // l'affichage dépendrait de laquelle est trouvée en premier.
    const ids = CHANGELOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('va de la plus récente à la plus ancienne', () => {
    const dates = CHANGELOG.map((entry) => entry.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe('unseenEntries', () => {
  it('ne montre rien à qui n’a jamais rien lu', () => {
    // Quelqu'un qui découvre l'application n'a rien à rattraper : lui servir
    // cinq nouveautés avant sa première annonce n'apprendrait rien.
    expect(unseenEntries(null)).toEqual([]);
  });

  it('ne montre rien quand le repère est déjà le plus récent', () => {
    expect(unseenEntries(CHANGELOG[0]!.id)).toEqual([]);
  });

  it('montre ce qui a été publié depuis le repère', () => {
    const third = CHANGELOG[2]!;
    const unseen = unseenEntries(third.id);
    expect(unseen).toHaveLength(2);
    expect(unseen[0]).toEqual(CHANGELOG[0]);
  });

  it('ne montre rien sur un repère inconnu', () => {
    // Entrée retirée, ou identifiant venu d'une version plus récente : tout
    // remontrer serait pire que se taire.
    expect(unseenEntries('2019-01-01-inexistant')).toEqual([]);
  });
});

describe('latestEntryId', () => {
  it('désigne la première entrée', () => {
    expect(latestEntryId()).toBe(CHANGELOG[0]!.id);
  });
});
