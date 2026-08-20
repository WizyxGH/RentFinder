/**
 * Filtre de la liste par source, en menu déroulant (§13, §36).
 *
 * Cases à cocher (une par agence/site présent dans les résultats).
 * Multi-sélection : ensemble vide = toutes les sources.
 */

import { formatSourceName } from '../format.js';
import { Dropdown } from './Dropdown.js';

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
  return (
    <Dropdown label="Sources" badge={selected.size}>
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
      {selected.size > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-[0.85rem] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Tout afficher
        </button>
      )}
    </Dropdown>
  );
}
