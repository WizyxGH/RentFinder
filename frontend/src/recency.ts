/**
 * Fraîcheur d'une annonce, pour le tri « Plus récentes ».
 *
 * Le tri s'appuyait sur `lastSeenAt` — la date du dernier passage de collecte
 * qui a REVU l'annonce. C'est une date de collecte, pas une date d'annonce :
 * 779 fiches ne portaient que 16 valeurs distinctes, une par passage, dont une
 * partagée par 192 d'entre elles. Le tri rendait donc seize paquets informes,
 * et paraissait ne rien faire.
 *
 * On classe désormais sur la date que la CARTE AFFICHE : la publication quand
 * la source la donne, sinon la découverte. Le classement correspond ainsi à ce
 * qui se lit à l'écran (§36) — sans quoi une annonce « publiée hier » pouvait
 * se retrouver sous une « publiée la semaine dernière ».
 */

import type { ListingView } from './types.js';

/** Date de référence en millisecondes ; `0` si aucune n'est connue (§17). */
export function recencyMs(listing: ListingView): number {
  const published = listing.publishedAt?.value ?? null;
  const parsed = Date.parse(published ?? listing.firstSeenAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Comparateur du plus récent au plus ancien.
 *
 * Beaucoup d'annonces partagent leur date à la seconde près : la priorité
 * d'action départage, plutôt que de laisser l'ordre au hasard du tableau.
 */
export function byRecency(a: ListingView, b: ListingView): number {
  const delta = recencyMs(b) - recencyMs(a);
  return delta !== 0 ? delta : b.actionPriority - a.actionPriority;
}
