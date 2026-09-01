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
import { MOCK_LISTINGS, MOCK_SOURCES } from './mock-data.js';

const TOKEN_STORAGE_KEY = 'rentfinder.apiToken';

/** URL de l'API, injectée à la compilation. Vide = mode démo. */
export const API_URL: string = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

export const isDemoMode = (): boolean => API_URL === '';

/**
 * Mode LOCAL (`/`) : l'interface est servie par le serveur du mode zéro-cloud
 * (`pnpm local`), qui expose l'API sur la même origine, sans jeton — il
 * n'écoute que sur 127.0.0.1. Voir `packages/collector/src/cli/serve.ts`.
 */
export const isLocalMode = (): boolean => API_URL === '/';

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    // Navigation privée ou stockage désactivé : on dégrade sans casser.
    return null;
  }
}

export function writeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    /* stockage indisponible — le jeton vaudra pour la session courante */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* rien à faire */
  }
}

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
  // En mode local, l'API est sur la même origine et sans jeton.
  const local = isLocalMode();
  const token = local ? null : readToken();
  if (!local && token === null) throw new ApiError('Jeton d’accès absent', 401);

  const response = await fetch(`${local ? '' : API_URL}${path}`, {
    ...init,
    headers: {
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
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

/** Applique en local le tri et le filtrage que l'API ferait en SQL. */
function sortMock(listings: readonly ListingView[], sort: SortMode): ListingView[] {
  const copy = [...listings];
  if (sort === 'recent') {
    return copy.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
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

  if (isDemoMode()) {
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
export async function markViewed(id: string): Promise<void> {
  if (isDemoMode()) return;
  await request(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify({ viewed: true }) });
}

/** Archive ou désarchive une annonce. */
export async function setArchived(id: string, archived: boolean): Promise<void> {
  if (isDemoMode()) return;
  await request(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify({ archived }) });
}

/** Met ou retire une annonce des favoris. */
export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  if (isDemoMode()) return;
  await request(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify({ favorite }) });
}

export async function fetchListing(id: string): Promise<ListingView> {
  if (isDemoMode()) {
    const listing = MOCK_LISTINGS.find((candidate) => candidate.id === id);
    if (listing === undefined) throw new ApiError('Annonce introuvable', 404);
    return listing;
  }
  return request<ListingView>(`/api/listings/${encodeURIComponent(id)}`);
}

export async function updateTracking(id: string, tracking: string): Promise<void> {
  if (isDemoMode()) return;
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
  if (isDemoMode()) return;
  await request(`/api/listings/${encodeURIComponent(id)}/contact`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchSources(): Promise<{ sources: readonly SourceStateView[] }> {
  if (isDemoMode()) return { sources: MOCK_SOURCES };
  return request<{ sources: readonly SourceStateView[] }>('/api/sources');
}

/** Statistiques, calculées localement en démo depuis les données fictives. */
export async function fetchStats(): Promise<StatsData> {
  if (isDemoMode()) {
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
  if (isDemoMode()) return [];
  const response = await request<{ documents: readonly DocumentInfo[] }>('/api/documents');
  return response.documents;
}

export async function uploadDocument(file: File): Promise<DocumentInfo> {
  if (isDemoMode()) throw new ApiError('Indisponible en mode démonstration', 400);
  return request<DocumentInfo>(`/api/documents?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    body: file,
    headers: { 'content-type': 'application/octet-stream' },
  });
}

export async function deleteDocument(name: string): Promise<void> {
  if (isDemoMode()) return;
  await request(`/api/documents/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

/** URL locale de consultation d'une pièce (ouvre dans le navigateur). */
export function documentUrl(name: string): string {
  return `${isLocalMode() ? '' : API_URL}/api/documents/${encodeURIComponent(name)}`;
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
  if (isDemoMode()) return demoFilters();
  return request<FilterConfig>('/api/config');
}

/** Enregistre les filtres (§66). En démo, no-op qui renvoie l'entrée. */
export async function saveFilters(filters: FilterConfig): Promise<FilterConfig> {
  if (isDemoMode()) return filters;
  return request<FilterConfig>('/api/config', { method: 'PUT', body: JSON.stringify(filters) });
}
