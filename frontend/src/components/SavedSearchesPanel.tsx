/**
 * Recherches enregistrées.
 *
 * On règle sept champs, on trouve ce qu'on cherche, et le lendemain il faut
 * tout recommencer : rien ne gardait le jeu complet. Cette page le garde, et
 * le rappelle d'un geste.
 *
 * CE QU'ELLE DIT FRANCHEMENT : une recherche enregistrée est un signet, pas un
 * abonnement. Seuls les critères ACTIFS déterminent ce que la collecte ramène
 * et signale ; garder « 2 pièces avec parking » ici n'y ajoute aucune alerte.
 * Le taire aurait laissé attendre des notifications qui ne viendraient jamais.
 */

import { useState } from 'react';
import { ArrowLeft, Play, Search, Trash2 } from 'lucide-react';
import type { SavedSearch } from '../saved-searches.js';
import { describeSearch } from '../saved-searches.js';
import { formatAge } from '../format.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';

interface SavedSearchesPanelProps {
  readonly searches: readonly SavedSearch[];
  readonly nowMs: number;
  /** Nombre d'annonces chargées que chaque recherche laisserait passer. */
  readonly countFor: (search: SavedSearch) => number;
  readonly onBack: () => void;
  readonly onApply: (search: SavedSearch) => void;
  readonly onDelete: (id: string) => void;
  /**
   * `false` quand l'accès courant n'a pas de base où écrire (démo, mode API) :
   * on l'explique au lieu de proposer un bouton qui n'enregistrerait rien.
   */
  readonly available: boolean;
}

export function SavedSearchesPanel({
  searches,
  nowMs,
  countFor,
  onBack,
  onApply,
  onDelete,
  available,
}: SavedSearchesPanelProps): React.JSX.Element {
  // Suppression en deux temps : une recherche patiemment réglée ne doit pas
  // disparaître sur un doigt qui glisse.
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div>
      <header className="mb-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Retour
        </Button>
      </header>

      <h1 className="mb-1 text-xl font-bold">Recherches enregistrées</h1>
      <p className="text-muted-foreground mb-4 text-[0.92rem]">
        Un jeu de critères qu’on rappelle d’un geste. Ce sont des signets&nbsp;: les alertes, elles,
        suivent toujours vos critères actifs.
      </p>

      {!available ? (
        <p className="text-muted-foreground">
          Cet accès n’a pas de base où conserver une recherche. Connectez-vous à vos données pour en
          enregistrer.
        </p>
      ) : searches.length === 0 ? (
        <Card className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center">
          <Search aria-hidden="true" className="size-6" />
          <p className="max-w-xs text-[0.92rem]">
            Aucune recherche enregistrée. Réglez vos critères depuis la recherche, puis
            «&nbsp;Enregistrer cette recherche&nbsp;».
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {searches.map((search, rank) => {
            const count = countFor(search);
            return (
              <li key={search.id}>
                <Card
                  className="rf-rise"
                  style={{ '--rf-delay': `${Math.min(rank, 10) * 30}ms` } as React.CSSProperties}
                >
                  <div className="flex items-start gap-3">
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate">{search.name}</strong>
                      <span className="text-muted-foreground block text-[0.85rem]">
                        {describeSearch(search)}
                      </span>
                      <span className="text-muted-foreground block text-[0.8rem]">
                        {count} annonce{count > 1 ? 's' : ''} en ce moment · enregistrée{' '}
                        {formatAge(search.createdAt, nowMs)}
                      </span>
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" onClick={() => onApply(search)}>
                      <Play aria-hidden="true" className="size-4" /> Lancer
                    </Button>
                    {confirming === search.id ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            onDelete(search.id);
                            setConfirming(null);
                          }}
                        >
                          Confirmer
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                          Annuler
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        aria-label={`Supprimer « ${search.name} »`}
                        onClick={() => setConfirming(search.id)}
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
