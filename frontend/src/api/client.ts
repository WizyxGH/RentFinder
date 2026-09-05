/**
 * Client de l'API (§28).
 *
 * UN SEUL CHEMIN : le Worker, joint par `VITE_API_URL`, avec un cookie de
 * session. Plus le mode démonstration, réservé aux tests.
 *
 * IL Y AVAIT UN ACCÈS DIRECT À TURSO : le navigateur ouvrait la base lui-même,
 * avec une adresse et un jeton saisis à la première visite et gardés dans
 * `localStorage`. Il a été retiré, pour trois raisons qui se répondent.
 *
 * Ce jeton ouvrait TOUTE la base, en lecture et en écriture. Aucun mot de passe
 * ne pouvait donc être vérifié devant : les comptes n'existaient pas sur ce
 * chemin-là, et le laisser à côté d'un vrai écran de connexion revenait à
 * laisser une porte ouverte à côté d'une porte fermée.
 *
 * Il redemandait ces identifiants à chaque vidage de cache — une adresse
 * `libsql://` et un jeton de deux cents caractères qu'il fallait retrouver.
 *
 * Enfin il n'était jamais complet : ni pièces du dossier, ni abonnement aux
 * notifications, ni — jusqu'à récemment — recherches enregistrées. Deux chemins
 * pour le même écran, dont l'un savait faire moins, c'était deux fois les mêmes
 * cas à tenir.
 *
 * Ce retrait sort aussi `@libsql/client` du bundle : le navigateur n'a plus de
 * client de base de données à télécharger.
 */

import type {
  FilterConfig,
  ListingView,
  ListingsResponse,
  SortMode,
  SourceStateView,
  StatsData,
} from '../types.js';
import {
  MVP_CRITERIA,
  NOTIFICATION_PREFERENCES_SETTING,
  CHANGELOG_SETTING,
  ONBOARDING_SETTING,
  REFERENCE_POINTS_SETTING,
  parseNotificationPreferences,
  type NotificationPreferences,
  SAVED_SEARCHES_SETTING,
  parseReferencePoints,
  type StoredReferencePoint,
} from '@rentfinder/shared';
import type { SavedSearch } from '../saved-searches.js';
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

/**
 * Statut attribué à une panne de réseau.
 *
 * `fetch` ne rejette pas avec un code HTTP quand rien n'aboutit : il lève un
 * `TypeError` dont le message est « Failed to fetch ». Cette phrase se
 * retrouvait telle quelle à l'écran — en anglais, sans dire quoi faire, et
 * sans distinguer un métro sans réseau d'une API en panne.
 */
export const NETWORK_ERROR_STATUS = 0;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // `credentials: 'include'` est ce qui fait tenir l'ensemble : le cookie de
  // session est posé par le Worker, sur SON domaine, et le site vit sur un
  // autre. Sans cette mention, le navigateur ne le renverrait pas, et chaque
  // requête reviendrait « connexion requise » alors qu'on vient de se
  // connecter.
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    // Réseau coupé, API injoignable, requête bloquée : de l'extérieur, tout se
    // ressemble. On dit ce qu'on sait — la requête n'est pas partie — et ce
    // qu'on peut faire, plutôt que de recopier « Failed to fetch ».
    throw new ApiError(
      'Connexion impossible. Vérifiez votre réseau, puis réessayez.',
      NETWORK_ERROR_STATUS,
    );
  }

  if (!response.ok) {
    throw new ApiError(
      response.status === 401
        ? 'Votre session a expiré. Reconnectez-vous.'
        : response.status >= 500
          ? 'Le serveur ne répond pas correctement. Réessayez dans un instant.'
          : `La requête a échoué (${response.status}).`,
      response.status,
    );
  }

  // Une réponse vide (204) n'est pas du JSON : la parser lèverait une erreur
  // là où tout s'est bien passé.
  if (response.status === 204) return undefined as T;
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
  if (DEMO) return LOCAL_USER;
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
  return !DEMO && API_URL !== '';
}

/**
 * Aucune API n'est joignable, et ce n'est pas la démonstration.
 *
 * CE CAS N'AVAIT PLUS D'ÉCRAN. Il en avait un tant que le navigateur savait
 * ouvrir Turso lui-même : on lui demandait alors une adresse et un jeton. Ce
 * chemin retiré, plus rien ne le remplaçait — l'application se croyait
 * connectée, appelait `/api/listings` en chemin relatif, recevait la page
 * d'erreur du serveur de fichiers, et affichait une liste vide.
 *
 * Une liste vide est un mensonge : elle dit « aucune annonce ne correspond »
 * là où il faut lire « le site n'est branché sur rien » (§17).
 */
export function isUnconfigured(): boolean {
  return !DEMO && API_URL === '';
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
  return request<ListingView>(`/api/listings/${encodeURIComponent(id)}`);
}

export async function markViewed(id: string): Promise<void> {
  if (DEMO) return;
  await request(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify({ viewed: true }) });
}

/** Archive ou désarchive une annonce. */
export async function setArchived(id: string, archived: boolean): Promise<void> {
  if (DEMO) return;
  await request(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify({ archived }) });
}

/** Met ou retire une annonce des favoris. */
export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  if (DEMO) return;
  await request(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify({ favorite }) });
}

export async function updateTracking(id: string, tracking: string): Promise<void> {
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
  await request(`/api/listings/${encodeURIComponent(id)}/contact`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * L'historique des annonces signalées (§29).
 *
 * Une route à part, et non un filtrage de la liste : celle-ci écarte les
 * annonces hors critères, et une détection qui s'améliore effaçait alors des
 * alertes bel et bien parties. Un historique ne se réécrit pas.
 */
export async function fetchAlerts(): Promise<readonly ListingView[]> {
  if (DEMO) {
    const { MOCK_LISTINGS } = await demoData();
    return MOCK_LISTINGS.filter((listing) => listing.notifiedAt != null);
  }
  if (API_URL === '') return [];
  const response = await request<{ listings: readonly ListingView[] }>('/api/alerts');
  return response.listings;
}

/**
 * L'adresse à laquelle ce compte fait suivre ses alertes de portail (§6).
 *
 * `null` quand la fonctionnalité n'est pas configurée : l'écran n'affiche alors
 * rien du tout, plutôt qu'une adresse inventée vers laquelle l'utilisateur
 * poserait une règle de transfert pour rien (§17).
 *
 * Route à part et chargée à l'ouverture des réglages seulement : elle coûte une
 * lecture de ligne, et l'écran d'accueil n'en a pas besoin (§30).
 */
export async function fetchAlertAddress(): Promise<string | null> {
  if (DEMO) return 'alertes+demo@exemple.invalid';
  if (API_URL === '') return null;
  const response = await request<{ address: string | null }>('/api/alert-address');
  return response.address;
}

/**
 * Demande un lien de réinitialisation.
 *
 * `sent` QUOI QU'IL ARRIVE quand la fonctionnalité est configurée, même pour un
 * identifiant inconnu : le serveur ne dit pas si un compte existe, et l'écran
 * ne doit donc rien laisser deviner non plus. `unconfigured` est le seul cas où
 * l'on peut promettre qu'aucun message ne partira — le taire ferait attendre
 * pour rien (§17).
 */
export async function requestPasswordReset(
  login: string,
): Promise<'sent' | 'unconfigured' | 'error'> {
  if (DEMO || API_URL === '') return 'unconfigured';
  try {
    await request('/api/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ login }),
    });
    return 'sent';
  } catch (caught) {
    return caught instanceof ApiError && caught.status === 501 ? 'unconfigured' : 'error';
  }
}

/**
 * Pose le nouveau mot de passe. `invalid` couvre jeton inconnu, expiré ou déjà
 * servi — le serveur ne les distingue pas, et l'écran non plus.
 */
export async function resetPassword(
  token: string,
  password: string,
): Promise<'done' | 'invalid' | 'error'> {
  if (DEMO || API_URL === '') return 'error';
  try {
    await request('/api/password/reset', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
    return 'done';
  } catch (caught) {
    return caught instanceof ApiError && caught.status === 400 ? 'invalid' : 'error';
  }
}

export async function fetchSources(): Promise<{ sources: readonly SourceStateView[] }> {
  if (DEMO) {
    const { MOCK_SOURCES } = await demoData();
    return { sources: MOCK_SOURCES };
  }
  return request<{ sources: readonly SourceStateView[] }>('/api/sources');
}

/**
 * Une agence de l'annuaire.
 *
 * Le nom est la clé : les sources ne publient pas d'identifiant d'agence. Deux
 * orthographes donnent donc deux entrées, ce qui vaut mieux qu'un regroupement
 * inventé mélangeant deux enseignes (§17).
 */
export interface AgencySummary {
  readonly name: string;
  readonly listings: number;
  readonly phone: string | null;
  readonly email: string | null;
  readonly sources: readonly string[];
}

/** L'annuaire, agrégé en base : la liste ne transporte pas les coordonnées. */
export async function fetchAgencies(): Promise<readonly AgencySummary[]> {
  if (DEMO) {
    const { MOCK_LISTINGS } = await demoData();
    const byName = new Map<string, { count: number; sources: Set<string> }>();
    for (const listing of MOCK_LISTINGS) {
      const name = listing.contact?.agencyName;
      if (typeof name !== 'string' || name === '') continue;
      const entry = byName.get(name) ?? { count: 0, sources: new Set<string>() };
      entry.count += 1;
      for (const one of listing.occurrences) entry.sources.add(one.sourceId);
      byName.set(name, entry);
    }
    return [...byName.entries()]
      .map(([name, entry]) => ({
        name,
        listings: entry.count,
        phone: null,
        email: null,
        sources: [...entry.sources],
      }))
      .sort((a, b) => b.listings - a.listings);
  }
  const response = await request<{ agencies: readonly AgencySummary[] }>('/api/agencies');
  return response.agencies;
}

/** Une agence et ce qu'elle propose en ce moment. */
export async function fetchAgency(
  name: string,
): Promise<{ agency: AgencySummary; listings: readonly ListingView[] }> {
  if (DEMO) {
    const { MOCK_LISTINGS } = await demoData();
    const listings = MOCK_LISTINGS.filter((one) => one.contact?.agencyName === name);
    const sources = new Set(listings.flatMap((one) => one.occurrences.map((o) => o.sourceId)));
    return {
      agency: {
        name,
        listings: listings.length,
        phone: listings[0]?.contact?.phone ?? null,
        email: listings[0]?.contact?.email ?? null,
        sources: [...sources],
      },
      listings,
    };
  }
  return request<{ agency: AgencySummary; listings: readonly ListingView[] }>(
    `/api/agencies/${encodeURIComponent(name)}`,
  );
}

/** Statistiques, calculées localement en démo depuis les données fictives. */
export async function fetchStats(): Promise<StatsData> {
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
// Pièces du dossier de candidature (§25).
//
// Elles vivent dans l'espace de fichiers du Worker (R2), rangées par compte.
// Elles étaient sur le disque de la machine, ce qui les rendait inatteignables
// depuis le téléphone — or une candidature s'envoie d'où l'on est.
//
// RIEN N'EST ENVOYÉ AUTOMATIQUEMENT (§24) : on dépose, on consulte, on
// supprime. Sans API joignable, la section se tait plutôt que de promettre un
// dépôt qu'elle perdrait.
// ---------------------------------------------------------------------------

export interface DocumentInfo {
  readonly name: string;
  readonly size: number;
  readonly uploadedAt: string;
}

/** Vrai quand un espace de fichiers est joignable (donc : un Worker). */
export const canStoreDocuments = (): boolean => !DEMO && API_URL !== '';

export async function fetchDocuments(): Promise<readonly DocumentInfo[]> {
  if (!canStoreDocuments()) return [];
  const response = await request<{ documents: readonly DocumentInfo[] }>('/api/documents');
  return response.documents;
}

/**
 * Dépose une pièce. Elle part vers R2, à côté de l'API — et devient donc
 * atteignable depuis le téléphone, ce qui est tout l'intérêt : une
 * candidature s'envoie d'où l'on est.
 */
export async function uploadDocument(file: File): Promise<DocumentInfo> {
  if (!canStoreDocuments()) throw new Error("Aucun espace de fichiers n'est configuré.");
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${API_URL}/api/documents`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? 'Le dépôt a échoué.');
  }
  return (await response.json()) as DocumentInfo;
}

export async function deleteDocument(name: string): Promise<void> {
  if (!canStoreDocuments()) return;
  await request(`/api/documents/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

/** URL de consultation d'une pièce (ouvre dans le navigateur). */
export function documentUrl(name: string): string {
  return `${API_URL}/api/documents/${encodeURIComponent(name)}`;
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
  return request<FilterConfig>('/api/config');
}

/** Enregistre les filtres (§66). En démo, no-op qui renvoie l'entrée. */
export async function saveFilters(filters: FilterConfig): Promise<FilterConfig> {
  if (DEMO) return filters;
  return request<FilterConfig>('/api/config', { method: 'PUT', body: JSON.stringify(filters) });
}

/**
 * Abonnement Web Push (§29).
 *
 * Il ne s'enregistrait QUE par l'accès direct à Turso. Sur l'installation
 * recommandée, le navigateur acceptait l'abonnement, la page affichait
 * « activé », et aucune alerte n'arrivait jamais : rien ne l'avait conservé.
 */
export async function subscribePush(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<void> {
  if (DEMO) return;
  if (API_URL === '') throw new ApiError("Aucune API n'est configurée.", 400);
  await request('/api/push', { method: 'POST', body: JSON.stringify(sub) });
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  if (DEMO || API_URL === '') return;
  await request('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
}

/**
 * Réglages de compte (§66) : recherches enregistrées, points de référence.
 *
 * Ils vivent dans `app_settings`, comme les critères — le site déployé n'a
 * aucun accès à la machine de collecte, la base est leur seul point de
 * rencontre.
 *
 * ILS NE PASSAIENT QUE PAR L'ACCÈS DIRECT À TURSO, aujourd'hui retiré. Sur
 * l'installation recommandée, une recherche enregistrée disparaissait donc au
 * rechargement, sans que rien ne le dise.
 */
async function readSetting<T>(key: string): Promise<T | null> {
  if (DEMO) return null;
  if (API_URL === '') return null;
  return request<T | null>(`/api/settings/${key}`);
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  if (DEMO) return;
  if (API_URL === '') return;
  await request(`/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

/** `true` si cet accès sait conserver un réglage de compte. */
export function settingsAvailable(): boolean {
  return !DEMO && API_URL !== '';
}

export async function fetchSavedSearches(): Promise<readonly SavedSearch[]> {
  return (await readSetting<readonly SavedSearch[]>(SAVED_SEARCHES_SETTING)) ?? [];
}

export async function saveSavedSearches(searches: readonly SavedSearch[]): Promise<void> {
  await writeSetting(SAVED_SEARCHES_SETTING, searches);
}

/** `true` si cet accès sait conserver une recherche enregistrée. */
export function savedSearchesAvailable(): boolean {
  return settingsAvailable();
}

/**
 * Points de référence : lieu de travail, gare (§20).
 *
 * Ils décident du temps de trajet affiché sur chaque annonce. Ils vivaient
 * dans `.env` et dans les secrets GitHub — changer d'employeur demandait
 * d'éditer un fichier sur la machine de collecte. Ils se règlent désormais
 * depuis l'écran Paramètres, et la collecte suivante les géocode.
 *
 * `null` = rien de réglé depuis le site, donc `.env` fait foi. Un tableau vide
 * est autre chose : c'est le choix de n'afficher aucune distance.
 */
export async function fetchReferencePoints(): Promise<readonly StoredReferencePoint[] | null> {
  const stored = await readSetting<unknown>(REFERENCE_POINTS_SETTING);
  return stored === null ? null : parseReferencePoints(stored);
}

export type { StoredReferencePoint };

export async function saveReferencePoints(points: readonly StoredReferencePoint[]): Promise<void> {
  await writeSetting(REFERENCE_POINTS_SETTING, points);
}

/**
 * Ce dont on veut être prévenu (§29).
 *
 * Ces préférences sont lues par la COLLECTE, qui décide seule d'envoyer ou non.
 * Filtrer côté navigateur n'aurait rien filtré : la notification part du
 * collecteur vers le service de push, sans passer par la page.
 */
export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  return parseNotificationPreferences(await readSetting<unknown>(NOTIFICATION_PREFERENCES_SETTING));
}

export async function saveNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<void> {
  await writeSetting(NOTIFICATION_PREFERENCES_SETTING, preferences);
}

/**
 * Le premier parcours a-t-il été fait ?
 *
 * En base et non dans le navigateur : un compte se crée sur l'ordinateur et
 * s'ouvre ensuite sur le téléphone, et resservir l'écran de bienvenue à
 * quelqu'un qui a déjà tout renseigné donnerait l'impression d'avoir tout
 * perdu.
 *
 * `true` par défaut quand aucun réglage n'est joignable (démonstration, API
 * absente) : mieux vaut ne pas montrer l'accueil que le montrer à chaque
 * chargement sans jamais pouvoir le refermer.
 */
export async function fetchOnboardingDone(): Promise<boolean> {
  if (!settingsAvailable()) return true;
  const stored = await readSetting<{ done?: unknown }>(ONBOARDING_SETTING);
  return stored?.done === true;
}

export async function markOnboardingDone(): Promise<void> {
  await writeSetting(ONBOARDING_SETTING, { done: true, at: new Date().toISOString() });
}

/**
 * Le repère de lecture des nouveautés.
 *
 * `null` = jamais rien lu. Ce n'est pas « tout est nouveau » : `unseenEntries`
 * s'en sert pour ne RIEN montrer à un nouveau venu, et le premier parcours pose
 * le repère en se terminant.
 */
export async function fetchChangelogSeen(): Promise<string | null> {
  if (!settingsAvailable()) return null;
  const stored = await readSetting<{ id?: unknown }>(CHANGELOG_SETTING);
  return typeof stored?.id === 'string' ? stored.id : null;
}

export async function markChangelogSeen(id: string): Promise<void> {
  await writeSetting(CHANGELOG_SETTING, { id, at: new Date().toISOString() });
}
