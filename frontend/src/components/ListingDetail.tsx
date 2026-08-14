/**
 * Fiche détaillée d'une annonce (§37, §38).
 *
 * Elle doit permettre d'AGIR vite : les coordonnées et le message sont en haut,
 * le détail des scores et l'historique en dessous.
 */

import type { TenantProfile } from '@rentfinder/shared';
import type { ListingView, TrackingStatus } from '../types.js';
import {
  formatAge,
  formatArea,
  formatCity,
  formatDuration,
  formatPrice,
  formatPropertyType,
  formatRooms,
  formatSourceName,
  formatTracking,
  TRACKING_ORDER,
  UNKNOWN,
} from '../format.js';
import { ScoreDetail } from './Scores.js';
import { ContactPanel } from './ContactPanel.js';

interface ListingDetailProps {
  readonly listing: ListingView;
  readonly profile: TenantProfile | null;
  readonly nowMs: number;
  readonly onBack: () => void;
  readonly onTrackingChange: (status: TrackingStatus) => void;
  readonly onContactRecorded: (channel: string, message: string) => void;
  readonly onConfigureProfile: () => void;
}

/** Affiche une valeur divergente entre sources plutôt que de la masquer (§15). */
function ConflictNote({
  conflicts,
  render,
}: {
  readonly conflicts: readonly { value: unknown; sourceId: string }[];
  readonly render: (value: unknown) => string;
}): React.JSX.Element | null {
  if (conflicts.length === 0) return null;
  return (
    <span className="conflict-note" title="Les sources ne s’accordent pas sur cette valeur">
      {' '}
      (
      {conflicts.map((conflict, index) => (
        <span key={`${conflict.sourceId}-${index}`}>
          {index > 0 && ', '}
          {render(conflict.value)} selon {formatSourceName(conflict.sourceId)}
        </span>
      ))}
      )
    </span>
  );
}

export function ListingDetail({
  listing,
  profile,
  nowMs,
  onBack,
  onTrackingChange,
  onContactRecorded,
  onConfigureProfile,
}: ListingDetailProps): React.JSX.Element {
  const charges = listing.charges.value;

  return (
    <div className="detail">
      <header className="detail__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← Retour
        </button>
        {!listing.matchesCriteria && (
          <span className="detail__badge">Hors critères de recherche</span>
        )}
      </header>

      <h1 className="detail__title">{listing.title.value ?? 'Annonce sans titre'}</h1>

      <p className="detail__summary">
        <strong>{formatPrice(listing.price.value)}</strong>
        <ConflictNote
          conflicts={listing.price.conflicts}
          render={(value) => formatPrice(value as number | null)}
        />
        {charges !== null && <span className="detail__charges"> + {charges} € de charges</span>}
        <span aria-hidden="true"> · </span>
        {formatArea(listing.area.value)}
        <ConflictNote
          conflicts={listing.area.conflicts}
          render={(value) => formatArea(value as number | null)}
        />
        <span aria-hidden="true"> · </span>
        {formatRooms(listing.rooms.value)}
      </p>

      <dl className="detail__facts">
        <dt>Type</dt>
        <dd>{formatPropertyType(listing.propertyType.value)}</dd>

        <dt>Meublé</dt>
        <dd>
          {listing.furnished.value === null ? UNKNOWN : listing.furnished.value ? 'Oui' : 'Non'}
        </dd>

        <dt>Localisation</dt>
        <dd>
          {formatCity(listing.city.value)}
          {listing.postalCode.value !== null && ` (${listing.postalCode.value})`}
          {listing.address.value !== null && ` — ${listing.address.value}`}
        </dd>

        <dt>Publiée</dt>
        <dd>{formatAge(listing.publishedAt.value, nowMs)}</dd>

        <dt>Disponible</dt>
        <dd>
          {listing.availableAt.value === null
            ? UNKNOWN
            : new Date(listing.availableAt.value).toLocaleDateString('fr-FR')}
        </dd>

        <dt>Vue pour la première fois</dt>
        <dd>{formatAge(listing.firstSeenAt, nowMs)}</dd>
      </dl>

      {/* §20 : distances vers des points de référence privés, libellés neutres. */}
      {listing.distances.length > 0 && (
        <ul className="detail__distances">
          {listing.distances.map((distance) => (
            <li key={distance.label}>
              <strong>{distance.label}</strong> : {formatDuration(distance.durationMinutes)}{' '}
              <span className="detail__distance-km">({distance.distanceKm} km à vol d’oiseau)</span>
            </li>
          ))}
        </ul>
      )}

      {/* §22 : préparation du contact, en haut de page car c'est l'action utile. */}
      <ContactPanel
        listing={listing}
        profile={profile}
        onRecorded={onContactRecorded}
        onConfigureProfile={onConfigureProfile}
      />

      {/* §35 : suivi du statut. */}
      <section className="detail__tracking">
        <label htmlFor="tracking-select">Statut</label>
        <select
          id="tracking-select"
          value={listing.tracking}
          onChange={(event) => onTrackingChange(event.target.value as TrackingStatus)}
        >
          {TRACKING_ORDER.map((status) => (
            <option key={status} value={status}>
              {formatTracking(status)}
            </option>
          ))}
        </select>
      </section>

      {/* §38 : toutes les sources, avec leurs URLs d'origine. */}
      <section className="detail__sources">
        <h3>Cette annonce a été trouvée sur</h3>
        <ul>
          {listing.occurrences.map((occurrence) => (
            <li key={occurrence.id}>
              <a href={occurrence.sourceUrl} target="_blank" rel="noreferrer noopener">
                {formatSourceName(occurrence.sourceId)}
              </a>
              <span className="detail__source-facts">
                {' '}
                — {formatPrice(occurrence.price)}, {formatArea(occurrence.area)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {listing.description.value !== null && (
        <section className="detail__description">
          <h3>Description</h3>
          <p>{listing.description.value}</p>
        </section>
      )}

      <div className="detail__scores">
        <ScoreDetail title="Correspondance" score={listing.scores.match} />
        <ScoreDetail title="Opportunité" score={listing.scores.opportunity} />
        <ScoreDetail
          title="Probabilité de visite"
          score={listing.scores.visitProbability}
          caveat="Indice fondé sur des règles explicites, pas sur une statistique. Il sert à comparer les annonces entre elles, pas à prédire un pourcentage réel."
        />
        <ScoreDetail title="Risque" score={listing.scores.risk} invert />
      </div>
    </div>
  );
}
