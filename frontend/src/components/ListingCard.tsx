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
import { AFFINITY_BADGE_THRESHOLD } from '../affinity.js';
import { ScoreRow } from './Scores.js';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';

interface ListingCardProps {
  readonly listing: ListingView;
  readonly nowMs: number;
  readonly onOpen: (id: string) => void;
  /** Archive (`true`) ou désarchive (`false`) l'annonce. */
  readonly onArchive?: (archived: boolean) => void;
  /** Met (`true`) ou retire (`false`) l'annonce des favoris. */
  readonly onFavorite?: (favorite: boolean) => void;
  /** Score d'affinité [0,1] avec vos préférences, si assez de signal (§33). */
  readonly affinity?: number;
}

/**
 * Palier de priorité → couleur, pour que le classement se lise sans réfléchir.
 * Les classes sont écrites en toutes lettres : Tailwind ne génère que les noms
 * de classe qu'il voit littéralement dans le source (pas d'interpolation).
 */
function priorityTier(priority: number): { className: string; label: string } {
  if (priority >= 85) return { className: 'text-hot bg-hot/10', label: 'à contacter' };
  if (priority >= 70) return { className: 'text-good bg-good/10', label: 'à voir' };
  return { className: 'text-muted-foreground bg-muted-foreground/10', label: 'priorité' };
}

export function ListingCard({
  listing,
  nowMs,
  onOpen,
  onArchive,
  onFavorite,
  affinity,
}: ListingCardProps): React.JSX.Element {
  const sources = [...new Set(listing.occurrences.map((occurrence) => occurrence.sourceId))];
  const isHot = listing.actionPriority >= 85;
  const archived = listing.archived === true;
  const favorite = listing.favorite === true;
  const tier = priorityTier(listing.actionPriority);
  const publishedAt = listing.publishedAt.value;
  const neighborhood = listing.address.value;

  // Atouts compacts pour la carte : DPE puis les premiers atouts, sans saturer.
  const dpe = listing.dpe?.value ?? null;
  const chips = [...(dpe !== null ? [`DPE ${dpe}`] : []), ...(listing.features ?? []).slice(0, 3)];

  return (
    <Card
      className={`transition-shadow hover:shadow-md ${isHot ? 'border-2 border-hot' : ''} ${
        archived ? 'opacity-60' : ''
      }`}
      data-testid="listing-card"
    >
      <header className="flex items-start gap-3">
        {/* Indicateur de priorité : pastille teintée par palier (§36 : tri par action). */}
        <div
          className={`flex w-14 shrink-0 flex-col items-center rounded-lg py-1.5 ${tier.className}`}
        >
          <span className="text-[1.6rem] leading-none font-bold">{listing.actionPriority}</span>
          <span className="mt-0.5 text-center text-[0.6rem] leading-tight tracking-wide uppercase">
            {isHot && <span aria-hidden="true">🔥 </span>}
            {tier.label}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">
            {formatPropertyType(listing.propertyType.value)} · {formatCity(listing.city.value)}
          </h2>
          {neighborhood !== null && (
            <p className="truncate text-[0.8rem] text-muted-foreground">{neighborhood}</p>
          )}
          <p className="mt-1 flex items-baseline gap-1.5">
            <strong className="text-lg font-bold">{formatPrice(listing.price.value)}</strong>
            <span className="text-[0.9rem] text-muted-foreground">
              {formatArea(listing.area.value)} · {formatRooms(listing.rooms.value)}
            </span>
          </p>
        </div>

        <span className="flex shrink-0 flex-col items-end gap-1">
          {onFavorite !== undefined && (
            <button
              type="button"
              onClick={() => onFavorite(!favorite)}
              title={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              aria-label={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              aria-pressed={favorite}
              className={`-mt-1 cursor-pointer text-xl leading-none transition-colors ${
                favorite ? 'text-hot' : 'text-muted-foreground hover:text-hot'
              }`}
            >
              {favorite ? '★' : '☆'}
            </button>
          )}
          {archived && <Badge variant="warning">Archivée</Badge>}
          {affinity !== undefined && affinity >= AFFINITY_BADGE_THRESHOLD && !archived && (
            <Badge variant="good">Vos préférences</Badge>
          )}
          {listing.viewed === true && !archived && <Badge>Consultée</Badge>}
          {listing.tracking !== 'new' && <Badge>{formatTracking(listing.tracking)}</Badge>}
          {listing.priceDropped === true && <Badge variant="good">Prix en baisse</Badge>}
          {listing.flatShare?.value === true && <Badge variant="warning">Colocation</Badge>}
        </span>
      </header>

      <ScoreRow scores={listing.scores} />

      {/* Atouts : DPE + premières caractéristiques, uniquement si publiés (§17). */}
      {chips.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-border px-2 py-0.5 text-[0.75rem] text-muted-foreground"
            >
              {chip}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.85rem] text-muted-foreground">
        <span>
          {publishedAt === null
            ? `Découverte ${formatAge(listing.firstSeenAt, nowMs)}`
            : `Publiée ${formatAge(publishedAt, nowMs)}`}
        </span>
        {/* §20 : distances vers des points de référence privés, libellés neutres. */}
        {listing.distances.map((distance) => (
          <span key={distance.label} className="text-foreground">
            <span className="text-muted-foreground">{distance.label} </span>
            {formatDuration(distance.durationMinutes)}
          </span>
        ))}
      </div>

      {/* §13, §38 : d'où vient l'annonce et combien de fois elle circule. */}
      <p className="mt-1 text-[0.85rem] text-muted-foreground">
        {sources.length === 1 ? '1 source' : `${sources.length} sources`} ·{' '}
        {sources.map(formatSourceName).join(', ')}
      </p>

      <div className="mt-3 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => onOpen(listing.id)}>
          Voir
        </Button>
        <Button className="flex-1" onClick={() => onOpen(listing.id)}>
          Contacter
        </Button>
        {onArchive !== undefined && (
          <Button
            variant="ghost"
            onClick={() => onArchive(!archived)}
            title={archived ? 'Désarchiver' : 'Archiver'}
            aria-label={archived ? 'Désarchiver' : 'Archiver'}
          >
            {archived ? '↩' : '🗄'}
          </Button>
        )}
      </div>
    </Card>
  );
}
