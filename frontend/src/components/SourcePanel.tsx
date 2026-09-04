/**
 * Fiche d'UNE source : ce qu'elle est, comment elle se porte, et tout ce
 * qu'elle propose aujourd'hui.
 *
 * L'état des sources répondait à « pourquoi n'ai-je pas de nouvelles
 * annonces ? ». Il ne répondait pas à « qu'est-ce que cette agence a, en ce
 * moment ? » — question qu'on se pose dès qu'une annonce plaît et qu'on veut
 * voir le reste du catalogue avant d'appeler. Les deux vivent maintenant au
 * même endroit : la santé en haut, les annonces actives en dessous.
 *
 * Aucune requête supplémentaire : les annonces sont déjà chargées, on ne fait
 * que retenir celles dont une occurrence vient de cette source (§30).
 */

import { useMemo } from 'react';
import type { ListingView, SourceStateView } from '../types.js';
import { formatAge, formatSourceName } from '../format.js';
import { ListingCard } from './ListingCard.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { ArrowLeft } from './icons.js';

const HEALTH_LABELS: Record<SourceStateView['health'], string> = {
  healthy: 'OK',
  degraded: 'Dégradée',
  cooldown: 'En repos (429)',
  disabled: 'Désactivée',
  blocked: 'Bloquée',
};

/** Liseré gauche selon la santé — littéraux complets pour le scanner Tailwind. */
const HEALTH_BORDER: Record<SourceStateView['health'], string> = {
  healthy: 'border-l-good',
  degraded: 'border-l-medium',
  cooldown: 'border-l-medium',
  disabled: 'border-l-bad',
  blocked: 'border-l-bad',
};

interface SourcePanelProps {
  readonly sourceId: string;
  /** État d'exécution, `null` si la source n'a encore jamais tourné. */
  readonly state: SourceStateView | null;
  /** Toutes les annonces chargées ; le filtrage par source se fait ici. */
  readonly listings: readonly ListingView[];
  readonly nowMs: number;
  readonly onBack: () => void;
  readonly onSelect: (id: string) => void;
  readonly onFavorite: (id: string, favorite: boolean) => void;
}

export function SourcePanel({
  sourceId,
  state,
  listings,
  nowMs,
  onBack,
  onSelect,
  onFavorite,
}: SourcePanelProps): React.JSX.Element {
  const name = formatSourceName(sourceId);

  // Les annonces de cette source, actives d'abord : une fiche « peut-être
  // retirée » a sa place ici — c'est justement le catalogue qu'on inspecte —
  // mais après ce qui est sûr. Une annonce LOUÉE, elle, n'est plus au
  // catalogue : elle sort (§32).
  const mine = useMemo(() => {
    const RANK: Record<string, number> = { active: 0, possiblyInactive: 1 };
    return listings
      .filter((listing) => listing.occurrences.some((one) => one.sourceId === sourceId))
      .filter((listing) => listing.rented !== true)
      .sort((a, b) => (RANK[a.lifecycle] ?? 2) - (RANK[b.lifecycle] ?? 2));
  }, [listings, sourceId]);

  const active = mine.filter((listing) => listing.lifecycle === 'active').length;

  /** Le lien d'origine le plus récent : la porte d'entrée du site de la source. */
  const anyUrl = mine
    .flatMap((listing) => listing.occurrences)
    .find((one) => one.sourceId === sourceId)?.sourceUrl;
  let homepage: string | null = null;
  try {
    homepage = anyUrl === undefined ? null : new URL(anyUrl).origin;
  } catch {
    homepage = null;
  }

  return (
    <div>
      <header className="mb-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Retour
        </Button>
      </header>

      <h1 className="mb-1 text-xl font-bold">{name}</h1>
      <p className="text-muted-foreground mb-3 text-[0.92rem]">
        {active} annonce{active > 1 ? 's' : ''} active{active > 1 ? 's' : ''}
        {mine.length > active && ` · ${mine.length - active} incertaine(s)`}
        {homepage !== null && (
          <>
            {' · '}
            <a
              href={homepage}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline"
            >
              site
            </a>
          </>
        )}
      </p>

      {state !== null && (
        <Card className={`mb-4 border-l-4 ${HEALTH_BORDER[state.health]}`}>
          <div className="mb-2 flex justify-between">
            <strong>Collecte</strong>
            <span className="text-muted-foreground text-[0.8rem]">
              {HEALTH_LABELS[state.health]}
            </span>
          </div>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[0.92rem]">
            <dt className="text-muted-foreground">Dernière exécution</dt>
            <dd>{formatAge(state.lastRunAt, nowMs)}</dd>

            <dt className="text-muted-foreground">Dernière réussite</dt>
            <dd>{formatAge(state.lastSuccessAt, nowMs)}</dd>

            <dt className="text-muted-foreground">Nouvelles annonces (moyenne)</dt>
            <dd>{state.averageNewListingCount.toFixed(1)}</dd>

            <dt className="text-muted-foreground">Erreurs consécutives</dt>
            <dd>{state.consecutiveErrors}</dd>
          </dl>
        </Card>
      )}

      {mine.length === 0 ? (
        <p className="text-muted-foreground">
          Aucune annonce de cette source n’est active en ce moment.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mine.map((listing, rank) => (
            <li key={listing.id}>
              <ListingCard
                listing={listing}
                nowMs={nowMs}
                rank={rank}
                onOpen={onSelect}
                onFavorite={(favorite) => onFavorite(listing.id, favorite)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
