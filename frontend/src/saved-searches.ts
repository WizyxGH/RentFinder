/**
 * Recherches enregistrées.
 *
 * POURQUOI. Les réglages d'une recherche vivaient à deux endroits sans
 * rapport : les critères de collecte dans un repli de « Filtres », et
 * l'affinage de la liste dans le reste de la même modale. On réglait sept
 * champs, on trouvait ce qu'on cherchait, et le lendemain il fallait tout
 * recommencer — rien ne gardait le jeu complet.
 *
 * Une recherche enregistrée est ce jeu complet, nommé : les critères ET
 * l'affinage. La rappeler remet l'écran exactement dans l'état où on l'avait
 * laissé.
 *
 * CE QU'ELLE N'EST PAS : un abonnement. La collecte ne lit que les critères
 * ACTIFS ; une recherche enregistrée est un signet, pas une alerte de plus. Le
 * dire clairement évite d'attendre des notifications qui ne viendront pas.
 *
 * Elle vit en base et non dans le navigateur, pour la même raison que les
 * critères : un téléphone et un ordinateur doivent voir les mêmes.
 */

import { MVP_CRITERIA, type PropertyType } from '@rentfinder/shared';
import type { FilterConfig, SortMode } from './types.js';
import { DEFAULT_QUICK_FILTERS, type QuickFilterValues } from './components/QuickFilters.js';

/** L'affinage d'affichage, sous une forme qui passe par JSON. */
export interface SavedView {
  readonly minPrice: number | null;
  readonly maxPrice: number | null;
  readonly minArea: number | null;
  readonly minRooms: number | null;
  readonly minOccupants: number | null;
  /** Types de bien retenus. Un tableau, `Set` ne survivant pas à JSON. */
  readonly types: readonly PropertyType[];
  readonly sources: readonly string[];
  readonly sort: SortMode;
  readonly search: string;
}

export interface SavedSearch {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  /** Ce qu'on RAMÈNE : budget, surface, ville, exclusions. */
  readonly criteria: FilterConfig;
  /** Ce qu'on REGARDE dans ce qui a été ramené. */
  readonly view: SavedView;
}

/** `QuickFilterValues` → forme enregistrable. */
export function toSavedView(
  quick: QuickFilterValues,
  extra: { sources: ReadonlySet<string>; sort: SortMode; search: string },
): SavedView {
  return {
    minPrice: quick.minPrice,
    maxPrice: quick.maxPrice,
    minArea: quick.minArea,
    minRooms: quick.minRooms,
    minOccupants: quick.minOccupants,
    types: [...quick.types],
    sources: [...extra.sources],
    sort: extra.sort,
    search: extra.search,
  };
}

/**
 * Forme enregistrée → `QuickFilterValues`.
 *
 * Tolérante : une recherche écrite par une version plus ancienne peut manquer
 * un champ. On retombe alors sur le réglage d'ouverture plutôt que de refuser
 * de la rappeler (§69).
 */
export function toQuickFilters(view: Partial<SavedView> | undefined): QuickFilterValues {
  if (view === undefined) return DEFAULT_QUICK_FILTERS;
  return {
    minPrice: view.minPrice ?? DEFAULT_QUICK_FILTERS.minPrice,
    maxPrice: view.maxPrice ?? DEFAULT_QUICK_FILTERS.maxPrice,
    minArea: view.minArea ?? DEFAULT_QUICK_FILTERS.minArea,
    minRooms: view.minRooms ?? null,
    minOccupants: view.minOccupants ?? null,
    types: new Set(view.types ?? []),
  };
}

/**
 * Une phrase qui dit ce que la recherche cherche.
 *
 * C'est ce qu'on lit dans la liste des recherches pour reconnaître la sienne :
 * elle doit tenir sur une ligne et ne citer que ce qui est RÉGLÉ. Un critère
 * laissé à sa valeur d'usine n'apprend rien et n'y figure pas.
 */
export function describeSearch(search: SavedSearch): string {
  const parts: string[] = [];
  const { criteria, view } = search;

  const cities = criteria.cities.filter((city) => city !== '');
  if (cities.length > 0) parts.push(cities.join(', '));

  const low = view.minPrice ?? criteria.minPrice ?? null;
  const high = view.maxPrice ?? criteria.maxPrice;
  if (low !== null && high !== undefined) parts.push(`${low}–${high} €`);
  else if (high !== undefined) parts.push(`≤ ${high} €`);

  const area = view.minArea ?? criteria.minArea;
  if (area > 0) parts.push(`≥ ${area} m²`);

  if (view.minRooms !== null) parts.push(`≥ ${view.minRooms} pièce${view.minRooms > 1 ? 's' : ''}`);
  if (view.minOccupants !== null) parts.push(`${view.minOccupants} pers.`);
  if (view.types.length > 0) parts.push(view.types.join(', '));

  if (criteria.maxCommuteMinutes !== undefined) {
    parts.push(`trajet ≤ ${criteria.maxCommuteMinutes} min`);
  }
  if (criteria.landlordFilter === 'private') parts.push('particuliers');
  if (criteria.landlordFilter === 'agency') parts.push('agences');
  if (criteria.furnishedFilter === 'furnished') parts.push('meublé');
  if (criteria.furnishedFilter === 'unfurnished') parts.push('non meublé');
  if (view.sources.length > 0) parts.push(`${view.sources.length} source(s)`);
  if (view.search !== '') parts.push(`« ${view.search} »`);

  return parts.length === 0 ? 'Tous les logements' : parts.join(' · ');
}

/**
 * Un nom par défaut, pour n'avoir rien à écrire quand on est pressé.
 *
 * Il reprend les deux faits qui distinguent le mieux une recherche d'une autre
 * — la ville et le budget —, parce qu'un « Recherche 3 » ne se reconnaît pas.
 */
export function suggestName(criteria: FilterConfig, quick: QuickFilterValues): string {
  const city = criteria.cities[0] ?? MVP_CRITERIA.cities[0] ?? 'Nice';
  const budget = quick.maxPrice ?? criteria.maxPrice;
  const capitalized = city.charAt(0).toUpperCase() + city.slice(1);
  return budget === undefined ? capitalized : `${capitalized} ≤ ${budget} €`;
}

/** Identifiant local, stable une fois écrit. `crypto` est présent partout. */
export function newSearchId(): string {
  return crypto.randomUUID();
}
