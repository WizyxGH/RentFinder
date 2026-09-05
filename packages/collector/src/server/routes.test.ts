/**
 * L'ordre d'une liste ne lève jamais d'erreur : il est seulement FAUX, et il
 * faut le remarquer à l'œil. Deux tris l'étaient, relevés le 2026-09-05 sur
 * l'inventaire réel — d'où des tests sur la clause elle-même.
 */

import { describe, expect, it } from 'vitest';
import { buildListQuery } from './routes.js';

const query = (search: string) =>
  buildListQuery(new URL(`https://exemple.invalid/api/listings${search}`));

describe('ordre de la liste', () => {
  it('compte « récent » à la DÉCOUVERTE, pas à la dernière vue', () => {
    // `last_seen_at` se rafraîchit à chaque collecte : une annonce en ligne
    // depuis trois mois y paraissait plus récente qu'une trouvée le matin
    // même. Mesuré : la 1re du classement datait de quatre jours, la 20e du
    // jour même.
    expect(query('?sort=recent').orderBy).toBe('first_seen_at DESC');
    expect(query('?sort=recent').orderBy).not.toContain('last_seen_at');
  });

  it('relègue les annonces SANS PRIX en fin de tri par prix', () => {
    // SQLite classe les valeurs nulles en tête d'un tri croissant : les cinq
    // premières du classement « moins cher » n'avaient aucun prix.
    expect(query('?sort=price').orderBy).toBe('price IS NULL, price ASC');
  });

  it('départage la priorité par la découverte, pour la même raison', () => {
    expect(query('').orderBy).toBe('action_priority DESC, first_seen_at DESC');
    expect(query('?sort=priority').orderBy).toBe('action_priority DESC, first_seen_at DESC');
  });

  it('borne la pagination', () => {
    expect(query('?limit=9999').limit).toBe(500);
    expect(query('?limit=0').limit).toBe(1);
    expect(query('?offset=-5').offset).toBe(0);
  });

  it('masque par défaut les archivées, les louées et les hors-critères', () => {
    const filter = query('').filter;
    expect(filter).toContain('matches_criteria = 1');
    expect(filter).toContain('rented = 0');
    expect(filter).toContain('COALESCE(us.archived, 0) = 0');
  });

  it('ouvre aux hors-critères sur demande explicite', () => {
    expect(query('?all=true').filter).not.toContain('matches_criteria = 1');
  });
});
