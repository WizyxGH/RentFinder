/**
 * Adresses de l'application (§39).
 *
 * L'INTERFACE N'AVAIT AUCUNE URL. Tout vivait dans un `useState` : la barre
 * d'adresse affichait la même chose sur la liste, sur une fiche et dans les
 * paramètres. Conséquences quotidiennes — le bouton « Précédent » du navigateur
 * quittait le site au lieu de refermer la fiche ; on ne pouvait pas garder une
 * annonce en favori du navigateur, ni l'envoyer à quelqu'un ; un
 * rafraîchissement ramenait à l'accueil ; et sur Android, le geste de retour
 * fermait l'application entière.
 *
 * Les chemins sont en français et lisibles : `/annonce/seloger:123` se comprend
 * sans être développeur, et c'est ce qui se colle dans un message.
 *
 * CE MODULE EST PUR d'un bout à l'autre — deux fonctions qui traduisent un
 * chemin en état et l'inverse. L'accrochage à `history` vit dans le hook
 * `useRoute`, à côté, pour que la table des routes se teste sans navigateur.
 */

/** Les écrans de l'application. */
export type View =
  | 'home'
  | 'list'
  | 'detail'
  | 'stats'
  | 'profile'
  | 'tenant'
  | 'documents'
  | 'reference'
  | 'saved'
  | 'notifications'
  | 'theme'
  | 'sources'
  | 'source'
  | 'agencies'
  | 'agency'
  | 'alerts'
  | 'onboarding';

/**
 * TOUS les écrans, à l'exécution.
 *
 * `View` est un type : il disparaît à la compilation, et rien n'empêchait donc
 * d'ajouter un écran sans lui donner d'adresse — il devenait alors
 * inatteignable par URL, et le bouton qui y menait réécrivait la barre
 * d'adresse avec « / ». La table ci-dessous existe pour être PARCOURUE par un
 * test.
 *
 * L'objet intermédiaire n'est pas un ornement : `Record<View, true>` force
 * TypeScript à refuser la compilation si un écran manque ici. Un simple
 * tableau `View[]` aurait accepté l'oubli.
 */
const VIEW_PRESENCE: Record<View, true> = {
  home: true,
  list: true,
  detail: true,
  stats: true,
  profile: true,
  tenant: true,
  documents: true,
  reference: true,
  saved: true,
  notifications: true,
  theme: true,
  sources: true,
  source: true,
  agencies: true,
  agency: true,
  alerts: true,
  onboarding: true,
};

export const ALL_VIEWS: readonly View[] = Object.keys(VIEW_PRESENCE) as View[];

/** Les écrans qui regardent quelque chose : leur adresse porte un identifiant. */
export const VIEWS_WITH_ID: readonly View[] = ['detail', 'source', 'agency'];

/** Où l'on se trouve : un écran, et ce qu'il regarde. */
export interface Route {
  readonly view: View;
  /** Identifiant de l'annonce, de la source ou de l'agence regardée. */
  readonly id?: string;
  /** La liste filtrée sur les favoris a sa propre adresse. */
  readonly favoritesOnly?: boolean;
}

export const HOME_ROUTE: Route = { view: 'home' };

/**
 * Écrans sans paramètre : un chemin, un écran.
 *
 * Une table plutôt qu'une cascade de `if` — c'est elle qu'on relit pour savoir
 * ce que le site expose, et elle sert dans les deux sens.
 */
const SIMPLE_ROUTES: Readonly<Record<string, View>> = {
  '': 'home',
  recherche: 'list',
  statistiques: 'stats',
  alertes: 'alerts',
  sources: 'sources',
  agences: 'agencies',
  bienvenue: 'onboarding',
};

/** Sous-écrans des paramètres : `/parametres/<clé>`. */
const SETTINGS_ROUTES: Readonly<Record<string, View>> = {
  profil: 'tenant',
  dossier: 'documents',
  adresses: 'reference',
  recherches: 'saved',
  notifications: 'notifications',
  theme: 'theme',
};

const SETTINGS_PATHS: Readonly<Partial<Record<View, string>>> = Object.fromEntries(
  Object.entries(SETTINGS_ROUTES).map(([path, view]) => [view, path]),
);

const SIMPLE_PATHS: Readonly<Partial<Record<View, string>>> = Object.fromEntries(
  Object.entries(SIMPLE_ROUTES).map(([path, view]) => [view, path]),
);

/**
 * Découpe un chemin en segments décodés.
 *
 * Le décodage compte : un identifiant d'annonce contient un « : »
 * (`source:référence`), que le navigateur peut réécrire `%3A`.
 */
function segmentsOf(pathname: string): string[] {
  return pathname
    .split('/')
    .filter((part) => part !== '')
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        // Séquence d'échappement invalide dans l'URL : on garde le brut plutôt
        // que de faire tomber le rendu (§69).
        return part;
      }
    });
}

/**
 * Chemin → écran. Une adresse inconnue ramène à l'accueil : mieux vaut un point
 * de départ qu'une page blanche pour un lien devenu faux.
 */
export function routeFromPath(pathname: string): Route {
  const parts = segmentsOf(pathname);
  const [first, second] = parts;

  if (first === undefined) return HOME_ROUTE;

  if (first === 'favoris') return { view: 'list', favoritesOnly: true };

  if (first === 'annonce' && second !== undefined) return { view: 'detail', id: second };
  if (first === 'agence' && second !== undefined) return { view: 'agency', id: second };
  if (first === 'sources' && second !== undefined) return { view: 'source', id: second };

  if (first === 'parametres') {
    if (second === undefined) return { view: 'profile' };
    const view = SETTINGS_ROUTES[second];
    return view === undefined ? HOME_ROUTE : { view };
  }

  const simple = SIMPLE_ROUTES[first];
  return simple === undefined ? HOME_ROUTE : { view: simple };
}

/** Écran → chemin, toujours absolu et sans base : `pathOf` la rajoute. */
export function pathFromRoute(route: Route): string {
  const { view, id, favoritesOnly } = route;

  if (view === 'list') return favoritesOnly === true ? '/favoris' : '/recherche';
  if (view === 'detail') return `/annonce/${encodeURIComponent(id ?? '')}`;
  if (view === 'agency') return `/agence/${encodeURIComponent(id ?? '')}`;
  if (view === 'source') return `/sources/${encodeURIComponent(id ?? '')}`;
  if (view === 'profile') return '/parametres';

  const settings = SETTINGS_PATHS[view];
  if (settings !== undefined) return `/parametres/${settings}`;

  const simple = SIMPLE_PATHS[view];
  return simple === undefined || simple === '' ? '/' : `/${simple}`;
}

/**
 * Le préfixe sous lequel le site est publié.
 *
 * GitHub Pages sert depuis `/<dépôt>/` : sans en tenir compte, chaque
 * navigation écrirait une adresse à la racine du domaine et sortirait du site.
 * Vite le fournit à la compilation.
 */
export function basePath(): string {
  const base = import.meta.env.BASE_URL;
  return base === '/' ? '' : base.replace(/\/$/, '');
}

/** Chemin complet à écrire dans la barre d'adresse, préfixe compris. */
export function hrefOf(route: Route): string {
  return `${basePath()}${pathFromRoute(route)}`;
}

/** Ce que porte l'URL courante, préfixe retiré. */
export function currentRoute(pathname: string): Route {
  const base = basePath();
  const relative =
    base !== '' && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return routeFromPath(relative);
}

/** Deux adresses désignent-elles le même écran ? Évite les entrées inutiles. */
export function sameRoute(a: Route, b: Route): boolean {
  return (
    a.view === b.view &&
    (a.id ?? '') === (b.id ?? '') &&
    (a.favoritesOnly ?? false) === (b.favoritesOnly ?? false)
  );
}
