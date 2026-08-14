/**
 * Assemblage des scores et des distances (§16 à §20).
 *
 * Point d'entrée unique du moteur de scoring : il transforme un
 * `AggregatedListing` en `ScoredListing` prêt pour l'interface.
 */

import type {
  AggregatedListing,
  ReferenceDistance,
  ScoredListing,
  SearchCriteria,
} from '@rentfinder/shared';
import type { ReferencePoint } from '../config.js';
import { estimateDurationMinutes, haversineKm } from '../core/geo.js';
import { scoreMatch } from './match.js';
import { scoreOpportunity } from './opportunity.js';
import { scoreRisk } from './risk.js';
import { scoreVisitProbability } from './visit-probability.js';

export { scoreMatch } from './match.js';
export { scoreOpportunity } from './opportunity.js';
export { scoreRisk, DEFAULT_REFERENCE_PRICE_PER_SQM } from './risk.js';
export { scoreVisitProbability } from './visit-probability.js';

export interface ScoringOptions {
  readonly criteria: SearchCriteria;
  readonly nowMs: number;
  readonly referencePricePerSqm: number;
  /** Points de référence privés. Vide = aucune distance affichée (§20). */
  readonly referencePoints: readonly ReferencePoint[];
  readonly observedStats?: {
    readonly visitRateBySource?: Readonly<Record<string, number>>;
  };
}

/**
 * Calcule les distances vers les points de référence configurés (§20).
 *
 * Sans coordonnées GPS sur l'annonce, aucune distance n'est produite : une
 * distance approximative fondée sur le seul nom de ville induirait en erreur.
 */
export function computeDistances(
  listing: AggregatedListing,
  points: readonly ReferencePoint[],
): ReferenceDistance[] {
  const latitude = listing.latitude.value;
  const longitude = listing.longitude.value;
  if (latitude === null || longitude === null) return [];

  return points.map((point) => {
    const distanceKm = haversineKm({ latitude, longitude }, point);
    return {
      label: point.label,
      distanceKm: Math.round(distanceKm * 100) / 100,
      durationMinutes: estimateDurationMinutes(distanceKm, point.mode),
      mode: point.mode,
    };
  });
}

/** Applique les quatre scores et les distances à un logement. */
export function scoreListing(listing: AggregatedListing, options: ScoringOptions): ScoredListing {
  const match = scoreMatch(listing, options.criteria);

  return {
    ...listing,
    scores: {
      match: match.score,
      opportunity: scoreOpportunity(listing, { nowMs: options.nowMs }),
      visitProbability: scoreVisitProbability(listing, {
        nowMs: options.nowMs,
        ...(options.observedStats !== undefined ? { observedStats: options.observedStats } : {}),
      }),
      risk: scoreRisk(listing, { referencePricePerSqm: options.referencePricePerSqm }),
    },
    distances: computeDistances(listing, options.referencePoints),
    matchesCriteria: match.matchesCriteria,
  };
}
