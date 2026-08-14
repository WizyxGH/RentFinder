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

const HEALTH_LABELS: Record<SourceStateView['health'], string> = {
  healthy: 'OK',
  degraded: 'Dégradée',
  cooldown: 'En repos (429)',
  disabled: 'Désactivée',
  blocked: 'Bloquée',
};

interface SourcesPanelProps {
  readonly sources: readonly SourceStateView[];
  readonly nowMs: number;
  readonly onBack: () => void;
}

export function SourcesPanel({ sources, nowMs, onBack }: SourcesPanelProps): React.JSX.Element {
  return (
    <div className="sources">
      <header className="detail__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← Retour
        </button>
      </header>

      <h1>État des sources</h1>

      {sources.length === 0 ? (
        <p>Aucune source n’a encore été exécutée.</p>
      ) : (
        <ul className="sources__list">
          {sources.map((source) => (
            <li key={source.sourceId} className={`sources__item sources__item--${source.health}`}>
              <div className="sources__head">
                <strong>{formatSourceName(source.sourceId)}</strong>
                <span className="sources__health">{HEALTH_LABELS[source.health]}</span>
              </div>

              <dl className="sources__facts">
                <dt>Dernière exécution</dt>
                <dd>{formatAge(source.lastRunAt, nowMs)}</dd>

                <dt>Dernière réussite</dt>
                <dd>{formatAge(source.lastSuccessAt, nowMs)}</dd>

                <dt>Nouvelles annonces (moyenne)</dt>
                <dd>{source.averageNewListingCount.toFixed(1)}</dd>

                <dt>Erreurs consécutives</dt>
                <dd>{source.consecutiveErrors}</dd>
              </dl>

              {/* §10 : expliquer une mise au repos plutôt que de la subir. */}
              {source.cooldownUntil !== null && (
                <p className="sources__cooldown">
                  En repos après un HTTP 429 jusqu’à{' '}
                  {new Date(source.cooldownUntil).toLocaleTimeString('fr-FR')}. Aucune requête n’est
                  émise vers cette source d’ici là.
                </p>
              )}

              {source.health === 'blocked' && (
                <p className="sources__blocked">
                  Cette source refuse l’accès automatisé. Le scraper est arrêté et ne tentera aucun
                  contournement.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
