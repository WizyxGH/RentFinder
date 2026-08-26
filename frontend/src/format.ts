/**
 * Formatage pour l'affichage.
 *
 * Règle transverse : une donnée absente s'affiche « — » ou « inconnu », jamais
 * « 0 » ni une estimation (§17). L'utilisateur doit pouvoir distinguer d'un
 * coup d'œil « aucun favori » de « la source ne publie pas les favoris ».
 */

import type { PropertyType, TrackingStatus } from '@rentfinder/shared';
import { toTitleCase } from '@rentfinder/shared';

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
  // dédoublonnage ; on la recapitalise pour l'affichage. On délègue au
  // formateur PARTAGÉ pour que l'interface, les notifications et les messages
  // écrivent exactement la même chose (§20) — il gère aussi les tirets et les
  // particules (« saint-laurent-du-var » → « Saint-Laurent-du-Var »).
  return toTitleCase(city);
}

/** Particules françaises laissées en minuscules dans une adresse. */
const ADDRESS_PARTICLES = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'l',
  'd',
  'et',
  'au',
  'aux',
  'sur',
  'sous',
  'en',
  'à',
  'a',
  'bis',
  'ter',
]);

/** Abréviations de voies, dépliées pour un affichage homogène. */
const ADDRESS_ABBREVIATIONS: Record<string, string> = {
  bd: 'boulevard',
  bld: 'boulevard',
  blvd: 'boulevard',
  boul: 'boulevard',
  av: 'avenue',
  ave: 'avenue',
  imp: 'impasse',
  chem: 'chemin',
  ch: 'chemin',
  prom: 'promenade',
  bat: 'bât.',
  pl: 'place',
  rte: 'route',
  sq: 'square',
  all: 'allée',
  crs: 'cours',
  qu: 'quai',
  pass: 'passage',
  res: 'résidence',
  resid: 'résidence',
  mte: 'montée',
  cor: 'corniche',
  trav: 'traverse',
  vla: 'villa',
};

/** Chiffres romains (Napoléon III, Albert 1er…) gardés en capitales. */
const ROMAN_NUMERAL = /^[ivx]{1,4}$/i;

/** Capitalise un mot d'adresse en respectant traits d'union et apostrophes. */
function capitalizeAddressWord(word: string, isFirst: boolean): string {
  // Segments séparés par un trait d'union : chacun est capitalisé.
  if (word.includes('-')) {
    return word
      .split('-')
      .map((part, index) => capitalizeAddressWord(part, isFirst && index === 0))
      .join('-');
  }
  // « l'hermitage » → « l'Hermitage » : la particule élidée reste minuscule.
  const elision = /^([ld])['’](.+)$/i.exec(word);
  if (elision !== null) {
    return `${elision[1]!.toLowerCase()}’${capitalizeAddressWord(elision[2]!, false)}`;
  }
  if (word === '') return word;
  // « 77bis », « 26/30 », « 1er » : les jetons commençant par un chiffre
  // restent en minuscules après le chiffre.
  if (/^\d/.test(word)) return word.toLowerCase();
  if (ROMAN_NUMERAL.test(word)) return word.toUpperCase();
  const lower = word.toLowerCase();
  if (!isFirst && ADDRESS_PARTICLES.has(lower)) return lower;
  return lower[0]!.toUpperCase() + lower.slice(1);
}

/**
 * Adresse lisible, quelle que soit la forme publiée par la source :
 * « 260 BOULEVARD DE LA MADELEINE » → « 260 Boulevard de la Madeleine »,
 * « 26/30 BLD NAPOLEON III » → « 26/30 Boulevard Napoleon III », « 144 rue
 * France » → « 144 Rue France ». Les particules restent minuscules, les
 * chiffres romains en capitales, les abréviations de voies sont dépliées. Les
 * accents absents ne sont PAS restaurés — on n'invente pas de donnée (§17).
 */
export function formatAddress(address: string | null): string {
  if (address === null || address.trim() === '') return UNKNOWN;

  const words = address
    .replace(/\s+/g, ' ')
    // Homogénéisation : certaines sources collent « … 06000 Nice » à la rue,
    // d'autres non. On retire le CODE POSTAL et tout ce qui suit pour ne garder
    // que la VOIE (la ville est affichée à part). Signal fiable, contrairement
    // au nom « Nice »/« France » qui peut être une voie (« rue France »).
    .replace(/[\s,]+\d{5}\b.*$/, '')
    // « 37 - 39 » → « 37-39 » : plage de numéros recollée.
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
    .replace(/,\s*$/, '')
    .trim()
    .split(' ')
    .map((word) => {
      const stripped = word.toLowerCase().replace(/\.$/, '');
      return ADDRESS_ABBREVIATIONS[stripped] ?? word;
    });

  let seenAlpha = false;
  return words
    .map((word) => {
      const isFirst = !seenAlpha;
      if (/[a-zà-ÿ]/i.test(word)) seenAlpha = true;
      return capitalizeAddressWord(word, isFirst);
    })
    .join(' ');
}

/**
 * Disponibilité lisible : « Dispo maintenant » si la date est passée ou
 * imminente, sinon « Dispo 1 sept. 2027 ». `null` si inconnue (§17 : on
 * n'affiche rien plutôt qu'une invention).
 */
export function formatAvailability(iso: string | null, nowMs: number): string | null {
  if (iso === null) return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  if (timestamp <= nowMs + 3 * 86_400_000) return 'Dispo maintenant';
  const date = new Date(timestamp);
  const formatted = date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: date.getUTCFullYear() === new Date(nowMs).getUTCFullYear() ? undefined : 'numeric',
    timeZone: 'UTC',
  });
  return `Dispo ${formatted}`;
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
