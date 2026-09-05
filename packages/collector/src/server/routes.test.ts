/**
 * L'ordre d'une liste ne lève jamais d'erreur : il est seulement FAUX, et il
 * faut le remarquer à l'œil. Deux tris l'étaient, relevés le 2026-09-05 sur
 * l'inventaire réel — d'où des tests sur la clause elle-même.
 */

import { describe, expect, it } from 'vitest';
import { buildListQuery, rowToListing } from './routes.js';

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

/**
 * LA TRADUCTION D'UNE LIGNE SQL EN FICHE, et ce qu'elle laissait tomber.
 *
 * Un champ oublié ici ne lève pas : il vaut `undefined`, et l'écran qui le lit
 * l'écarte en silence. C'est ce qui est arrivé à la date d'alerte — l'historique
 * annonçait « aucune alerte » alors que la base en comptait cent dix-huit.
 */
describe('rowToListing', () => {
  const row = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'src:1',
    lifecycle: 'active',
    tracking: 'new',
    first_seen_at: '2026-09-01T10:00:00.000Z',
    last_seen_at: '2026-09-05T10:00:00.000Z',
    matches_criteria: 1,
    action_priority: 80,
    payload: '{"title":{"value":"Studio"}}',
    ...extra,
  });

  it('rend la DATE DE L’ALERTE, sans quoi l’historique est vide', () => {
    const listing = rowToListing(row({ notified_at: '2026-09-05T12:03:47.320Z' }));
    expect(listing['notifiedAt']).toBe('2026-09-05T12:03:47.320Z');
  });

  it('rend `null` — et non `undefined` — pour une annonce jamais signalée', () => {
    // `null` DIT quelque chose : cette annonce n'a pas fait l'objet d'une
    // alerte. `undefined` ne dit rien, et ne se distingue pas d'un champ
    // qu'on aurait oublié de recopier — c'est précisément la confusion qui a
    // fait disparaître l'historique.
    expect(rowToListing(row())['notifiedAt']).toBeNull();
  });

  it('rend les états qui appartiennent à QUELQU’UN, pas à l’annonce', () => {
    const listing = rowToListing(
      row({ viewed: 1, archived: 0, favorite: 1, rented: 0, tracking: 'contacted' }),
    );
    expect(listing['viewed']).toBe(true);
    expect(listing['archived']).toBe(false);
    expect(listing['favorite']).toBe(true);
    expect(listing['tracking']).toBe('contacted');
  });

  it('déplie le payload par-dessus, sans écraser l’identifiant', () => {
    const listing = rowToListing(row());
    expect(listing['id']).toBe('src:1');
    expect(listing['title']).toEqual({ value: 'Studio' });
  });
});
