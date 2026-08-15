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
}

export async function fetchListings(options: FetchListingsOptions = {}): Promise<ListingsResponse> {
  const sort = options.sort ?? 'priority';
  const includeAll = options.includeOutOfCriteria ?? false;

  if (isDemoMode()) {
    const filtered = includeAll
      ? MOCK_LISTINGS
      : MOCK_LISTINGS.filter((listing) => listing.matchesCriteria);
    const listings = sortMock(filtered, sort);
    return { listings, total: listings.length, limit: listings.length, offset: 0 };
  }

  const params = new URLSearchParams({ sort });
  if (includeAll) params.set('all', 'true');
  return request<ListingsResponse>(`/api/listings?${params.toString()}`);
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
  payload: { channel: string; message: string; sourceId: string },
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

/** Filtres par défaut, pour le mode démo (pas de fichier de config). */
function demoFilters(): FilterConfig {
  return {
    cities: [...MVP_CRITERIA.cities],
    maxPrice: MVP_CRITERIA.maxPrice,
    minArea: MVP_CRITERIA.minArea,
    ...(MVP_CRITERIA.minPrice !== undefined ? { minPrice: MVP_CRITERIA.minPrice } : {}),
    ...(MVP_CRITERIA.excludeFlatShare !== undefined
      ? { excludeFlatShare: MVP_CRITERIA.excludeFlatShare }
      : {}),
    ...(MVP_CRITERIA.excludeStudent !== undefined
      ? { excludeStudent: MVP_CRITERIA.excludeStudent }
      : {}),
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
