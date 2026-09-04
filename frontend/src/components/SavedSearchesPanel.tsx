/**
 * Recherches enregistrées.
 *
 * On règle sept champs, on trouve ce qu'on cherche, et le lendemain il faut
 * tout recommencer : rien ne gardait le jeu complet. Cette page le garde, et
 * le rappelle d'un geste.
 *
 * TOUT LE CYCLE VIT ICI. Enregistrer se faisait depuis la modale « Trier et
 * filtrer » — un troisième verbe dans un pied qui en portait déjà deux —, et
 * renommer ne se faisait nulle part : une recherche mal nommée se supprimait et
 * se refaisait. Créer, rappeler, renommer, supprimer sont maintenant au même
 * endroit, celui dont c'est le sujet.
 *
 * LA CARTE DIT D'ABORD CE QUI CHANGE. Le nom, puis le nombre d'annonces en
 * évidence — c'est lui qu'on parcourt pour savoir laquelle rouvrir —, puis les
 * critères en petit. L'ordre inverse obligeait à lire une ligne de réglages
 * pour retrouver une recherche qu'on reconnaît à son nom.
 */

import { useState } from 'react';
import { ArrowLeft, Pencil, Play, Plus, Search, Trash2 } from './icons.js';
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
  readonly onRename: (id: string, name: string) => void;
  /** Enregistre l'état courant de la recherche sous le nom donné. */
  readonly onSaveCurrent: (name: string) => void;
  /** Nom proposé pour l'état courant, calculé à partir des réglages actifs. */
  readonly suggestion: string;
  /**
   * `false` quand l'accès courant n'a pas de base où écrire (démo) : on
   * l'explique au lieu de proposer un bouton qui n'enregistrerait rien.
   */
  readonly available: boolean;
}

/**
 * Saisie d'un nom, en ligne. Le même geste sert à créer et à renommer : dans
 * les deux cas on part d'un nom déjà rempli, qu'il n'y a qu'à valider.
 */
function NameForm({
  initial,
  label,
  onConfirm,
  onCancel,
}: {
  readonly initial: string;
  readonly label: string;
  readonly onConfirm: (name: string) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex min-w-0 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed !== '') onConfirm(trimmed);
      }}
    >
      <input
        type="text"
        value={name}
        autoFocus
        aria-label={label}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        // 16 px sur mobile : en dessous, iOS zoome à la mise au point.
        className="min-w-0 flex-1 rounded-lg border border-border px-3 py-1.5 text-base sm:text-sm"
      />
      <Button size="sm" type="submit">
        Valider
      </Button>
      <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
        Annuler
      </Button>
    </form>
  );
}

export function SavedSearchesPanel({
  searches,
  nowMs,
  countFor,
  onBack,
  onApply,
  onDelete,
  onRename,
  onSaveCurrent,
  suggestion,
  available,
}: SavedSearchesPanelProps): React.JSX.Element {
  // Suppression en deux temps : une recherche patiemment réglée ne doit pas
  // disparaître sur un doigt qui glisse.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <header className="mb-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Retour
        </Button>
      </header>

      <h1 className="mb-4 text-xl font-bold">Recherches enregistrées</h1>

      {!available ? (
        <p className="text-muted-foreground">
          Cet accès n’a pas de base où conserver une recherche. Connectez-vous à vos données pour en
          enregistrer.
        </p>
      ) : (
        <>
          {/* CRÉER EST LA PREMIÈRE CHOSE QU'ON VOIT. La page servait à rappeler
            une recherche mais pas à en faire une : il fallait ressortir, régler
            la modale, et y trouver un bouton perdu entre deux autres. */}
          <div className="mb-4">
            {creating ? (
              <NameForm
                initial={suggestion}
                label="Nom de la recherche"
                onConfirm={(name) => {
                  onSaveCurrent(name);
                  setCreating(false);
                }}
                onCancel={() => setCreating(false)}
              />
            ) : (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" className="size-4" />
                Enregistrer la recherche actuelle
              </Button>
            )}
          </div>

          {searches.length === 0 ? (
            <Card className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center">
              <Search aria-hidden="true" className="size-6" />
              <p className="max-w-xs text-[0.92rem]">
                Aucune recherche enregistrée. Réglez vos filtres depuis la recherche, puis revenez
                ici pour garder ce jeu de critères.
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
                      style={
                        { '--rf-delay': `${Math.min(rank, 10) * 30}ms` } as React.CSSProperties
                      }
                    >
                      {renaming === search.id ? (
                        <NameForm
                          initial={search.name}
                          label={`Nouveau nom de « ${search.name} »`}
                          onConfirm={(name) => {
                            onRename(search.id, name);
                            setRenaming(null);
                          }}
                          onCancel={() => setRenaming(null)}
                        />
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <strong className="min-w-0 flex-1 truncate text-[1.05rem]">
                              {search.name}
                            </strong>
                            <span className="shrink-0 text-right">
                              <span className="block text-lg leading-none font-bold">{count}</span>
                              <span className="text-muted-foreground text-[0.7rem]">
                                annonce{count > 1 ? 's' : ''}
                              </span>
                            </span>
                          </div>
                          <p className="text-muted-foreground mt-1.5 text-[0.85rem]">
                            {describeSearch(search)}
                          </p>
                          <p className="text-muted-foreground mt-0.5 text-[0.78rem]">
                            Enregistrée {formatAge(search.createdAt, nowMs)}
                          </p>
                        </>
                      )}

                      <div className="mt-3 flex items-center gap-1">
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
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ml-auto"
                              aria-label={`Renommer « ${search.name} »`}
                              onClick={() => setRenaming(search.id)}
                            >
                              <Pencil aria-hidden="true" className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Supprimer « ${search.name} »`}
                              onClick={() => setConfirming(search.id)}
                            >
                              <Trash2 aria-hidden="true" className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
