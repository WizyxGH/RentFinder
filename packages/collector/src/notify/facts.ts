/**
 * Faits d'une annonce mis en forme pour une NOTIFICATION (§29).
 *
 * Une alerte doit porter de quoi DÉCIDER sans ouvrir le site : le loyer, la
 * surface, l'adresse la plus précise connue, la disponibilité, le téléphone,
 * l'origine et la priorité.
 *
 * Ces fonctions vivent à part du canal qui les emploie, sans mise en forme
 * propre à l'un d'eux — pas de HTML, pas d'emoji : le canal habille ce qu'il
 * reçoit. C'est ce qui a permis d'en retirer un sans rien réécrire.
 *
 * Toutes sont PURES et testables sans réseau (§59).
 */

import { formatLocation, portalLabel } from '@rentfinder/shared';
import type { NotifiableListing } from '../db/repository.js';
import { sourceDisplayNames } from '../sources/index.js';

/**
 * Nom lisible d'une source à partir de son identifiant (« foncia » → « Foncia »).
 * La table est construite une seule fois, à la demande, pour ne pas payer
 * l'import du registre à chaque message.
 */
let sourceNamesCache: ReadonlyMap<string, string> | null = null;

function sourceName(sourceId: string | null): string | null {
  if (sourceId === null || sourceId === '') return null;
  sourceNamesCache ??= sourceDisplayNames();
  return sourceNamesCache.get(sourceId) ?? null;
}

/** D'où sort l'annonce : le portail quand l'URL le dit, sinon la source. */
export function originLabel(listing: NotifiableListing): string | null {
  return portalLabel(listing.url) ?? sourceName(listing.sourceId);
}

/** Somme lisible « 640 € · 28 m² · 2 pièces », en omettant l'inconnu (§17). */
export function summarize(listing: NotifiableListing): string {
  const parts: string[] = [];
  if (listing.price !== null) parts.push(`${listing.price} €`);
  if (listing.area !== null) parts.push(`${listing.area} m²`);
  if (listing.rooms !== null) parts.push(`${listing.rooms} pièce${listing.rooms > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/**
 * Localisation la plus précise connue, au format postal français commun à toute
 * l'application : « 12 Rue de France, 06000 Nice ». Chaîne vide si rien n'est
 * publié (§17).
 */
export function locationLabel(listing: NotifiableListing): string {
  return formatLocation({
    street: listing.address,
    district: listing.district,
    postalCode: listing.postalCode,
    city: listing.city,
  });
}


/**
 * Disponibilité lisible : « Dispo maintenant » si l'emménagement est immédiat
 * (sous 3 jours), sinon « Dispo le {date} ». `null` si la source ne l'a pas
 * publiée ou si la date est illisible (§17).
 */
export function availabilityLabel(iso: string | null, nowMs: number): string | null {
  if (iso === null) return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  if (timestamp <= nowMs + 3 * 86_400_000) return 'Dispo maintenant';
  const formatted = new Date(timestamp).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year:
      new Date(timestamp).getUTCFullYear() === new Date(nowMs).getUTCFullYear()
        ? undefined
        : 'numeric',
    timeZone: 'UTC',
  });
  return `Dispo ${formatted}`;
}
