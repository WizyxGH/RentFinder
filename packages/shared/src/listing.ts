/**
 * Modèle de données des annonces (§12).
 *
 * Trois représentations successives, volontairement distinctes, pour que le
 * contrat entre chaque étage du pipeline soit explicite (§48) :
 *
 *   RawListing        ce qu'un scraper extrait, tel quel, en chaînes brutes
 *        ↓ normalization
 *   NormalizedListing une annonce typée et validée, propre à UNE source
 *        ↓ deduplication
 *   AggregatedListing un logement unique, regroupant toutes ses occurrences
 *        ↓ scoring
 *   ScoredListing     le logement enrichi de ses quatre scores
 */

import type { Contact } from './contact.js';
import type { ReferenceTravelMode } from './reference-points.js';
import type { ListingScores } from './scores.js';
import type { IsoDateTime, Maybe, MergedField, SourceId } from './provenance.js';

/** Type de bien. `unknown` lorsque la source ne le précise pas (§17). */
export type PropertyType =
  | 'apartment'
  | 'house'
  | 'studio'
  | 'room'
  | 'loft'
  // Bien NON résidentiel (parking, box, garage) : bruit pour ce projet, exclu
  // de la liste principale (§16).
  | 'parking'
  | 'other'
  | 'unknown';

/**
 * Cycle de vie d'une annonce (§32).
 *
 * On ne supprime jamais une annonce dès qu'elle cesse d'être vue : une source
 * peut être temporairement en échec. Le passage `active → possiblyInactive →
 * inactive` permettra plus tard de mesurer la durée de publication réelle.
 */
export type LifecycleStatus = 'active' | 'possiblyInactive' | 'inactive';

/**
 * Étape de la relation avec l'annonce, pilotée par l'utilisateur (§35).
 */
export type TrackingStatus =
  | 'new'
  | 'toContact'
  | 'contacted'
  | 'replied'
  | 'visitOffered'
  | 'visitScheduled'
  | 'visited'
  | 'rejected'
  | 'rented'
  | 'ignored';

// ---------------------------------------------------------------------------
// Étage 1 — sortie brute d'un scraper
// ---------------------------------------------------------------------------

/**
 * Ce qu'un scraper produit. Tout est optionnel et non typé : le scraper
 * n'a pas à connaître les règles métier, il se contente d'extraire fidèlement.
 *
 * Un scraper ne doit JAMAIS deviner ni compléter une valeur absente. Un champ
 * introuvable est simplement omis (§17).
 */
export interface RawListing {
  /** Identifiant de l'annonce chez la source (référence, numéro d'annonce). */
  readonly sourceRef: string;
  /** URL publique et directe de l'annonce, telle qu'un humain la consulterait. */
  readonly sourceUrl: string;

  readonly title?: string;
  readonly description?: string;

  /** Texte brut du prix, ex. `"1 890 €/mois"`. Le parsing est fait plus tard. */
  readonly priceText?: string;
  readonly chargesText?: string;
  /** Texte brut de la surface, ex. `"67 m²"`. */
  readonly areaText?: string;
  readonly roomsText?: string;
  readonly propertyTypeText?: string;
  readonly furnishedText?: string;

  readonly addressText?: string;
  readonly cityText?: string;
  readonly postalCodeText?: string;
  readonly latitude?: number;
  readonly longitude?: number;

  readonly agencyName?: string;
  readonly contactName?: string;
  readonly phoneText?: string;
  readonly emailText?: string;
  readonly contactFormUrl?: string;

  readonly publishedAtText?: string;
  readonly availableAtText?: string;

  /**
   * URLs publiques des photos. §11 : elles ne sont JAMAIS téléchargées,
   * stockées, ni proxyfiées — seule l'URL peut être conservée pour permettre
   * au navigateur de l'afficher directement depuis le site d'origine.
   */
  readonly imageUrls?: readonly string[];

  /** Signaux d'intérêt éventuellement exposés par la source (§17). */
  readonly viewsText?: string;
  readonly favoritesText?: string;

  /** Champs supplémentaires spécifiques à une source, conservés tels quels. */
  readonly extra?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Étage 2 — annonce normalisée, propre à une source
// ---------------------------------------------------------------------------

/**
 * Occurrence d'un logement sur une source donnée.
 *
 * C'est l'unité conservée en base : on ne perd jamais l'annonce originale,
 * même après regroupement (§13).
 */
export interface ListingOccurrence {
  /** Clé stable : `${sourceId}:${sourceRef}`. */
  readonly id: string;
  readonly sourceId: SourceId;
  readonly sourceRef: string;
  readonly sourceUrl: string;

  readonly title: Maybe<string>;
  readonly description: Maybe<string>;

  /** Loyer mensuel en euros, charges comprises ou non selon `chargesIncluded`. */
  readonly price: Maybe<number>;
  readonly charges: Maybe<number>;
  readonly chargesIncluded: Maybe<boolean>;
  /** Surface habitable en m². */
  readonly area: Maybe<number>;
  readonly rooms: Maybe<number>;
  readonly bedrooms: Maybe<number>;
  readonly propertyType: PropertyType;
  readonly furnished: Maybe<boolean>;
  /**
   * `true` : le bien est proposé EN colocation (souvent une chambre dans un
   * logement partagé). `false` : logement entier (y compris « colocation
   * possible »). `null` : la source ne le dit pas (§17).
   */
  readonly flatShare: Maybe<boolean>;
  /** Classe énergétique (DPE) en majuscule « A »–« G », ou `null` (§17). */
  readonly dpe: Maybe<string>;
  /**
   * Nombre maximal d'occupants annoncé (« peut accueillir jusqu'à 4 personnes »).
   *
   * Décisif quand on cherche à plusieurs, et publié par les meublés courte
   * durée (Lodgis, Studapart) que le reste de l'inventaire ignore. `null`
   * quand la source n'en dit rien — jamais déduit du nombre de pièces (§17).
   */
  readonly maxOccupants: Maybe<number>;
  /**
   * Atouts affichables extraits de l'annonce (« Ascenseur », « Balcon »,
   * « 3e étage », « Meublé »…). Liste normalisée, dédoublonnée, jamais
   * inventée : uniquement ce que la source mentionne. Vide si rien.
   */
  readonly features: readonly string[];

  readonly address: Maybe<string>;
  /**
   * Quartier/secteur si la source le publie (ex. Orpi « Madeleine »). N'est PAS
   * une adresse de rue — tenu à part pour ne pas fausser le dédoublonnage
   * « même adresse » (§14), mais affichable pour situer le bien mieux que la
   * seule ville.
   */
  readonly district: Maybe<string>;
  readonly city: Maybe<string>;
  readonly postalCode: Maybe<string>;
  readonly latitude: Maybe<number>;
  readonly longitude: Maybe<number>;

  readonly contact: Contact;

  readonly publishedAt: Maybe<IsoDateTime>;
  readonly availableAt: Maybe<IsoDateTime>;

  /** URLs distantes uniquement — voir §11. */
  readonly imageUrls: readonly string[];

  /** Signaux d'intérêt. `null` = la source ne les publie pas (§17). */
  readonly views: Maybe<number>;
  readonly favorites: Maybe<number>;

  // --- Historique minimal (§31) --------------------------------------------
  readonly firstSeenAt: IsoDateTime;
  readonly lastSeenAt: IsoDateTime;
  readonly scrapedAt: IsoDateTime;
  readonly lifecycle: LifecycleStatus;
}

/** Alias lisible : ce que produit l'étage de normalisation. */
export type NormalizedListing = ListingOccurrence;

/**
 * Atout signalant un bail meublé ÉTUDIANT de neuf mois — septembre → juin — le
 * logement repassant en location saisonnière l'été.
 *
 * C'est à la fois une valeur d'affichage et un contrat entre trois étages : la
 * normalisation la pose dans `features`, le score de correspondance s'en sert
 * pour l'exclusion « locations étudiantes », et l'interface en fait un badge.
 * La déclarer ici évite que les trois divergent sur une chaîne recopiée.
 */
export const SHORT_TERM_LEASE_FEATURE = 'Bail 9 mois (sept.–juin)';

/**
 * Atout signalant un logement RÉSERVÉ aux étudiants — résidence étudiante,
 * bail étudiant, bail mobilité. Ce n'est pas un agrément mais une condition
 * d'accès, et souvent une durée qui s'arrête : elle doit se voir sur la carte,
 * que l'utilisateur exclue ou non ces locations (§17).
 */
export const STUDENT_HOUSING_FEATURE = 'Réservé aux étudiants';

// ---------------------------------------------------------------------------
// Étage 3 — logement unique, toutes sources confondues
// ---------------------------------------------------------------------------

/**
 * Un logement, vu comme une seule fiche par l'utilisateur (§13).
 *
 * Les champs sont des `MergedField` : ils portent la valeur retenue, la source
 * dont elle provient, et les éventuelles valeurs divergentes des autres sources.
 */
export interface AggregatedListing {
  /** Identifiant stable du groupe, dérivé de l'occurrence la plus ancienne. */
  readonly id: string;

  readonly title: MergedField<Maybe<string>>;
  readonly description: MergedField<Maybe<string>>;

  readonly price: MergedField<Maybe<number>>;
  readonly charges: MergedField<Maybe<number>>;
  readonly area: MergedField<Maybe<number>>;
  readonly rooms: MergedField<Maybe<number>>;
  readonly propertyType: MergedField<PropertyType>;
  readonly furnished: MergedField<Maybe<boolean>>;
  readonly flatShare: MergedField<Maybe<boolean>>;
  readonly dpe: MergedField<Maybe<string>>;
  /** Nombre maximal d'occupants annoncé, ou `null` (§17). */
  readonly maxOccupants: MergedField<Maybe<number>>;
  /** Union dédoublonnée des atouts de toutes les sources. */
  readonly features: readonly string[];

  readonly address: MergedField<Maybe<string>>;
  readonly district: MergedField<Maybe<string>>;
  readonly city: MergedField<Maybe<string>>;
  readonly postalCode: MergedField<Maybe<string>>;
  readonly latitude: MergedField<Maybe<number>>;
  readonly longitude: MergedField<Maybe<number>>;

  readonly contact: Contact;

  readonly publishedAt: MergedField<Maybe<IsoDateTime>>;
  readonly availableAt: MergedField<Maybe<IsoDateTime>>;

  readonly imageUrls: readonly string[];

  readonly views: MergedField<Maybe<number>>;
  readonly favorites: MergedField<Maybe<number>>;

  /**
   * Toutes les occurrences regroupées, avec leurs URLs d'origine (§13, §38).
   * Toujours au moins une entrée.
   */
  readonly occurrences: readonly ListingOccurrence[];

  readonly firstSeenAt: IsoDateTime;
  readonly lastSeenAt: IsoDateTime;
  readonly lifecycle: LifecycleStatus;
  readonly tracking: TrackingStatus;
}

// ---------------------------------------------------------------------------
// Étage 4 — logement scoré, prêt pour l'interface
// ---------------------------------------------------------------------------

/** Distance calculée vers un point de référence privé (§20). */
export interface ReferenceDistance {
  /** Libellé neutre affiché dans l'interface, ex. `Travail`, `Gare`. */
  readonly label: string;
  /**
   * Distance à vol d'oiseau en kilomètres. ABSENTE des données publiées vers
   * le cloud : couplée aux coordonnées de l'annonce, elle permettrait de
   * trilatérer le point de référence — donc de localiser l'utilisateur (§26).
   */
  readonly distanceKm?: number;
  /** Durée en minutes, selon le mode retenu. */
  readonly durationMinutes: number;
  /** Mode de déplacement utilisé pour l'estimation. */
  readonly mode: ReferenceTravelMode;
  /**
   * Origine de la durée (§17) : `transit` = itinéraire réel en transports en
   * commun (routeur externe) ; `estimate` = approximation vol d'oiseau × détour
   * ÷ vitesse moyenne. Absent → estimation, par compatibilité.
   */
  readonly durationSource?: 'transit' | 'estimate';
}

/** Le logement tel que l'interface le consomme. */
export interface ScoredListing extends AggregatedListing {
  readonly scores: ListingScores;
  /** Vide tant qu'aucun point de référence privé n'est configuré. */
  readonly distances: readonly ReferenceDistance[];
  /** `false` si l'annonce sort des critères de recherche actifs (§16). */
  readonly matchesCriteria: boolean;
  /**
   * `true` si le loyer d'au moins une source a baissé récemment (§17 : signal
   * d'opportunité — agir maintenant). Déduit de `listing_history`.
   */
  readonly priceDropped: boolean;
}
