/**
 * OPPORTUNITY SCORE — « dois-je agir maintenant ? » (§17).
 *
 * Sur un marché tendu, la fraîcheur prime sur tout le reste : une annonce de
 * quatre minutes vaut mieux qu'une annonce parfaite vieille de trois jours.
 *
 * Exigence absolue du cahier des charges : ne JAMAIS inventer une donnée. Un
 * nombre de favoris absent n'est pas zéro — il est inconnu, il ne contribue pas
 * au score, et il est déclaré dans `unknownSignals`. C'est ce qui permet à
 * l'interface d'afficher « score calculé sans les favoris » plutôt que de
 * laisser croire à une précision qui n'existe pas.
 */

import type { AggregatedListing, ExplainedScore, ScoreReason } from '@rentfinder/shared';
import { clampScore } from '@rentfinder/shared';

/** Paliers de fraîcheur, en minutes, et points associés. */
const FRESHNESS_TIERS: readonly { maxMinutes: number; points: number; label: string }[] = [
  { maxMinutes: 15, points: 50, label: 'Publiée il y a moins de 15 min' },
  { maxMinutes: 60, points: 45, label: 'Publiée il y a moins d’une heure' },
  { maxMinutes: 60 * 6, points: 35, label: 'Publiée il y a moins de 6 h' },
  { maxMinutes: 60 * 24, points: 25, label: 'Publiée aujourd’hui' },
  { maxMinutes: 60 * 24 * 3, points: 12, label: 'Publiée il y a moins de 3 jours' },
  { maxMinutes: 60 * 24 * 7, points: 5, label: 'Publiée cette semaine' },
];

export interface OpportunityOptions {
  readonly nowMs: number;
  /** `true` si le loyer a récemment baissé — signal d'opportunité fort (§17). */
  readonly priceDropped?: boolean;
}

/**
 * Détermine l'âge de l'annonce en minutes.
 *
 * On préfère `publishedAt` quand la source le fournit. À défaut, `firstSeenAt`
 * donne une borne supérieure honnête : « vue pour la première fois il y a X ».
 * La distinction est signalée, car les deux n'ont pas la même valeur.
 */
function ageMinutes(
  listing: AggregatedListing,
  nowMs: number,
): { minutes: number; basis: 'published' | 'firstSeen' } | null {
  const published = listing.publishedAt.value;
  if (published !== null) {
    const parsed = Date.parse(published);
    if (Number.isFinite(parsed)) {
      return { minutes: (nowMs - parsed) / 60_000, basis: 'published' };
    }
  }

  const firstSeen = Date.parse(listing.firstSeenAt);
  if (Number.isFinite(firstSeen)) {
    return { minutes: (nowMs - firstSeen) / 60_000, basis: 'firstSeen' };
  }
  return null;
}

/** Évalue l'urgence à contacter. */
export function scoreOpportunity(
  listing: AggregatedListing,
  options: OpportunityOptions,
): ExplainedScore {
  const reasons: ScoreReason[] = [];
  const unknownSignals: string[] = [];
  let total = 0;

  // --- Fraîcheur (jusqu'à 50 points) ---------------------------------------
  const age = ageMinutes(listing, options.nowMs);
  if (age === null) {
    unknownSignals.push('date de publication');
  } else {
    const tier = FRESHNESS_TIERS.find((candidate) => age.minutes <= candidate.maxMinutes);
    const points = tier?.points ?? 0;
    // Une date de première observation est moins fiable qu'une date de
    // publication : on n'accorde que 70 % des points dans ce cas.
    const adjusted = age.basis === 'published' ? points : Math.round(points * 0.7);
    total += adjusted;
    reasons.push({
      code: `freshness.${age.basis}`,
      label:
        age.basis === 'published'
          ? (tier?.label ?? 'Publiée il y a plus d’une semaine')
          : `Découverte il y a ${Math.round(age.minutes)} min (date de publication non fournie)`,
      delta: adjusted,
    });
    if (age.basis === 'firstSeen') unknownSignals.push('date de publication exacte');
  }

  // --- Facilité de contact (jusqu'à 30 points) -----------------------------
  // Un numéro de téléphone permet d'appeler dans la minute ; c'est le facteur
  // le plus déterminant après la fraîcheur.
  const { phone, email, formUrl } = listing.contact;
  if (phone !== null) {
    total += 20;
    reasons.push({ code: 'contact.phone', label: 'Téléphone disponible', delta: 20 });
  }
  if (email !== null) {
    total += 10;
    reasons.push({ code: 'contact.email', label: 'E-mail disponible', delta: 10 });
  }
  if (phone === null && email === null) {
    if (formUrl !== null) {
      total += 4;
      reasons.push({ code: 'contact.form', label: 'Formulaire de contact uniquement', delta: 4 });
    } else {
      unknownSignals.push('moyen de contact');
      reasons.push({ code: 'contact.none', label: 'Aucune coordonnée publiée', delta: 0 });
    }
  }

  // --- Baisse de prix récente (jusqu'à 12 points) --------------------------
  // Un bailleur qui baisse son loyer cherche activement un locataire : c'est
  // le moment d'agir (§17). Signal factuel issu de `listing_history`.
  if (options.priceDropped === true) {
    total += 12;
    reasons.push({ code: 'price.dropped', label: 'Loyer récemment en baisse', delta: 12 });
  }

  // --- Multi-diffusion (jusqu'à 10 points) ---------------------------------
  // Une annonce présente sur plusieurs portails est vue par plus de monde :
  // la concurrence est plus forte, donc il faut agir plus vite.
  const sourceCount = new Set(listing.occurrences.map((o) => o.sourceId)).size;
  if (sourceCount > 1) {
    const points = Math.min(10, sourceCount * 3);
    total += points;
    reasons.push({
      code: 'exposure.multi',
      label: `Diffusée sur ${sourceCount} sources — concurrence probable`,
      delta: points,
    });
  }

  // --- Signaux d'intérêt, uniquement s'ils existent (§17) -------------------
  const views = listing.views.value;
  const favorites = listing.favorites.value;

  if (views === null) unknownSignals.push('nombre de vues');
  if (favorites === null) unknownSignals.push('nombre de favoris');

  if (views !== null && age !== null && age.minutes > 0) {
    // Un fort taux de vues par heure signale une annonce qui part vite.
    const viewsPerHour = views / Math.max(1, age.minutes / 60);
    if (viewsPerHour > 20) {
      total += 10;
      reasons.push({
        code: 'interest.views',
        label: `${Math.round(viewsPerHour)} vues/h — annonce très consultée`,
        delta: 10,
      });
    }
  }

  if (favorites !== null && favorites > 5) {
    total += 5;
    reasons.push({ code: 'interest.favorites', label: `${favorites} mises en favori`, delta: 5 });
  }

  // Trois signaux facultatifs (publication, vues, favoris) : la confiance
  // décroît avec chaque absence.
  const optionalSignals = 3;
  const missing = Math.min(optionalSignals, unknownSignals.length);

  return {
    value: clampScore(total),
    reasons,
    unknownSignals,
    confidence: (optionalSignals - missing) / optionalSignals,
  };
}
