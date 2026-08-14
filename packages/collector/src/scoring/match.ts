/**
 * MATCH SCORE — « cette annonce correspond-elle à mes critères ? » (§16).
 *
 * Le score est construit à partir des critères actifs uniquement. Ajouter un
 * critère (quartier, DPE, balcon…) revient à ajouter une règle ici, sans
 * toucher au reste du système (§2).
 */

import type {
  AggregatedListing,
  ExplainedScore,
  ScoreReason,
  SearchCriteria,
} from '@rentfinder/shared';
import { clampScore } from '@rentfinder/shared';
import { comparable } from '../normalization/text.js';

export interface MatchOutcome {
  readonly score: ExplainedScore;
  /**
   * `false` si l'annonce viole un critère éliminatoire (§53 scénario 3).
   * Elle reste collectée et consultable, mais sort de la liste principale.
   */
  readonly matchesCriteria: boolean;
}

/** Évalue la correspondance d'un logement aux critères de recherche. */
export function scoreMatch(listing: AggregatedListing, criteria: SearchCriteria): MatchOutcome {
  const reasons: ScoreReason[] = [];
  const unknownSignals: string[] = [];
  let matchesCriteria = true;
  let total = 0;
  let maxTotal = 0;

  // --- Ville : critère éliminatoire ----------------------------------------
  maxTotal += 30;
  const city = listing.city.value;
  if (city === null) {
    unknownSignals.push('ville');
    // Ville inconnue : on n'élimine pas, mais on n'accorde aucun point.
    reasons.push({ code: 'city.unknown', label: 'Ville non précisée par la source', delta: 0 });
  } else if (criteria.cities.some((wanted) => city.includes(comparable(wanted)))) {
    total += 30;
    reasons.push({ code: 'city.match', label: `Située à ${city}`, delta: 30 });
  } else {
    matchesCriteria = false;
    reasons.push({ code: 'city.mismatch', label: `Hors zone recherchée (${city})`, delta: 0 });
  }

  // --- Loyer : critère éliminatoire ----------------------------------------
  maxTotal += 40;
  const price = listing.price.value;
  if (price === null) {
    unknownSignals.push('loyer');
    reasons.push({ code: 'price.unknown', label: 'Loyer non publié', delta: 0 });
  } else if (price <= criteria.maxPrice) {
    // Plus le loyer est bas sous le plafond, meilleur est le score : à 30 % du
    // budget sous le plafond, on atteint le maximum.
    const margin = (criteria.maxPrice - price) / criteria.maxPrice;
    const points = Math.round(30 + Math.min(10, margin * 33));
    total += points;
    reasons.push({
      code: 'price.within',
      label: `${price} € ≤ ${criteria.maxPrice} € de budget`,
      delta: points,
    });
  } else {
    matchesCriteria = false;
    reasons.push({
      code: 'price.over',
      label: `${price} € dépasse le budget de ${price - criteria.maxPrice} €`,
      delta: 0,
    });
  }

  // --- Surface : critère éliminatoire --------------------------------------
  maxTotal += 30;
  const area = listing.area.value;
  if (area === null) {
    unknownSignals.push('surface');
    reasons.push({ code: 'area.unknown', label: 'Surface non publiée', delta: 0 });
  } else if (area >= criteria.minArea) {
    // Au-delà du minimum, chaque m² compte de moins en moins.
    const bonus = Math.min(10, (area - criteria.minArea) / 2);
    const points = Math.round(20 + bonus);
    total += points;
    reasons.push({
      code: 'area.within',
      label: `${area} m² ≥ ${criteria.minArea} m²`,
      delta: points,
    });
  } else {
    matchesCriteria = false;
    reasons.push({
      code: 'area.under',
      label: `${area} m² sous le minimum de ${criteria.minArea} m²`,
      delta: 0,
    });
  }

  // --- Critères optionnels, inactifs dans le MVP (§2) -----------------------
  if (criteria.propertyTypes !== undefined && criteria.propertyTypes.length > 0) {
    maxTotal += 10;
    const type = listing.propertyType.value;
    if (criteria.propertyTypes.includes(type)) {
      total += 10;
      reasons.push({ code: 'type.match', label: `Type recherché (${type})`, delta: 10 });
    } else if (type === 'unknown') {
      unknownSignals.push('type de bien');
    }
  }

  if (criteria.furnished !== undefined) {
    maxTotal += 10;
    const furnished = listing.furnished.value;
    if (furnished === null) {
      unknownSignals.push('meublé');
    } else if (furnished === criteria.furnished) {
      total += 10;
      reasons.push({
        code: 'furnished.match',
        label: criteria.furnished ? 'Meublé, comme demandé' : 'Non meublé, comme demandé',
        delta: 10,
      });
    }
  }

  // Le score est rapporté au total réellement évaluable : une annonce dont la
  // surface est inconnue n'est pas pénalisée comme si elle était trop petite.
  const evaluated = maxTotal - unknownSignals.length * 10;
  const normalized = evaluated > 0 ? (total / evaluated) * 100 : 0;

  return {
    matchesCriteria,
    score: {
      value: clampScore(matchesCriteria ? normalized : Math.min(normalized, 40)),
      reasons,
      unknownSignals,
      confidence: maxTotal > 0 ? Math.max(0, evaluated / maxTotal) : 0,
    },
  };
}
