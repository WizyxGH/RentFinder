/**
 * Garde-fous du contact automatique (§23).
 *
 * Cette fonction est le seul point autorisé à répondre « oui » à un envoi
 * automatique. Elle est volontairement écrite en refus par défaut : chaque
 * condition doit être explicitement satisfaite, et le premier refus arrête
 * l'évaluation.
 *
 * §42 le rappelle : le contact automatique ne doit pas être construit avant
 * d'avoir une collecte fiable et un bon dédoublonnage. Le code existe ici pour
 * que la logique soit testable dès maintenant (§53 scénario 5), mais
 * l'interrupteur global reste sur OFF tant qu'il n'est pas activé sciemment.
 */

import type {
  AutoContactLimits,
  ContactAttempt,
  ScoredListing,
  SourceDescriptor,
} from '@rentfinder/shared';

export interface AutoContactDecision {
  readonly allowed: boolean;
  /** Raison du refus, ou justification de l'autorisation. Toujours renseignée. */
  readonly reason: string;
}

export interface AutoContactInput {
  readonly listing: ScoredListing;
  readonly limits: AutoContactLimits;
  /** Descripteurs des sources d'où provient l'annonce. */
  readonly descriptors: readonly SourceDescriptor[];
  /** Journal des envois, tous listings confondus (§23). */
  readonly history: readonly ContactAttempt[];
  readonly nowMs: number;
}

/** Refuse ou autorise un envoi automatique. */
export function evaluateAutoContact(input: AutoContactInput): AutoContactDecision {
  const { listing, limits, descriptors, history, nowMs } = input;

  // 1. Interrupteur global — la première barrière, et la plus importante.
  if (!limits.enabled) {
    return { allowed: false, reason: 'contact automatique désactivé globalement' };
  }

  // 2. Sources déclarées manuelles uniquement.
  const manualOnly = descriptors.find((descriptor) => descriptor.manualOnly);
  if (manualOnly !== undefined) {
    return {
      allowed: false,
      reason: `la source « ${manualOnly.id} » est déclarée manualOnly`,
    };
  }

  // 3. Un seul contact par annonce, jamais deux.
  const alreadyContacted = history.some((attempt) => attempt.listingId === listing.id);
  if (alreadyContacted) {
    return { allowed: false, reason: 'annonce déjà contactée' };
  }

  // 4. Seuils de score.
  const { scores } = listing;
  const { thresholds } = limits;
  if (scores.match.value < thresholds.minMatch) {
    return { allowed: false, reason: `match ${scores.match.value} < ${thresholds.minMatch}` };
  }
  if (scores.opportunity.value < thresholds.minOpportunity) {
    return {
      allowed: false,
      reason: `opportunité ${scores.opportunity.value} < ${thresholds.minOpportunity}`,
    };
  }
  if (scores.visitProbability.value < thresholds.minVisitProbability) {
    return {
      allowed: false,
      reason: `probabilité de visite ${scores.visitProbability.value} < ${thresholds.minVisitProbability}`,
    };
  }
  if (scores.risk.value > thresholds.maxRisk) {
    return { allowed: false, reason: `risque ${scores.risk.value} > ${thresholds.maxRisk}` };
  }

  // 5. Quotas glissants.
  const sentAt = history.map((attempt) => Date.parse(attempt.sentAt)).filter(Number.isFinite);
  const lastHour = sentAt.filter((time) => nowMs - time < 3_600_000).length;
  if (lastHour >= limits.maxPerHour) {
    return { allowed: false, reason: `quota horaire atteint (${lastHour}/${limits.maxPerHour})` };
  }

  const lastDay = sentAt.filter((time) => nowMs - time < 86_400_000).length;
  if (lastDay >= limits.maxPerDay) {
    return { allowed: false, reason: `quota journalier atteint (${lastDay}/${limits.maxPerDay})` };
  }

  const sourceIds = new Set(listing.occurrences.map((occurrence) => occurrence.sourceId));
  for (const sourceId of sourceIds) {
    const perSource = history.filter(
      (attempt) => attempt.sourceId === sourceId && nowMs - Date.parse(attempt.sentAt) < 86_400_000,
    ).length;
    if (perSource >= limits.maxPerSourcePerDay) {
      return {
        allowed: false,
        reason: `quota journalier atteint pour ${sourceId} (${perSource}/${limits.maxPerSourcePerDay})`,
      };
    }
  }

  // 6. Cooldown entre deux envois.
  const lastSent = sentAt.length > 0 ? Math.max(...sentAt) : null;
  if (lastSent !== null && nowMs - lastSent < limits.cooldownSeconds * 1000) {
    const remaining = Math.ceil((limits.cooldownSeconds * 1000 - (nowMs - lastSent)) / 1000);
    return { allowed: false, reason: `cooldown actif encore ${remaining} s` };
  }

  // 7. Un moyen de contact doit exister.
  if (listing.contact.email === null && listing.contact.formUrl === null) {
    return { allowed: false, reason: 'aucun canal automatisable (ni e-mail ni formulaire)' };
  }

  return { allowed: true, reason: 'toutes les conditions sont satisfaites' };
}
