/**
 * Types de l'interface.
 *
 * Ils décrivent exactement ce que l'API renvoie. Les champs fusionnés
 * conservent leur provenance et leurs conflits, afin que l'interface puisse
 * signaler « SeLoger annonce 690 €, Bien'ici annonce 715 € » plutôt que de
 * masquer le désaccord (§15).
 */

import type {
  Contact,
  ListingScores,
  MergedField,
  PropertyType,
  ReferenceDistance,
  TrackingStatus,
} from '@rentfinder/shared';

export type {
  TrackingStatus,
  ListingScores,
  ReferenceDistance,
  Contact,
  MergedField,
  PropertyType,
};

/** Occurrence telle que l'API la résume : de quoi ouvrir l'annonce d'origine (§38). */
export interface OccurrenceView {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceUrl: string;
  readonly price: number | null;
  readonly area: number | null;
  readonly lastSeenAt: string;
}

/** Une fiche de logement, telle qu'affichée. */
export interface ListingView {
  readonly id: string;
  readonly title: MergedField<string | null>;
  readonly description: MergedField<string | null>;
  readonly price: MergedField<number | null>;
  readonly charges: MergedField<number | null>;
  readonly area: MergedField<number | null>;
  readonly rooms: MergedField<number | null>;
  readonly propertyType: MergedField<PropertyType>;
  readonly furnished: MergedField<boolean | null>;
  /** Colocation — absent sur les fiches écrites avant l'ajout du champ. */
  readonly flatShare?: MergedField<boolean | null>;
  /** Classe énergétique (DPE) — absent sur les fiches anciennes. */
  readonly dpe?: MergedField<string | null>;
  /** Atouts affichables (« Ascenseur », « Balcon »…) — absent sur les fiches anciennes. */
  readonly features?: readonly string[];
  readonly address: MergedField<string | null>;
  /** Quartier/secteur si publié (ex. Orpi « Madeleine ») — situe mieux que la ville. */
  readonly district: MergedField<string | null>;
  readonly city: MergedField<string | null>;
  readonly postalCode: MergedField<string | null>;
  /** Coordonnées (source ou géocodage) — absentes si non localisable. */
  readonly latitude?: MergedField<number | null>;
  readonly longitude?: MergedField<number | null>;
  readonly publishedAt: MergedField<string | null>;
  readonly availableAt: MergedField<string | null>;
  readonly views: MergedField<number | null>;
  readonly favorites: MergedField<number | null>;
  readonly contact: Contact;
  readonly imageUrls: readonly string[];
  readonly scores: ListingScores;
  readonly distances: readonly ReferenceDistance[];
  readonly occurrences: readonly OccurrenceView[];
  readonly matchesCriteria: boolean;
  /** `true` si le loyer a récemment baissé (§17) — mis en avant dans l'UI. */
  readonly priceDropped?: boolean;
  /** `true` dès que la fiche a été ouverte au moins une fois (posé automatiquement). */
  readonly viewed?: boolean;
  /** `true` si l'utilisateur a archivé l'annonce (retirée de la liste par défaut). */
  readonly archived?: boolean;
  /** `true` si l'utilisateur a mis l'annonce en favori. */
  readonly favorite?: boolean;
  /** `true` si la source affiche le bien comme DÉJÀ LOUÉ (§32, §33). */
  readonly rented?: boolean;
  readonly actionPriority: number;
  readonly tracking: TrackingStatus;
  readonly lifecycle: 'active' | 'possiblyInactive' | 'inactive';
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

export interface ListingsResponse {
  readonly listings: readonly ListingView[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** État d'une source, pour la page d'observabilité (§63). */
export interface SourceStateView {
  readonly sourceId: string;
  readonly health: 'healthy' | 'degraded' | 'cooldown' | 'disabled' | 'blocked';
  readonly lastRunAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly last429At: string | null;
  readonly cooldownUntil: string | null;
  readonly consecutiveErrors: number;
  readonly averageNewListingCount: number;
}

export type SortMode = 'priority' | 'recent' | 'price';

/** Un point de l'historique de l'inventaire (§33). */
export interface DailyStat {
  readonly day: string;
  readonly matching: number;
  readonly uncertain: number;
  readonly rented: number;
  readonly total: number;
  readonly activeSources: number;
}

/** Statistiques de suivi (§33). */
export interface StatsData {
  /** Évolution jour par jour — absente des API anciennes. */
  readonly history?: readonly DailyStat[];
  readonly listings: {
    readonly total: number;
    /** Annonces dans les critères et ENCORE ACTIVES : le vrai gisement. */
    readonly matching: number;
    /**
     * Dans les critères mais disparues de leur source depuis plusieurs
     * collectes — affichées et consultables, mais à vérifier (§33).
     */
    readonly uncertain?: number;
    readonly active: number;
    readonly viewed: number;
    readonly archived: number;
    /** Biens dans les critères repérés comme LOUÉS (§33). */
    readonly rented?: number;
  };
  readonly byTracking: Readonly<Record<string, number>>;
  readonly bySource: Readonly<Record<string, number>>;
  readonly contacts: {
    readonly total: number;
    readonly byOutcome: Readonly<Record<string, number>>;
  };
}

/** Filtres de recherche éditables depuis l'interface (§66). */
export interface FilterConfig {
  cities: string[];
  maxPrice: number;
  minPrice?: number;
  minArea: number;
  /** Durée maximale du trajet domicile→travail, en minutes (§20). */
  maxCommuteMinutes?: number;
  excludeFlatShare?: boolean;
  excludeStudent?: boolean;
  /** Nature du bailleur : tous, particuliers (hors agences), ou agences. */
  landlordFilter?: 'all' | 'private' | 'agency';
  /** Meublé : tous, meublés seulement, ou non meublés seulement. */
  furnishedFilter?: 'all' | 'furnished' | 'unfurnished';
}
