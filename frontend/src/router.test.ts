/**
 * La table des routes est ce qu'on relit pour savoir ce que le site expose.
 * On la vérifie donc dans les deux sens : un chemin qui se lit et un écran qui
 * se réécrit à l'identique — sans quoi le bouton « Précédent » ramènerait
 * ailleurs qu'à l'endroit d'où l'on vient.
 */

import { describe, expect, it } from 'vitest';
import { pathFromRoute, routeFromPath, sameRoute, type Route } from './router.js';

const ROUTES: readonly { path: string; route: Route }[] = [
  { path: '/', route: { view: 'home' } },
  { path: '/recherche', route: { view: 'list' } },
  { path: '/favoris', route: { view: 'list', favoritesOnly: true } },
  { path: '/annonce/seloger%3A123', route: { view: 'detail', id: 'seloger:123' } },
  { path: '/agence/century21', route: { view: 'agency', id: 'century21' } },
  { path: '/sources', route: { view: 'sources' } },
  { path: '/sources/fnaim', route: { view: 'source', id: 'fnaim' } },
  { path: '/statistiques', route: { view: 'stats' } },
  { path: '/alertes', route: { view: 'alerts' } },
  { path: '/parametres', route: { view: 'profile' } },
  { path: '/parametres/profil', route: { view: 'tenant' } },
  { path: '/parametres/dossier', route: { view: 'documents' } },
  { path: '/parametres/adresses', route: { view: 'reference' } },
  { path: '/parametres/recherches', route: { view: 'saved' } },
  { path: '/parametres/notifications', route: { view: 'notifications' } },
  { path: '/parametres/theme', route: { view: 'theme' } },
];

describe('routeFromPath', () => {
  for (const { path, route } of ROUTES) {
    it(`lit ${path}`, () => {
      expect(routeFromPath(path)).toEqual(route);
    });
  }

  it("décode l'identifiant : une annonce porte un « : » dans le sien", () => {
    expect(routeFromPath('/annonce/seloger%3A12%3A34')).toEqual({
      view: 'detail',
      id: 'seloger:12:34',
    });
  });

  it('tolère les barres obliques en trop', () => {
    expect(routeFromPath('//recherche/')).toEqual({ view: 'list' });
  });

  it('ramène à l’accueil ce qu’il ne connaît pas', () => {
    // Un lien devenu faux doit donner un point de départ, pas une page blanche.
    expect(routeFromPath('/nimporte-quoi')).toEqual({ view: 'home' });
    expect(routeFromPath('/parametres/inconnu')).toEqual({ view: 'home' });
  });

  it('exige un identifiant là où il en faut un', () => {
    expect(routeFromPath('/annonce')).toEqual({ view: 'home' });
    expect(routeFromPath('/agence')).toEqual({ view: 'home' });
  });

  it('ne casse pas sur une séquence d’échappement invalide', () => {
    expect(routeFromPath('/annonce/%E0%A4%A')).toEqual({ view: 'detail', id: '%E0%A4%A' });
  });
});

describe('pathFromRoute', () => {
  for (const { path, route } of ROUTES) {
    it(`écrit ${path}`, () => {
      expect(pathFromRoute(route)).toBe(path);
    });
  }

  it('fait l’aller-retour sans perte', () => {
    for (const { route } of ROUTES) {
      expect(routeFromPath(pathFromRoute(route))).toEqual(route);
    }
  });
});

describe('sameRoute', () => {
  it('ignore la différence entre absent et valeur par défaut', () => {
    expect(sameRoute({ view: 'list' }, { view: 'list', favoritesOnly: false })).toBe(true);
    expect(sameRoute({ view: 'list' }, { view: 'list', favoritesOnly: true })).toBe(false);
    expect(sameRoute({ view: 'detail', id: 'a' }, { view: 'detail', id: 'b' })).toBe(false);
  });
});
