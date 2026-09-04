/**
 * Client de l'API (§28).
 *
 * Deux modes, choisis automatiquement :
 *
 *   - MODE DÉMO  : aucune URL d'API configurée. L'interface tourne sur les
 *     données fictives de `mock-data.ts`. C'est le mode par défaut d'un
 *     `pnpm dev` fraîchement cloné, et celui des tests (§54).
 *
 *   - MODE CONNECTÉ : `VITE_API_URL` est défini. Le jeton d'accès est demandé
 *     à l'utilisateur puis conservé dans `localStorage`. Il n'est JAMAIS
 *     présent dans le code ni dans le bundle publié sur GitHub Pages (§26).
 */

import type {
  FilterConfig,
  ListingView,
  ListingsResponse,
  SortMode,
  SourceStateView,
  StatsData,
} from '../types.js';
import { MVP_CRITERIA } from '@rentfinder/shared';
import type { SavedSearch } from '../saved-searches.js';
import * as turso from './turso.js';
import { byRecency } from '../recency.js';

/**
 * Charge les données fictives À LA DEMANDE.
 *
 * En import statique, elles restaient dans le bundle publié même sans être
 * affichées : plusieurs dizaines de ko d'annonces inventées livrées à chaque
 * visiteur. En import dynamique, elles forment un fragment séparé que seuls les
 * tests chargent.
 */
const demoData = async () => import('./mock-data.js');

/** URL de l'API, injectée à la compilation. Vide = mode démo. */
export const API_URL: string = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

/**
 * Données fictives : uniquement sur demande EXPLICITE (`VITE_DEMO=true`).
 *
 * Auparavant, toute absence d'API y basculait — si bien que le site publié
 * montrait des annonces inventées, et le développement local aussi. Des
 * annonces qui n'existent pas n'apprennent rien et laissent croire que l'outil
 * ne trouve que ça. Seuls les tests l'activent désormais.
 */
declare const __DEMO__: boolean | undefined;

/**
 * Constante, et non appel de fonction : Vite remplace `__DEMO__` par `false`
 * dans un build applicatif, Rollup replie l'expression, et TOUTES les branches
 * de démonstration — dont l'import du fichier de données fictives — deviennent
 * du code mort supprimé. Avec un appel de fonction, il ne pouvait pas le
 * prouver et embarquait les annonces inventées.
 */
const DEMO: boolean =
  typeof __DEMO__ !== 'undefined' ? __DEMO__ : import.meta.env['VITE_DEMO'] === 'true';

export const isDemoMode = (): boolean => DEMO;

/** Accès direct à Turso : le navigateur interroge la base, sans intermédiaire. */
export const isDirectMode = (): boolean =>
  API_URL === '' && !DEMO && turso.readCredentials() !== null;

/** Ni API, ni démonstration, ni identifiants Turso : rien à afficher. */
export const isUnconfigured = (): boolean => API_URL === '' && !DEMO && !isDirectMode();

/** Erreur d'API portant le statut HTTP, pour que l'interface réagisse finement. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // DEUX transports derrière la même fonction : le serveur local (`pnpm
  // local`, même origine, sans jeton, il n'écoute que sur 127.0.0.1) et le
  // Worker Cloudflare du site publié.
  //
  // `credentials: 'include'` est ce qui fait tenir le second : le cookie de
  // session est posé par le Worker, sur SON domaine, et le site vit sur un
  // autre. Sans cette mention, le navigateur ne le renverrait pas, et chaque
  // requête reviendrait « connexion requise » alors qu'on vient de se
  // connecter.
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(
      response.status === 401 ? 'Jeton invalide ou expiré' : `Erreur API (${response.status})`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

/**
 * Qui est connecté, si quelqu'un l'est.
 *
 * `null` n'est PAS une erreur : c'est la réponse normale avant de se
 * connecter, et c'est elle qui décide d'afficher l'écran de connexion. Les
 * modes local et démonstration n'ont pas de comptes — ils répondent donc
 * « connecté », faute de quoi ils demanderaient un mot de passe qui n'existe
 * nulle part.
 */
export async function fetchCurrentUser(): Promise<string | null> {
  if (DEMO || isDirectMode()) return LOCAL_USER;
  const response = await request<{ user: string | null }>('/api/me');
  return response.user;
}

/**
 * Utilisateur implicite des modes sans comptes. Le nom dit ce qu'il est : pas
 * une identité vérifiée, seulement « la personne devant cette machine ».
 */
const LOCAL_USER = 'moi';

/** `true` si cet accès demande une connexion. */
export function requiresLogin(): boolean {
  return !DEMO && !isDirectMode() && API_URL !== '';
}

/**
 * Connexion. Renvoie un message d'erreur, ou `null` si elle a réussi.
 *
 * Le message vient du serveur tel quel : il dit « identifiant ou mot de passe
 * incorrect » sans préciser lequel, et ce n'est pas une maladresse — distinguer
 * les deux apprendrait quels comptes existent.
 */
export async function login(identifiant: string, password: string): Promise<string | null> {
  try {
    await request<{ userId: string }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ login: identifiant, password }),
    });
    return null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return 'Identifiant ou mot de passe incorrect.';
    }
    return 'La connexion a échoué. Réessayez dans un instant.';
  }
}

export async function logout(): Promise<void> {
  if (!requiresLogin()) return;
  await fetch(`${API_URL}/api/logout`, { method: 'POST', credentials: 'include' }).catch(() => {
    /* déconnexion locale malgré tout : le cookie expirera */
  });
}

/** Applique en local le tri et le filtrage que l'API ferait en SQL. */
function sortMock(listings: readonly ListingView[], sort: SortMode): ListingView[] {
  const copy = [...listings];
  if (sort === 'recent') {
    return copy.sort(byRecency);
  }
  if (sort === 'price') {
    return copy.sort((a, b) => (a.price.value ?? Infinity) - (b.price.value ?? Infinity));
  }
  // §36 : par défaut, on classe par priorité d'action, pas par prix.
  return copy.sort((a, b) => b.actionPriority - a.actionPriority);
}

export interface FetchListingsOptions {
  readonly sort?: SortMode;
  readonly includeOutOfCriteria?: boolean;
  readonly includeArchived?: boolean;
  readonly favoritesOnly?: boolean;
}

export async function fetchListings(options: FetchListingsOptions = {}): Promise<ListingsResponse> {
  const sort = options.sort ?? 'priority';
  const includeAll = options.includeOutOfCriteria ?? false;
  const includeArchived = options.includeArchived ?? false;
  const favoritesOnly = options.favoritesOnly ?? false;

  if (isDirectMode()) {
    const listings = await turso.listListings({
      sort,
      includeOutOfCriteria: includeAll,
      includeArchived,
      favoritesOnly,
    });
    return { listings, total: listings.length, limit: listings.length, offset: 0 };
  }

  if (DEMO) {
    const { MOCK_LISTINGS } = await demoData();
    let filtered = includeAll
      ? MOCK_LISTINGS
      : MOCK_LISTINGS.filter((listing) => listing.matchesCriteria);
    if (!includeArchived) filtered = filtered.filter((listing) => listing.archived !== true);
    if (favoritesOnly) filtered = filtered.filter((listing) => listing.favorite === true);
    const listings = sortMock(filtered, sort);
    return { listings, total: listings.length, limit: listings.length, offset: 0 };
  }

  // On charge tout l'inventaire pertinent d'un coup : la liste défile, sans
  // pagination. 500 couvre largement le stock niçois (le plafond de l'API).
  const params = new URLSearchParams({ sort, limit: '500' });
  if (includeAll) params.set('all', 'true');
  if (includeArchived) params.set('archived', 'true');
  if (favoritesOnly) params.set('favorite', 'true');
  return request<ListingsResponse>(`/api/listings?${params.toString()}`);
}

/** Marque une annonce comme consultée (posé automatiquement à l'ouverture). */
/**
 * UNE fiche, entière.
 *
 * La liste n'en transporte qu'une version allégée — sans description, sans
 * coordonnées, sans le détail des scores — parce que ces champs pèsent les
 * quatre cinquièmes de la charge utile et que la liste n'en affiche aucun. La
 * fiche les demande à l'ouverture, pour une seule annonce (§30).
 */
export async function fetchListing(id: string): Promise<ListingView> {
  if (DEMO) {
    const { MOCK_LISTINGS } = await demoData();
    const found = MOCK_LISTINGS.find((listing) => listing.id === id);
    if (found === undefined) throw new Error('Annonce introuvable');
    return found;
  }
  if (isDirectMode()) return turso.getListing(id);
  return request<ListingView>(`/api/listings/${encodeURIComponent(id)}`);
}

export async function markViewed(id: string): Promise<void> {
  if (isDirectMode()) return turso.patchListing(id, { viewed: true });
  if (DEMO) return;
  await request(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify({ viewed: true }) });
}

/** Archive ou désarchive une annonce. */
export async function setArchived(id: string, archived: boolean): Promise<void> {
  if (isDirectMode()) return turso.patchListing(id, { archived });
  if (DEMO) return;
  await request(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify({ archived }) });
}

/** Met ou retire une annonce des favoris. */
export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  if (isDirectMode()) return turso.patchListing(id, { favorite });
  if (DEMO) return;
  await request(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify({ favorite }) });
}

export async function updateTracking(id: string, tracking: string): Promise<void> {
  if (isDirectMode()) return turso.patchListing(id, { tracking });
  if (DEMO) return;
  await request(`/api/listings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ tracking }),
  });
}

/**
 * Consigne une prise de contact que l'utilisateur vient d'effectuer lui-même.
 *
 * §22 : cette fonction n'envoie AUCUN message. Elle enregistre le fait que
 * l'utilisateur a agi, pour le suivi et les statistiques.
 */
export async function recordContact(
  id: string,
  payload: {
    channel: string;
    message: string;
    sourceId: string;
    /** Noms des pièces que l'utilisateur déclare avoir jointes (§25). */
    documents?: readonly string[];
  },
): Promise<void> {
  if (DEMO) return;
  if (isDirectMode()) {
    await turso.recordContact(id, {
      channel: payload.channel,
      message: payload.message,
      sourceId: payload.sourceId,
    });
    return;
  }
  await request(`/api/listings/${encodeURIComponent(id)}/contact`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchSources(): Promise<{ sources: readonly SourceStateView[] }> {
  if (isDirectMode()) return { sources: await turso.listSources() };
  if (DEMO) {
    const { MOCK_SOURCES } = await demoData();
    return { sources: MOCK_SOURCES };
  }
  return request<{ sources: readonly SourceStateView[] }>('/api/sources');
}

/** Statistiques, calculées localement en démo depuis les données fictives. */
export async function fetchStats(): Promise<StatsData> {
  if (isDirectMode()) return turso.getStats();
  if (DEMO) {
    const { MOCK_LISTINGS } = await demoData();
    // « Pertinentes » = dans les critères, non archivée, non louée et ENCORE
    // ACTIVE. Les annonces disparues de leur source sont comptées à part, sous
    // « à vérifier » : les additionner gonflait le chiffre (§33).
    const available = MOCK_LISTINGS.filter(
      (l) => l.matchesCriteria && l.archived !== true && l.rented !== true,
    );
    const matching = available.filter((l) => l.lifecycle === 'active');
    const uncertain = available.filter((l) => l.lifecycle === 'possiblyInactive');
    const byTracking: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const l of matching) byTracking[l.tracking] = (byTracking[l.tracking] ?? 0) + 1;
    for (const l of MOCK_LISTINGS) {
      for (const source of new Set(l.occurrences.map((o) => o.sourceId))) {
        bySource[source] = (bySource[source] ?? 0) + 1;
      }
    }
    // Historique fictif : trois points suffisent à montrer la courbe en démo.
    const today = new Date();
    const history = [4, 2, 0].map((back, i) => {
      const day = new Date(today.getTime() - back * 86_400_000).toISOString().slice(0, 10);
      return {
        day,
        matching: matching.length - (2 - i),
        uncertain: uncertain.length,
        rented: 0,
        total: MOCK_LISTINGS.length,
        activeSources: Object.keys(bySource).length,
      };
    });

    return {
      history,
      listings: {
        total: MOCK_LISTINGS.length,
        matching: matching.length,
        uncertain: uncertain.length,
        active: MOCK_LISTINGS.filter((l) => l.lifecycle === 'active').length,
        viewed: matching.filter((l) => l.viewed === true).length,
        archived: MOCK_LISTINGS.filter((l) => l.archived === true).length,
        rented: MOCK_LISTINGS.filter((l) => l.rented === true).length,
      },
      byTracking,
      bySource,
      contacts: { total: 0, byOutcome: {} },
    };
  }
  return request<StatsData>('/api/stats');
}

// ---------------------------------------------------------------------------
// Documents de candidature (§25) — mode local uniquement. Les pièces sont
// stockées dans data/ (hors dépôt) et ne quittent jamais 127.0.0.1 (§26).
// ---------------------------------------------------------------------------

export interface DocumentInfo {
  readonly name: string;
  readonly size: number;
  readonly uploadedAt: string;
}

export async function fetchDocuments(): Promise<readonly DocumentInfo[]> {
  // Les pièces de candidature ne quittent jamais la machine (§25) : en accès
  // direct, il n'y en a simplement pas.
  if (DEMO || isDirectMode()) return [];
  const response = await request<{ documents: readonly DocumentInfo[] }>('/api/documents');
  return response.documents;
}

/** Filtres par défaut, pour le mode démo (pas de fichier de config). */
function demoFilters(): FilterConfig {
  return {
    cities: [...MVP_CRITERIA.cities],
    maxPrice: MVP_CRITERIA.maxPrice,
    minArea: MVP_CRITERIA.minArea,
    ...(MVP_CRITERIA.maxCommuteMinutes !== undefined
      ? { maxCommuteMinutes: MVP_CRITERIA.maxCommuteMinutes }
      : {}),
    ...(MVP_CRITERIA.minPrice !== undefined ? { minPrice: MVP_CRITERIA.minPrice } : {}),
    ...(MVP_CRITERIA.excludeFlatShare !== undefined
      ? { excludeFlatShare: MVP_CRITERIA.excludeFlatShare }
      : {}),
    ...(MVP_CRITERIA.excludeStudent !== undefined
      ? { excludeStudent: MVP_CRITERIA.excludeStudent }
      : {}),
    landlordFilter: MVP_CRITERIA.landlordFilter ?? 'all',
    furnishedFilter: MVP_CRITERIA.furnishedFilter ?? 'all',
  };
}

export async function fetchFilters(): Promise<FilterConfig> {
  if (DEMO) return demoFilters();
  // En accès direct, les critères vivent dans la BASE : le site n'a aucun accès
  // à la machine de collecte, la base est leur seul point de rencontre (§66).
  // Base encore vierge → les valeurs par défaut, qui sont aussi celles du
  // fichier tant que rien n'a été enregistré.
  if (isDirectMode()) return (await turso.readSearchCriteria()) ?? demoFilters();
  return request<FilterConfig>('/api/config');
}

/** Enregistre les filtres (§66). En démo, no-op qui renvoie l'entrée. */
export async function saveFilters(filters: FilterConfig): Promise<FilterConfig> {
  if (DEMO) return filters;
  if (isDirectMode()) {
    await turso.writeSearchCriteria(filters);
    return filters;
  }
  return request<FilterConfig>('/api/config', { method: 'PUT', body: JSON.stringify(filters) });
}

/** Abonnement Web Push : uniquement en accès direct, la base seule le stocke. */
export async function subscribePush(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<void> {
  if (DEMO) return;
  if (!isDirectMode()) throw new ApiError('Disponible sur le site connecté à votre base.', 400);
  await turso.saveSubscription(sub);
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  if (DEMO || !isDirectMode()) return;
  await turso.removeSubscription(endpoint);
}

/**
 * Recherches enregistrées (§66).
 *
 * Elles vivent dans `app_settings`, comme les critères : le site déployé n'a
 * aucun accès à la machine de collecte, la base est leur seul point de
 * rencontre. En démo et en mode API, on n'en propose pas — il n'y a pas de
 * base à écrire, et une liste qui s'oublie au rechargement vaudrait moins que
 * pas de liste du tout (§17).
 */
export async function fetchSavedSearches(): Promise<readonly SavedSearch[]> {
  if (DEMO || !isDirectMode()) return [];
  return turso.readSavedSearches();
}

export async function saveSavedSearches(searches: readonly SavedSearch[]): Promise<void> {
  if (DEMO || !isDirectMode()) return;
  await turso.writeSavedSearches(searches);
}

/** `true` si cet accès sait conserver une recherche enregistrée. */
export function savedSearchesAvailable(): boolean {
  return !DEMO && isDirectMode();
}
