/**
 * Modale « Trier et filtrer » (§36).
 *
 * Regroupe en un seul endroit ce qui était éparpillé en trois menus déroulants
 * de la barre d'outils : le tri, les options d'affichage et le filtre par
 * source. Sur mobile, trois menus côte à côte tenaient mal ; et rien n'indiquait
 * qu'ils formaient un même réglage.
 *
 * Accessibilité : `role="dialog"` + `aria-modal`, fermeture par Échap ou par le
 * fond, et le focus part sur le premier contrôle.
 */

import { useEffect, useRef } from 'react';
import type { SortMode } from '../types.js';
import { formatSourceName } from '../format.js';
import { Button } from '@/components/ui/button.js';

export interface SortFilterModalProps {
  readonly open: boolean;
  readonly onClose: () => void;

  readonly sort: SortMode;
  readonly onSortChange: (sort: SortMode) => void;
  readonly sortOptions: readonly { readonly value: SortMode; readonly label: string }[];

  /** Bascules d'affichage : libellé, état, setter. */
  readonly toggles: readonly (readonly [string, boolean, (value: boolean) => void])[];

  readonly sources: readonly string[];
  readonly selectedSources: ReadonlySet<string>;
  readonly onToggleSource: (sourceId: string) => void;
  readonly onClearSources: () => void;
}

export function SortFilterModal({
  open,
  onClose,
  sort,
  onSortChange,
  sortOptions,
  toggles,
  sources,
  selectedSources,
  onToggleSource,
  onClearSources,
}: SortFilterModalProps): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Le focus entre dans la modale, sinon la navigation au clavier resterait
    // derrière, sur la page.
    panel.current?.querySelector<HTMLElement>('button, input')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Trier et filtrer"
        // Le clic à l'intérieur ne doit pas fermer la modale.
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:max-w-md sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Trier et filtrer</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="cursor-pointer rounded-lg px-2 py-1 text-xl leading-none text-muted-foreground hover:bg-muted"
          >
            ×
          </button>
        </div>

        <fieldset className="mb-5">
          <legend className="mb-2 text-sm font-semibold text-muted-foreground">Trier par</legend>
          <ul className="flex flex-col gap-0.5">
            {sortOptions.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => onSortChange(option.value)}
                  aria-pressed={sort === option.value}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                    sort === option.value
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'hover:bg-muted'
                  }`}
                >
                  <span aria-hidden="true" className="w-4">
                    {sort === option.value ? '✓' : ''}
                  </span>
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset className="mb-5">
          <legend className="mb-2 text-sm font-semibold text-muted-foreground">Affichage</legend>
          <ul className="flex flex-col gap-0.5">
            {toggles.map(([label, checked, setter]) => (
              <li key={label}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => setter(event.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {sources.length > 1 && (
          <fieldset className="mb-5">
            <legend className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              Sources
              {selectedSources.size > 0 && (
                <button
                  type="button"
                  onClick={onClearSources}
                  className="cursor-pointer font-normal underline hover:text-foreground"
                >
                  tout afficher
                </button>
              )}
            </legend>
            <ul className="flex max-h-56 flex-col overflow-y-auto">
              {sources.map((sourceId) => (
                <li key={sourceId}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={selectedSources.has(sourceId)}
                      onChange={() => onToggleSource(sourceId)}
                    />
                    <span className="truncate">{formatSourceName(sourceId)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <Button className="w-full" onClick={onClose}>
          Voir les résultats
        </Button>
      </div>
    </div>
  );
}
