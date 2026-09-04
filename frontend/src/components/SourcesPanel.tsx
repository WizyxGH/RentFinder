/**
 * État des sources (§63).
 *
 * Petite page d'observabilité : elle répond à « pourquoi n'ai-je pas de
 * nouvelles annonces ? » sans avoir à ouvrir les logs GitHub Actions.
 *
 * Elle n'affiche que des métadonnées d'exécution — aucune donnée personnelle.
 */

import type { SourceStateView } from '../types.js';
import { formatAge, formatSourceName } from '../format.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { ArrowLeft } from 'lucide-react';

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

interface SourcesPanelProps {
  readonly sources: readonly SourceStateView[];
  readonly nowMs: number;
  readonly onBack: () => void;
  /** Ouvre la fiche d'une source : ses infos ET ses annonces actives. */
  readonly onOpenSource?: (sourceId: string) => void;
}

export function SourcesPanel({
  sources,
  nowMs,
  onBack,
  onOpenSource,
}: SourcesPanelProps): React.JSX.Element {
  return (
    <div>
      <header className="mb-2 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Retour
        </Button>
      </header>

      <h1 className="mb-3 text-xl font-bold">État des sources</h1>

      {sources.length === 0 ? (
        <p>Aucune source n’a encore été exécutée.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sources.map((source) => (
            <Card
              key={source.sourceId}
              // Rendue comme <li> sémantique via le wrapper : Card est un div,
              // on garde la liste pour les lecteurs d'écran.
              role="listitem"
              className={`border-l-4 ${HEALTH_BORDER[source.health]}`}
            >
              <div className="mb-2 flex justify-between">
                {/* Le nom mène au catalogue de la source. Le reste de la carte
                  reste inerte : on ne voulait pas qu'un clic sur un chiffre
                  d'observabilité fasse changer de page. */}
                {onOpenSource === undefined ? (
                  <strong>{formatSourceName(source.sourceId)}</strong>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenSource(source.sourceId)}
                    className="hover:text-primary cursor-pointer text-left font-bold transition-colors"
                  >
                    {formatSourceName(source.sourceId)}
                  </button>
                )}
                <span className="text-muted-foreground text-[0.8rem]">
                  {HEALTH_LABELS[source.health]}
                </span>
              </div>

              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[0.92rem]">
                <dt className="text-muted-foreground">Dernière exécution</dt>
                <dd>{formatAge(source.lastRunAt, nowMs)}</dd>

                <dt className="text-muted-foreground">Dernière réussite</dt>
                <dd>{formatAge(source.lastSuccessAt, nowMs)}</dd>

                <dt className="text-muted-foreground">Nouvelles annonces (moyenne)</dt>
                <dd>{source.averageNewListingCount.toFixed(1)}</dd>

                <dt className="text-muted-foreground">Erreurs consécutives</dt>
                <dd>{source.consecutiveErrors}</dd>
              </dl>

              {/* §10 : expliquer une mise au repos plutôt que de la subir. */}
              {source.cooldownUntil !== null && (
                <p className="mt-1 text-[0.85rem] text-muted-foreground">
                  En repos après un HTTP 429 jusqu’à{' '}
                  {new Date(source.cooldownUntil).toLocaleTimeString('fr-FR')}. Aucune requête n’est
                  émise vers cette source d’ici là.
                </p>
              )}

              {source.health === 'blocked' && (
                <p className="mt-1 text-[0.85rem] text-muted-foreground">
                  Cette source refuse l’accès automatisé. Le scraper est arrêté et ne tentera aucun
                  contournement.
                </p>
              )}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
