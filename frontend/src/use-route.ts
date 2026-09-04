/**
 * L'écran courant, tenu par la barre d'adresse.
 *
 * `useState` n'était pas la bonne mémoire : le bouton « Précédent » quittait le
 * site au lieu de refermer une fiche, et sur Android le geste de retour fermait
 * l'application. L'historique du navigateur est fait pour ça — encore
 * fallait-il l'utiliser.
 *
 * DEUX GESTES SEULEMENT, et la différence compte :
 *
 *   - `go` empile une entrée. Ouvrir une fiche, entrer dans les paramètres :
 *     autant d'endroits d'où l'on doit pouvoir revenir.
 *   - `replace` réécrit l'entrée courante. Passer de la liste aux favoris n'est
 *     pas un voyage : empiler chaque bascule obligerait à appuyer dix fois sur
 *     « Précédent » pour sortir.
 *
 * La seule dépendance est `history`, présent partout. Une bibliothèque de
 * routage aurait apporté son propre modèle d'état à côté de celui de l'écran,
 * pour une table de quinze chemins.
 */

import { useCallback, useEffect, useState } from 'react';
import { currentRoute, hrefOf, sameRoute, type Route } from './router.js';

/** Lit l'adresse courante, ou l'accueil hors navigateur (rendu de test). */
function readRoute(): Route {
  if (typeof window === 'undefined') return { view: 'home' };
  return currentRoute(window.location.pathname);
}

/**
 * Une destination, ou de quoi la calculer.
 *
 * La forme fonction n'est pas un ornement : deux navigations déclenchées dans
 * le même gestionnaire liraient toutes deux l'adresse du rendu précédent.
 * « Ouvrir cette annonce » puis « aller sur la fiche » se traduirait alors par
 * une fiche sans identifiant.
 */
export type RouteTarget = Route | ((current: Route) => Route);

export interface RouteControls {
  readonly route: Route;
  /** Empile une entrée : on pourra revenir ici. */
  readonly go: (target: RouteTarget) => void;
  /** Réécrit l'entrée courante : la précédente reste la sortie. */
  readonly replace: (target: RouteTarget) => void;
  /** Revient en arrière, comme le bouton du navigateur. */
  readonly back: () => void;
}

export function useRoute(): RouteControls {
  const [route, setRoute] = useState<Route>(readRoute);

  // Le bouton « Précédent », le geste Android, un lien collé : dans les trois
  // cas c'est le navigateur qui décide, et l'écran suit.
  useEffect(() => {
    const onPop = (): void => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const move = useCallback((target: RouteTarget, push: boolean): void => {
    setRoute((current) => {
      const next = typeof target === 'function' ? target(current) : target;
      // Rejouer la même adresse empilerait des entrées identiques, qu'il
      // faudrait ensuite dépiler une à une.
      if (sameRoute(current, next)) return current;
      const href = hrefOf(next);
      if (push) window.history.pushState(null, '', href);
      else window.history.replaceState(null, '', href);
      return next;
    });
  }, []);

  const go = useCallback((target: RouteTarget): void => move(target, true), [move]);
  const replace = useCallback((target: RouteTarget): void => move(target, false), [move]);
  const back = useCallback((): void => window.history.back(), []);

  return { route, go, replace, back };
}
