/**
 * Coordonnées et suivi des prises de contact (§21, §22, §23, §34, §35).
 */

import type { IsoDateTime, Maybe, SourceId } from './provenance.js';

/** Nature de l'interlocuteur — influence la probabilité de visite (§18). */
export type LandlordKind = 'agency' | 'private' | 'unknown';

/**
 * Coordonnées publiquement disponibles d'une annonce (§21).
 *
 * Aucune de ces valeurs n'est obtenue en contournant une protection : si un
 * numéro n'est révélé qu'après résolution d'un CAPTCHA ou création de compte,
 * il reste `null` et l'interface affiche « non disponible » (§10, §21).
 *
 * Chaque champ porte la source qui l'a fourni, pour que l'interface puisse
 * afficher « téléphone trouvé sur le site de l'agence » (§21).
 */
export interface Contact {
  readonly name: Maybe<string>;
  readonly agencyName: Maybe<string>;
  /** Numéro au format E.164 lorsque la normalisation aboutit. */
  readonly phone: Maybe<string>;
  readonly email: Maybe<string>;
  /** URL du formulaire de contact, à privilégier quand la source le prévoit. */
  readonly formUrl: Maybe<string>;
  /** Référence interne de l'annonce chez l'agence — signal fort de doublon (§14). */
  readonly reference: Maybe<string>;
  readonly kind: LandlordKind;
  /** Sources ayant contribué à ces coordonnées. */
  readonly providedBy: readonly SourceId[];
}

/** Contact vide — utilisé quand une source ne publie aucune coordonnée. */
export const EMPTY_CONTACT: Contact = {
  name: null,
  agencyName: null,
  phone: null,
  email: null,
  formUrl: null,
  reference: null,
  kind: 'unknown',
  providedBy: [],
};

/** Canal par lequel un message peut partir. */
export type ContactChannel = 'email' | 'phone' | 'form' | 'manual';

/** Qui a déclenché l'envoi (§22, §23). */
export type ContactTrigger = 'manual' | 'automatic';

/**
 * Trace d'une prise de contact (§23 : « journal de chaque contact »).
 *
 * Le journal est la garantie qu'aucun message ne part deux fois et que le mode
 * automatique reste auditable.
 */
export interface ContactAttempt {
  readonly id: string;
  /** Identifiant du logement agrégé, pas d'une occurrence : un contact par fiche. */
  readonly listingId: string;
  readonly sourceId: SourceId;
  readonly channel: ContactChannel;
  readonly trigger: ContactTrigger;
  readonly sentAt: IsoDateTime;
  /** Corps réellement envoyé, conservé pour pouvoir relancer avec cohérence. */
  readonly message: string;
  /** Numéro de relance : 0 pour le premier contact (§34). */
  readonly followUpIndex: number;
  readonly outcome: ContactOutcome;
}

/** Résultat observé d'une prise de contact (§33). */
export type ContactOutcome =
  | 'pending'
  | 'replied'
  | 'visitOffered'
  | 'visitScheduled'
  | 'visited'
  | 'rejected'
  | 'noReply'
  | 'failed';

/**
 * Garde-fous du mode automatique (§23).
 *
 * Toutes les limites sont vérifiées AVANT chaque envoi. Le franchissement
 * d'une seule d'entre elles annule l'envoi — il n'y a pas de dérogation.
 */
export interface AutoContactLimits {
  /** Interrupteur global. `false` = aucun envoi automatique possible (§23). */
  readonly enabled: boolean;
  readonly maxPerHour: number;
  readonly maxPerDay: number;
  readonly maxPerSourcePerDay: number;
  /** Délai minimal entre deux envois, en secondes. */
  readonly cooldownSeconds: number;
  /** Seuils de score requis pour qu'un envoi automatique soit envisagé. */
  readonly thresholds: {
    readonly minMatch: number;
    readonly minOpportunity: number;
    readonly minVisitProbability: number;
    readonly maxRisk: number;
  };
}
