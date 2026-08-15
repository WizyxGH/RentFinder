/**
 * Formatage pour l'affichage.
 *
 * Règle transverse : une donnée absente s'affiche « — » ou « inconnu », jamais
 * « 0 » ni une estimation (§17). L'utilisateur doit pouvoir distinguer d'un
 * coup d'œil « aucun favori » de « la source ne publie pas les favoris ».
 */

import type { PropertyType, TrackingStatus } from '@rentfinder/shared';

/** Marque visuelle d'une valeur non fournie par la source. */
export const UNKNOWN = '—';

export function formatPrice(price: number | null): string {
  return price === null ? UNKNOWN : `${Math.round(price)} €`;
}

export function formatArea(area: number | null): string {
  return area === null ? UNKNOWN : `${Number.isInteger(area) ? area : area.toFixed(1)} m²`;
}

export function formatRooms(rooms: number | null): string {
  if (rooms === null) return UNKNOWN;
  return rooms === 1 ? '1 pièce' : `${rooms} pièces`;
}

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartment: 'Appartement',
  house: 'Maison',
  studio: 'Studio',
  room: 'Chambre',
  loft: 'Loft',
  parking: 'Stationnement',
  other: 'Autre',
  unknown: 'Type inconnu',
};

export const formatPropertyType = (type: PropertyType): string => PROPERTY_TYPE_LABELS[type];

export function formatCity(city: string | null): string {
  if (city === null) return UNKNOWN;
  // La ville est stockée en forme comparable (minuscules, sans accent) pour le
  // dédoublonnage ; on la recapitalise pour l'affichage.
  return city
    .split(' ')
    .map((word) => (word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(' ');
}

/**
 * Ancienneté lisible : « il y a 4 min », « il y a 2 h », « il y a 3 j ».
 * `nowMs` est un paramètre pour garder les tests déterministes (§59).
 */
export function formatAge(iso: string | null, nowMs: number): string {
  if (iso === null) return UNKNOWN;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return UNKNOWN;

  const minutes = Math.max(0, Math.round((nowMs - timestamp) / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;

  const days = Math.round(hours / 24);
  return days === 1 ? 'hier' : `il y a ${days} j`;
}

/** Durée de trajet : « 17 min ». */
export const formatDuration = (minutes: number): string => `${minutes} min`;

const TRACKING_LABELS: Record<TrackingStatus, string> = {
  new: 'Nouveau',
  toContact: 'À contacter',
  contacted: 'Contacté',
  replied: 'Réponse reçue',
  visitOffered: 'Visite proposée',
  visitScheduled: 'Visite programmée',
  visited: 'Visité',
  rejected: 'Refusé',
  rented: 'Loué',
  ignored: 'Ignoré',
};

export const formatTracking = (status: TrackingStatus): string => TRACKING_LABELS[status];

export const TRACKING_ORDER: readonly TrackingStatus[] = [
  'new',
  'toContact',
  'contacted',
  'replied',
  'visitOffered',
  'visitScheduled',
  'visited',
  'rejected',
  'rented',
  'ignored',
];

/** Nom lisible d'une source à partir de son identifiant. */
export function formatSourceName(sourceId: string): string {
  return sourceId
    .split(/[-_]/)
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ');
}
