/**
 * « Ce qui a changé depuis votre dernière visite ».
 *
 * Le site bouge sous les pieds de ses utilisateurs : un écran se déplace, un
 * bouton disparaît, un réglage apparaît. Ne rien dire laisse croire à une panne
 * — « je ne retrouve plus Enregistrer » se pense plus vite que « il a dû
 * bouger ».
 *
 * ELLE S'EFFACE D'UN GESTE, et n'attend rien de plus : ce n'est pas une étape à
 * franchir, c'est une information. Le fond, la croix et Échap la referment tous
 * les trois, et la lecture est enregistrée dans les trois cas — une modale qui
 * revient parce qu'on l'a fermée « du mauvais côté » est une punition.
 *
 * ELLE NE PARAÎT JAMAIS À UN NOUVEAU VENU : `unseenEntries` renvoie une liste
 * vide tant qu'aucun repère de lecture n'existe, et le premier parcours en pose
 * un en se terminant.
 */

import { useEffect, useRef } from 'react';
import { X } from './icons.js';
import type { ChangelogEntry } from '../changelog.js';
import { Button } from '@/components/ui/button.js';

interface ChangelogModalProps {
  readonly entries: readonly ChangelogEntry[];
  readonly onClose: () => void;
}

export function ChangelogModal({
  entries,
  onClose,
}: ChangelogModalProps): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  if (entries.length === 0) return null;

  return (
    <div
      // Le même plan que la modale de filtres : Leaflet monte ses contrôles
      // jusqu'à z-index 1000.
      className="rf-fade fixed inset-0 z-[2000] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        onClick={(event) => event.stopPropagation()}
        className="rf-rise border-border bg-card flex max-h-[85vh] w-full flex-col rounded-t-2xl border shadow-xl sm:max-w-md sm:rounded-2xl"
      >
        <div className="border-border flex items-center justify-between border-b px-5 py-3.5">
          <h2 id="changelog-title" className="text-lg font-semibold">
            Nouveautés
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Fermer"
            className="text-muted-foreground min-h-0 px-2"
          >
            <X aria-hidden="true" className="size-5" />
          </Button>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {entries.map((entry) => (
            <li key={entry.id} className="border-border border-b py-3 last:border-0">
              <h3 className="font-semibold">{entry.title}</h3>
              <p className="text-muted-foreground mt-1 text-[0.92rem]">{entry.body}</p>
            </li>
          ))}
        </ul>

        <div className="border-border border-t px-5 py-3">
          <Button className="w-full" onClick={onClose}>
            J’ai compris
          </Button>
        </div>
      </div>
    </div>
  );
}
