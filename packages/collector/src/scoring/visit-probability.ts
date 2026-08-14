/**
 * VISIT PROBABILITY — « mon contact a-t-il des chances d'aboutir à une visite ? »
 * (§18).
 *
 * AVERTISSEMENT MÉTHODOLOGIQUE, à conserver tant que le modèle n'a pas été
 * calibré sur des résultats réels :
 *
 *   Ce score n'est PAS une probabilité statistique. C'est un indice de
 *   faisabilité fondé sur des règles explicites et assumées. Il ne repose sur
 *   aucun échantillon, aucune régression, aucun apprentissage.
 *
 * §18 demande explicitement de ne pas prétendre à une précision inexistante.
 * L'interface doit donc le présenter comme un classement relatif, jamais comme
 * « 84 % de chances ». Le score deviendra empirique en V2/V3, quand le journal
 * des contacts aura accumulé assez de résultats réels (§33).
 */

import type { AggregatedListing, ExplainedScore, ScoreReason } from '@rentfinder/shared';
import { clampScore } from '@rentfinder/shared';

export interface VisitProbabilityOptions {
  readonly nowMs: number;
  /**
   * Statistiques personnelles observées, quand elles existent (§33).
   * Absentes au démarrage : le score reste alors purement basé sur les règles.
   */
  readonly observedStats?: {
    /** Taux de visite constaté par source, dans [0, 1]. */
    readonly visitRateBySource?: Readonly<Record<string, number>>;
  };
}

/** Base de départ : sans aucune information, on ne présume rien de tranché. */
const NEUTRAL_BASE = 40;

export function scoreVisitProbability(
  listing: AggregatedListing,
  options: VisitProbabilityOptions,
): ExplainedScore {
  const reasons: ScoreReason[] = [];
  const unknownSignals: string[] = [];
  let total = NEUTRAL_BASE;
  reasons.push({ code: 'base', label: 'Base neutre', delta: NEUTRAL_BASE });

  // --- Délai entre publication et contact ----------------------------------
  // Le facteur le mieux documenté du marché locatif tendu : être parmi les
  // premiers à répondre.
  const published = listing.publishedAt.value;
  if (published === null) {
    unknownSignals.push('date de publication');
  } else {
    const ageHours = (options.nowMs - Date.parse(published)) / 3_600_000;
    if (ageHours <= 1) {
      total += 25;
      reasons.push({
        code: 'timing.veryEarly',
        label: 'Contact dans l’heure suivant la publication',
        delta: 25,
      });
    } else if (ageHours <= 6) {
      total += 15;
      reasons.push({ code: 'timing.early', label: 'Contact le jour même', delta: 15 });
    } else if (ageHours <= 24) {
      total += 5;
      reasons.push({ code: 'timing.sameDay', label: 'Contact sous 24 h', delta: 5 });
    } else if (ageHours > 72) {
      total -= 20;
      reasons.push({
        code: 'timing.late',
        label: `Annonce vieille de ${Math.round(ageHours / 24)} jours — probablement déjà pourvue`,
        delta: -20,
      });
    }
  }

  // --- Canal de contact disponible -----------------------------------------
  const { phone, email, formUrl, kind } = listing.contact;
  if (phone !== null) {
    total += 20;
    reasons.push({ code: 'channel.phone', label: 'Appel direct possible', delta: 20 });
  } else if (email !== null) {
    total += 10;
    reasons.push({ code: 'channel.email', label: 'Contact par e-mail', delta: 10 });
  } else if (formUrl !== null) {
    total += 3;
    reasons.push({
      code: 'channel.form',
      label: 'Formulaire uniquement — réponse plus lente',
      delta: 3,
    });
  } else {
    total -= 15;
    unknownSignals.push('moyen de contact');
    reasons.push({ code: 'channel.none', label: 'Aucun moyen de contact direct', delta: -15 });
  }

  // --- Nature du bailleur ---------------------------------------------------
  if (kind === 'agency') {
    total += 5;
    reasons.push({
      code: 'landlord.agency',
      label: 'Agence identifiée — process de visite établi',
      delta: 5,
    });
  } else if (kind === 'private') {
    // Un particulier répond de façon plus variable, mais sans intermédiaire.
    reasons.push({
      code: 'landlord.private',
      label: 'Particulier — réponse plus variable',
      delta: 0,
    });
  } else {
    unknownSignals.push('nature du bailleur');
  }

  // --- Concurrence ----------------------------------------------------------
  const sourceCount = new Set(listing.occurrences.map((o) => o.sourceId)).size;
  if (sourceCount >= 3) {
    total -= 10;
    reasons.push({
      code: 'competition.high',
      label: `Diffusée sur ${sourceCount} portails — forte concurrence`,
      delta: -10,
    });
  }

  // --- Statistiques personnelles, si elles existent (§33) -------------------
  const rates = options.observedStats?.visitRateBySource;
  if (rates !== undefined) {
    const primarySource = listing.occurrences[0]?.sourceId;
    const rate = primarySource !== undefined ? rates[primarySource] : undefined;
    if (rate !== undefined) {
      // L'observation réelle corrige la règle, sans l'écraser : l'échantillon
      // est encore trop petit pour lui faire pleinement confiance.
      const delta = Math.round((rate - 0.3) * 30);
      total += delta;
      reasons.push({
        code: 'stats.observed',
        label: `Taux de visite constaté sur ${primarySource} : ${Math.round(rate * 100)} %`,
        delta,
      });
    }
  } else {
    unknownSignals.push('statistiques personnelles (aucun historique)');
  }

  const optionalSignals = 4;
  const missing = Math.min(optionalSignals, unknownSignals.length);

  return {
    value: clampScore(total),
    reasons,
    unknownSignals,
    confidence: (optionalSignals - missing) / optionalSignals,
  };
}
