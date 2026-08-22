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
import { estimateDurationMinutes, haversineKm, type Coordinates } from '../core/geo.js';
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
  /** Ids d'occurrences dont le loyer a récemment baissé (§17). */
  readonly priceDroppedIds?: ReadonlySet<string>;
  /** Coordonnées issues du géocodage de l'adresse, si la source n'a pas de GPS (§20). */
  readonly resolvedCoordinates?: Coordinates | null;
  /**
   * Durées de trajet RÉELLES en transports en commun, par libellé de point de
   * référence (Navitia, §20). Absent → estimation vol d'oiseau.
   */
  readonly resolvedTransitMinutes?: Readonly<Record<string, number>>;
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
  resolved?: Coordinates | null,
  transitMinutes?: Readonly<Record<string, number>>,
): ReferenceDistance[] {
  // Coordonnées de l'annonce si la source les fournit, sinon celles issues du
  // géocodage de l'adresse (§20). Sans ni l'une ni l'autre, aucune distance :
  // une approximation par le seul nom de ville induirait en erreur.
  const latitude = listing.latitude.value ?? resolved?.latitude ?? null;
  const longitude = listing.longitude.value ?? resolved?.longitude ?? null;
  if (latitude === null || longitude === null) return [];

  return points.map((point) => {
    const distanceKm = haversineKm({ latitude, longitude }, point);
    // Temps réel en transports en commun s'il a été calculé (Navitia) ; sinon
    // estimation vol d'oiseau. La distance à vol d'oiseau reste affichée à côté.
    const real = transitMinutes?.[point.label];
    return {
      label: point.label,
      distanceKm: Math.round(distanceKm * 100) / 100,
      durationMinutes: real ?? estimateDurationMinutes(distanceKm, point.mode),
      mode: point.mode,
      durationSource: real !== undefined ? ('transit' as const) : ('estimate' as const),
    };
  });
}

/**
 * `true` si le trajet domicile→travail dépasse le plafond `maxCommuteMinutes`
 * (§53). On se fonde sur les points en transports en commun (le trajet
 * travail). Sans plafond, ou sans durée connue, on n'exclut jamais (§17).
 */
export function exceedsCommute(
  distances: readonly ReferenceDistance[],
  maxCommuteMinutes?: number,
): boolean {
  if (maxCommuteMinutes === undefined) return false;
  return distances.some((d) => d.mode === 'transit' && d.durationMinutes > maxCommuteMinutes);
}

/** Applique les quatre scores et les distances à un logement. */
export function scoreListing(listing: AggregatedListing, options: ScoringOptions): ScoredListing {
  const match = scoreMatch(listing, options.criteria);
  const priceDropped =
    options.priceDroppedIds !== undefined &&
    listing.occurrences.some((occurrence) => options.priceDroppedIds?.has(occurrence.id));

  const distances = computeDistances(
    listing,
    options.referencePoints,
    options.resolvedCoordinates,
    options.resolvedTransitMinutes,
  );
  // Un trajet travail trop long rend l'annonce hors critères (§53).
  const commuteTooLong = exceedsCommute(distances, options.criteria.maxCommuteMinutes);

  return {
    ...listing,
    scores: {
      match: match.score,
      opportunity: scoreOpportunity(listing, { nowMs: options.nowMs, priceDropped }),
      visitProbability: scoreVisitProbability(listing, {
        nowMs: options.nowMs,
        ...(options.observedStats !== undefined ? { observedStats: options.observedStats } : {}),
      }),
      risk: scoreRisk(listing, { referencePricePerSqm: options.referencePricePerSqm }),
    },
    distances,
    matchesCriteria: match.matchesCriteria && !commuteTooLong,
    priceDropped,
  };
}
