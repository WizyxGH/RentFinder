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
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';

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
    <Card className={isHot ? 'border-2 border-hot' : undefined} data-testid="listing-card">
      <header className="flex items-start gap-2.5">
        <div className="flex min-w-11 flex-col items-center">
          {isHot && <span aria-hidden="true">🔥</span>}
          <span className="text-2xl leading-none font-bold">{listing.actionPriority}</span>
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">
            {formatPropertyType(listing.propertyType.value)} · {formatCity(listing.city.value)}
          </h2>
          <p className="mt-0.5 text-[0.95rem]">
            <strong>{formatPrice(listing.price.value)}</strong>
            <span aria-hidden="true"> · </span>
            {formatArea(listing.area.value)}
            <span aria-hidden="true"> · </span>
            {formatRooms(listing.rooms.value)}
          </p>
        </div>

        <span className="flex flex-col items-end gap-1">
          {listing.tracking !== 'new' && <Badge>{formatTracking(listing.tracking)}</Badge>}
          {listing.flatShare?.value === true && <Badge variant="warning">Colocation</Badge>}
        </span>
      </header>

      <ScoreRow scores={listing.scores} />

      <p className="mt-2 text-[0.85rem] text-muted-foreground">
        {publishedAt === null
          ? `Découverte ${formatAge(listing.firstSeenAt, nowMs)}`
          : `Publiée ${formatAge(publishedAt, nowMs)}`}
      </p>

      {/* §20 : les distances n'apparaissent que si des points de référence
          privés sont configurés — le libellé reste neutre. */}
      {listing.distances.length > 0 && (
        <ul className="mt-1.5 flex gap-3 text-[0.85rem] text-muted-foreground">
          {listing.distances.map((distance) => (
            <li key={distance.label}>
              {distance.label} : {formatDuration(distance.durationMinutes)}
            </li>
          ))}
        </ul>
      )}

      {/* §13, §38 : montrer d'où vient l'annonce et combien de fois elle circule. */}
      <p className="mt-2 text-[0.85rem] text-muted-foreground">
        {sourceCount === 1 ? '1 source' : `${sourceCount} sources`}
        <span>
          {' '}
          ·{' '}
          {[...new Set(listing.occurrences.map((occurrence) => occurrence.sourceId))]
            .map(formatSourceName)
            .join(', ')}
        </span>
      </p>

      <div className="mt-3 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => onOpen(listing.id)}>
          Voir
        </Button>
        <Button className="flex-1" onClick={() => onOpen(listing.id)}>
          Contacter
        </Button>
      </div>
    </Card>
  );
}
