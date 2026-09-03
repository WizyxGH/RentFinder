/**
 * Résolution des points de référence privés (§20).
 *
 * Deux façons de les déclarer dans `.env`, et l'utilisateur peut mélanger :
 *   - `REFERENCE_*_LAT` / `_LON` : des coordonnées, prises telles quelles ;
 *   - `REFERENCE_*_ADDRESS`      : une adresse, géocodée une fois puis mise en
 *     cache — on saisit « 12 rue X, Nice » sans aller chercher son GPS.
 *
 * POURQUOI UN MODULE À PART. Cette résolution vivait dans la commande de
 * collecte. Une seconde commande (`reprocess`) s'est contentée des seules
 * coordonnées explicites — et comme l'utilisateur ne déclare qu'une ADRESSE,
 * elle a rescoré tout l'inventaire avec ZÉRO point de référence : les distances
 * et les coordonnées géocodées ont été effacées des fiches. Un calcul dont
 * l'oubli EFFACE des données n'a pas sa place dans un appelant.
 */

import type { Logger } from './logger.js';
import type { ReferencePoint } from '../config.js';
import { collectorUserAgent, loadReferenceAddresses, loadReferencePoints } from '../config.js';
import { createGeocoder } from './geocode.js';
import type { GeocodeCacheStore } from './geocode.js';

export interface ReferencePointsDeps {
  readonly cache: GeocodeCacheStore;
  readonly nowMs: number;
  readonly logger: Logger;
}

/**
 * Tous les points de référence utilisables, coordonnées et adresses réunies.
 *
 * Une adresse illisible est signalée et ignorée : elle ne doit pas faire échouer
 * une collecte (§69). L'appelant décide si un résultat VIDE est acceptable —
 * il ne l'est pas quand on s'apprête à réécrire des fiches existantes.
 */
export async function resolveReferencePoints(deps: ReferencePointsDeps): Promise<ReferencePoint[]> {
  const points = [...loadReferencePoints()];
  const toGeocode = loadReferenceAddresses();
  if (toGeocode.length === 0) return points;

  const geocoder = createGeocoder({
    cache: deps.cache,
    nowMs: deps.nowMs,
    userAgent: collectorUserAgent(),
  });

  for (const point of toGeocode) {
    const coords = await geocoder.geocode(point.address);
    if (coords === null) {
      deps.logger.warn('reference.geocode_failed', { label: point.label });
      continue;
    }
    points.push({
      label: point.label,
      latitude: coords.latitude,
      longitude: coords.longitude,
      mode: point.mode,
    });
  }
  return points;
}

/**
 * `true` si des points de référence sont DÉCLARÉS, qu'ils aient été résolus ou
 * non. Sert à distinguer « l'utilisateur n'en veut pas » de « la résolution a
 * échoué » — le second cas doit interrompre un rescoring, sous peine d'effacer
 * les distances de tout l'inventaire.
 */
export function referencePointsDeclared(): boolean {
  return loadReferencePoints().length > 0 || loadReferenceAddresses().length > 0;
}
