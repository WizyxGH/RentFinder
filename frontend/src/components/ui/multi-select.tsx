/**
 * Menu déroulant à choix MULTIPLES, avec recherche facultative.
 *
 * POURQUOI IL EXISTE. Deux réglages de la modale de filtres étaient des listes
 * dépliées en permanence : les quatre bascules d'affichage, et surtout les
 * cinquante sources. À elles seules, celles-ci occupaient plus de place que
 * tout le reste, et l'on faisait défiler une demi-page pour atteindre le bouton
 * qui compte. Replié, chacun de ces blocs tient sur une ligne et dit ce qu'il
 * contient.
 *
 * SANS NOUVELLE DÉPENDANCE. shadcn/ui construit ce contrôle sur Radix et cmdk ;
 * ce projet n'en a aucun des deux, et les ajouter pour un seul écran coûterait
 * plus cher à maintenir que ces cent lignes. On en reprend donc l'apparence et
 * le comportement — déclencheur qui résume la sélection, panneau flottant,
 * champ de recherche, lignes cochables — avec des éléments natifs : ce sont eux
 * que le projet privilégie partout ailleurs (§39, §65).
 *
 * CE QU'IL FAUT POUR QUE CE SOIT UTILISABLE, et qu'un panneau bricolé oublie
 * presque toujours : Échap referme, un clic à l'extérieur referme, le champ de
 * recherche reçoit le focus à l'ouverture, et le déclencheur porte
 * `aria-expanded`. Le panneau lui-même est une liste de cases à cocher : la
 * navigation au clavier vient alors du navigateur, sans code.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from '../icons.js';

export interface MultiSelectOption {
  readonly value: string;
  readonly label: string;
}

export interface MultiSelectProps {
  /** Intitulé du réglage, affiché sur le déclencheur. */
  readonly label: string;
  readonly options: readonly MultiSelectOption[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (value: string) => void;
  /** Remet la sélection à zéro. Absent : pas de bouton « tout ». */
  readonly onClear?: () => void;
  /** Ajoute un champ de recherche. À réserver aux longues listes. */
  readonly searchable?: boolean;
  /** Ce qu'affiche le déclencheur quand rien n'est sélectionné. */
  readonly emptyLabel: string;
  /** Ce qu'affiche le déclencheur pour n éléments. Défaut : « n sélectionnés ». */
  readonly summarize?: (count: number) => string;
}

/** Compare sans accents ni casse : « Bien'ici » se trouve en tapant « bienici ». */
function comparable(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function MultiSelect({
  label,
  options,
  selected,
  onToggle,
  onClear,
  searchable = false,
  emptyLabel,
  summarize,
}: MultiSelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const panelId = useId();

  // Échap et clic extérieur. Les deux écouteurs ne vivent QUE pendant
  // l'ouverture : un panneau fermé n'a aucune raison d'écouter le document.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  useEffect(() => {
    if (open && searchable) search.current?.focus();
  }, [open, searchable]);

  const needle = comparable(query).trim();
  const shown =
    needle === ''
      ? options
      : options.filter(
          (option) =>
            comparable(option.label).includes(needle) || comparable(option.value).includes(needle),
        );

  const count = selected.size;
  const summary =
    count === 0
      ? emptyLabel
      : count === 1
        ? (options.find((option) => selected.has(option.value))?.label ?? emptyLabel)
        : (summarize?.(count) ?? `${count} sélectionnés`);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="border-input bg-card hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
      >
        <span className="text-muted-foreground shrink-0">{label}</span>
        <span className="min-w-0 flex-1 truncate text-right font-medium">{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className={`text-muted-foreground size-4 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          id={panelId}
          className="border-border bg-card absolute z-10 mt-1 w-full rounded-lg border p-1 shadow-lg"
        >
          {searchable && (
            <input
              ref={search}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher…"
              aria-label={`Rechercher dans ${label}`}
              className="border-border mb-1 w-full rounded-md border px-2 py-1.5 text-sm"
            />
          )}

          <ul className="flex max-h-60 flex-col overflow-y-auto">
            {shown.length === 0 && (
              <li className="text-muted-foreground px-2 py-2 text-sm">Aucun résultat.</li>
            )}
            {shown.map((option) => {
              const checked = selected.has(option.value);
              return (
                <li key={option.value}>
                  <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(option.value)}
                      className="size-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {checked && (
                      <Check aria-hidden="true" className="text-primary size-4 shrink-0" />
                    )}
                  </label>
                </li>
              );
            })}
          </ul>

          {onClear !== undefined && count > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-muted-foreground hover:text-foreground border-border mt-1 w-full cursor-pointer border-t px-2 py-1.5 text-left text-sm"
            >
              Tout désélectionner
            </button>
          )}
        </div>
      )}
    </div>
  );
}
