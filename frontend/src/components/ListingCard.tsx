/**
 * Carte d'annonce de la liste principale (§36).
 *
 * Elle doit répondre en un coup d'œil, sur téléphone, à « dois-je contacter
 * cette annonce maintenant ? ». Tout ce qui n'aide pas à cette décision est
 * renvoyé à la fiche détaillée.
 */

import type { ListingView } from '../types.js';
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
} from '../format.js';
import { ScoreRow } from './Scores.js';

interface ListingCardProps {
  readonly listing: ListingView;
  readonly nowMs: number;
  readonly onOpen: (id: string) => void;
}

export function ListingCard({ listing, nowMs, onOpen }: ListingCardProps): React.JSX.Element {
  const sourceCount = new Set(listing.occurrences.map((occurrence) => occurrence.sourceId)).size;
  const isHot = listing.actionPriority >= 85;
  const publishedAt = listing.publishedAt.value;

  return (
    <article className={`card${isHot ? ' card--hot' : ''}`} data-testid="listing-card">
      <header className="card__header">
        <div className="card__priority">
          {isHot && <span aria-hidden="true">🔥</span>}
          <span className="card__priority-value">{listing.actionPriority}</span>
        </div>

        <div className="card__identity">
          <h2 className="card__title">
            {formatPropertyType(listing.propertyType.value)} · {formatCity(listing.city.value)}
          </h2>
          <p className="card__facts">
            <strong>{formatPrice(listing.price.value)}</strong>
            <span aria-hidden="true"> · </span>
            {formatArea(listing.area.value)}
            <span aria-hidden="true"> · </span>
            {formatRooms(listing.rooms.value)}
          </p>
        </div>

        {listing.tracking !== 'new' && (
          <span className="card__tracking">{formatTracking(listing.tracking)}</span>
        )}
      </header>

      <ScoreRow scores={listing.scores} />

      <p className="card__age">
        {publishedAt === null
          ? `Découverte ${formatAge(listing.firstSeenAt, nowMs)}`
          : `Publiée ${formatAge(publishedAt, nowMs)}`}
      </p>

      {/* §20 : les distances n'apparaissent que si des points de référence
          privés sont configurés — le libellé reste neutre. */}
      {listing.distances.length > 0 && (
        <ul className="card__distances">
          {listing.distances.map((distance) => (
            <li key={distance.label}>
              {distance.label} : {formatDuration(distance.durationMinutes)}
            </li>
          ))}
        </ul>
      )}

      {/* §13, §38 : montrer d'où vient l'annonce et combien de fois elle circule. */}
      <p className="card__sources">
        {sourceCount === 1 ? '1 source' : `${sourceCount} sources`}
        <span className="card__sources-list">
          {' '}
          ·{' '}
          {[...new Set(listing.occurrences.map((occurrence) => occurrence.sourceId))]
            .map(formatSourceName)
            .join(', ')}
        </span>
      </p>

      <div className="card__actions">
        <button type="button" className="btn btn--secondary" onClick={() => onOpen(listing.id)}>
          Voir
        </button>
        <button type="button" className="btn btn--primary" onClick={() => onOpen(listing.id)}>
          Contacter
        </button>
      </div>
    </article>
  );
}
