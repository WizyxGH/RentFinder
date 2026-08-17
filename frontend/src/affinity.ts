/**
 * Affinité : apprendre de vos interactions quelles annonces vous ressemblent,
 * pour les remonter dans la liste (§18, §33 — apprendre des résultats).
 *
 * Principe simple et TRANSPARENT (pas de « boîte noire ») : on construit un
 * profil de préférences à partir des annonces avec lesquelles vous avez
 * interagi — fortement pour celles que vous suivez (à contacter, contactée,
 * visitée…), faiblement pour celles seulement consultées, négativement pour
 * les archivées/refusées. Chaque annonce reçoit alors un score d'affinité selon
 * ses caractéristiques partagées (type, gamme de prix, pièces, DPE, atouts).
 *
 * Prudence : sans assez de signal (< 2 annonces appréciées), on ne personnalise
 * PAS — mieux vaut ne rien remonter que sur-interpréter un clic isolé.
 */

import type { ListingView } from './types.js';

const POSITIVE_TRACKING: Readonly<Record<string, number>> = {
  toContact: 2,
  contacted: 3,
  replied: 3,
  visitOffered: 4,
  visitScheduled: 4,
  visited: 5,
  rented: 5,
};
const NEGATIVE_TRACKING = new Set(['rejected', 'ignored']);

/** Caractéristiques discrètes d'une annonce, base de la similarité. */
function featuresOf(listing: ListingView): string[] {
  const features: string[] = [];
  if (listing.propertyType.value !== 'unknown') features.push(`type:${listing.propertyType.value}`);
  if (listing.price.value !== null) {
    features.push(`price:${Math.round(listing.price.value / 100) * 100}`);
  }
  if (listing.rooms.value !== null) features.push(`rooms:${listing.rooms.value}`);
  if (listing.dpe?.value != null) features.push(`dpe:${listing.dpe.value}`);
  for (const feature of listing.features ?? []) features.push(`atout:${feature}`);
  return features;
}

/** Poids d'une annonce dans le profil : positif si appréciée, négatif si rejetée. */
function interactionWeight(listing: ListingView): number {
  if (listing.archived === true || NEGATIVE_TRACKING.has(listing.tracking)) return -2;
  // Le favori est le signal d'appréciation le plus explicite.
  if (listing.favorite === true) return 5;
  const tracked = POSITIVE_TRACKING[listing.tracking];
  if (tracked !== undefined) return tracked;
  if (listing.viewed === true) return 1;
  return 0;
}

export interface AffinityResult {
  /** Score d'affinité par id d'annonce, dans [0, 1]. */
  readonly scores: ReadonlyMap<string, number>;
  /** `true` si le signal suffit pour personnaliser le classement. */
  readonly active: boolean;
}

/** Calcule l'affinité de chaque annonce à partir des interactions passées. */
export function computeAffinity(listings: readonly ListingView[]): AffinityResult {
  const weights = new Map<string, number>();
  let positiveCount = 0;

  for (const listing of listings) {
    const weight = interactionWeight(listing);
    if (weight > 0) positiveCount += 1;
    if (weight === 0) continue;
    for (const feature of featuresOf(listing)) {
      weights.set(feature, (weights.get(feature) ?? 0) + weight);
    }
  }

  const scores = new Map<string, number>();
  if (positiveCount < 2) {
    for (const listing of listings) scores.set(listing.id, 0);
    return { scores, active: false };
  }

  // Score brut = somme des poids POSITIFS des caractéristiques de l'annonce.
  let maxRaw = 0;
  const raw = new Map<string, number>();
  for (const listing of listings) {
    const score = featuresOf(listing).reduce(
      (sum, feature) => sum + Math.max(0, weights.get(feature) ?? 0),
      0,
    );
    raw.set(listing.id, score);
    if (score > maxRaw) maxRaw = score;
  }
  for (const listing of listings) {
    scores.set(listing.id, maxRaw > 0 ? (raw.get(listing.id) ?? 0) / maxRaw : 0);
  }
  return { scores, active: true };
}

/** Poids du boost d'affinité dans le classement (points de priorité). */
export const AFFINITY_BOOST = 15;

/** Seuil d'affichage du badge « correspond à vos préférences ». */
export const AFFINITY_BADGE_THRESHOLD = 0.6;
