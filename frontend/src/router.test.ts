/**
 * La table des routes est ce qu'on relit pour savoir ce que le site expose.
 * On la vérifie donc dans les deux sens : un chemin qui se lit et un écran qui
 * se réécrit à l'identique — sans quoi le bouton « Précédent » ramènerait
 * ailleurs qu'à l'endroit d'où l'on vient.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_VIEWS,
  VIEWS_WITH_ID,
  pathFromRoute,
  routeFromPath,
  sameRoute,
  type Route,
  type View,
} from './router.js';
import { SETTINGS_LINKS } from './components/SettingsLinks.js';

const ROUTES: readonly { path: string; route: Route }[] = [
  { path: '/', route: { view: 'home' } },
  { path: '/search', route: { view: 'list' } },
  { path: '/favorites', route: { view: 'list', favoritesOnly: true } },
  { path: '/listing/seloger%3A123', route: { view: 'detail', id: 'seloger:123' } },
  { path: '/agencies', route: { view: 'agencies' } },
  { path: '/agency/century21', route: { view: 'agency', id: 'century21' } },
  { path: '/sources', route: { view: 'sources' } },
  { path: '/sources/fnaim', route: { view: 'source', id: 'fnaim' } },
  { path: '/stats', route: { view: 'stats' } },
  { path: '/alerts', route: { view: 'alerts' } },
  { path: '/settings', route: { view: 'profile' } },
  { path: '/settings/profile', route: { view: 'tenant' } },
  { path: '/settings/documents', route: { view: 'documents' } },
  { path: '/settings/addresses', route: { view: 'reference' } },
  { path: '/settings/searches', route: { view: 'saved' } },
  { path: '/settings/notifications', route: { view: 'notifications' } },
  { path: '/settings/theme', route: { view: 'theme' } },
];

describe('routeFromPath', () => {
  for (const { path, route } of ROUTES) {
    it(`lit ${path}`, () => {
      expect(routeFromPath(path)).toEqual(route);
    });
  }

  it("décode l'identifiant : une annonce porte un « : » dans le sien", () => {
    expect(routeFromPath('/listing/seloger%3A12%3A34')).toEqual({
      view: 'detail',
      id: 'seloger:12:34',
    });
  });

  it('tolère les barres obliques en trop', () => {
    expect(routeFromPath('//search/')).toEqual({ view: 'list' });
  });

  it('ramène à l’accueil ce qu’il ne connaît pas', () => {
    // Un lien devenu faux doit donner un point de départ, pas une page blanche.
    expect(routeFromPath('/nimporte-quoi')).toEqual({ view: 'home' });
    expect(routeFromPath('/settings/unknown')).toEqual({ view: 'home' });
  });

  it('exige un identifiant là où il en faut un', () => {
    expect(routeFromPath('/listing')).toEqual({ view: 'home' });
    expect(routeFromPath('/agency')).toEqual({ view: 'home' });
  });

  it('ne casse pas sur une séquence d’échappement invalide', () => {
    expect(routeFromPath('/listing/%E0%A4%A')).toEqual({ view: 'detail', id: '%E0%A4%A' });
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

describe('exhaustivité de la table des routes', () => {
  it('donne une adresse DISTINCTE à chaque écran', () => {
    // Un écran ajouté sans adresse devenait inatteignable par URL, et le
    // bouton qui y menait réécrivait la barre d'adresse avec « / » — donc
    // renvoyait à l'accueil au premier rafraîchissement.
    const paths = new Map<string, View>();
    for (const view of ALL_VIEWS) {
      const route: Route = VIEWS_WITH_ID.includes(view) ? { view, id: 'x' } : { view };
      const path = pathFromRoute(route);
      const already = paths.get(path);
      expect(already, `${view} et ${already ?? ''} partagent l’adresse ${path}`).toBeUndefined();
      paths.set(path, view);
    }
  });

  it('relit chaque écran depuis son adresse', () => {
    for (const view of ALL_VIEWS) {
      const route: Route = VIEWS_WITH_ID.includes(view) ? { view, id: 'x' } : { view };
      expect(routeFromPath(pathFromRoute(route)), `aller-retour de ${view}`).toEqual(route);
    }
  });
});

describe('les entrées des Paramètres mènent quelque part', () => {
  it('ne propose que des écrans qui existent', () => {
    // `onNavigate(key as View)` masquait l'erreur : une clé mal orthographiée
    // compilait, et le clic ne faisait rien du tout.
    for (const link of SETTINGS_LINKS) {
      expect(ALL_VIEWS, `« ${link.label} » vise ${link.key}`).toContain(link.key);
    }
  });
});
