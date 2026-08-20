/**
 * Filtre de la liste par source, en menu déroulant (§13, §36).
 *
 * Un bouton ouvre un panneau de cases à cocher (une par agence/site présent
 * dans les résultats). Multi-sélection : ensemble vide = toutes les sources.
 * Se ferme au clic extérieur ou sur Échap.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { formatSourceName } from '../format.js';
import { Button } from '@/components/ui/button.js';

interface SourceFilterProps {
  readonly sources: readonly string[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (sourceId: string) => void;
  readonly onClear: () => void;
}

export function SourceFilter({
  sources,
  selected,
  onToggle,
  onClear,
}: SourceFilterProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Fermeture au clic extérieur et à la touche Échap.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const count = selected.size;
  const label = count === 0 ? 'Toutes les sources' : `${count} source${count > 1 ? 's' : ''}`;

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        Sources : {label} <span aria-hidden="true">▾</span>
      </Button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Filtrer par source"
          className="absolute left-0 z-20 mt-1 max-h-72 w-60 overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-lg"
        >
          <ul className="flex flex-col">
            {sources.map((sourceId) => (
              <li key={sourceId}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[0.9rem] hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={selected.has(sourceId)}
                    onChange={() => onToggle(sourceId)}
                  />
                  <span className="truncate">{formatSourceName(sourceId)}</span>
                </label>
              </li>
            ))}
          </ul>
          {count > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="mt-1 w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-[0.85rem] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Tout afficher
            </button>
          )}
        </div>
      )}
    </div>
  );
}
