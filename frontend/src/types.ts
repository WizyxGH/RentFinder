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
  readonly address: MergedField<string | null>;
  readonly city: MergedField<string | null>;
  readonly postalCode: MergedField<string | null>;
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
