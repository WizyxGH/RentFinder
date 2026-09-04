/**
 * Modale « Trier et filtrer » (§36).
 *
 * Regroupe en un seul endroit ce qui était éparpillé en trois menus déroulants
 * de la barre d'outils : le tri, les options d'affichage et le filtre par
 * source. Sur mobile, trois menus côte à côte tenaient mal ; et rien n'indiquait
 * qu'ils formaient un même réglage.
 *
 * S'y ajoutent, repliés en bas, les CRITÈRES DE RECHERCHE — ce qui est collecté
 * et signalé. Ils vivaient dans un onglet « Alertes » à part, où on ne les
 * trouvait pas : quand on veut resserrer sa recherche, c'est ici qu'on ouvre.
 * La distinction reste explicite — affiner l'affichage n'est pas changer ce
 * qu'on collecte — mais les deux se règlent au même endroit.
 *
 * Accessibilité : `role="dialog"` + `aria-modal`, fermeture par Échap ou par le
 * fond, et le focus part sur le premier contrôle.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import type { SortMode } from '../types.js';
import type { PropertyType } from '@rentfinder/shared';
import { formatPropertyType, formatSourceName } from '../format.js';
import { PillButton, ROOM_PRESETS, type QuickFilterValues } from './QuickFilters.js';
import { FiltersPanel } from './FiltersPanel.js';
import { Button } from '@/components/ui/button.js';

export interface SortFilterModalProps {
  readonly open: boolean;
  readonly onClose: () => void;

  readonly sort: SortMode;
  readonly onSortChange: (sort: SortMode) => void;
  readonly sortOptions: readonly { readonly value: SortMode; readonly label: string }[];

  /** Bascules d'affichage : libellé, état, setter. */
  readonly toggles: readonly (readonly [string, boolean, (value: boolean) => void])[];

  /** Budget, surface, pièces et type : les mêmes réglages que les pills. */
  readonly quickFilters: QuickFilterValues;
  readonly onQuickFiltersChange: (next: QuickFilterValues) => void;
  /** Types réellement présents dans la liste, pour ne proposer qu'eux. */
  readonly availableTypes: readonly PropertyType[];

  readonly sources: readonly string[];
  readonly selectedSources: ReadonlySet<string>;
  readonly onToggleSource: (sourceId: string) => void;
  readonly onClearSources: () => void;

  /** Rechargement de la liste après enregistrement des critères de recherche. */
  readonly onCriteriaSaved: () => void;

  /**
   * Nombre d'annonces que les réglages courants laissent passer.
   *
   * Affiché SUR le bouton de fermeture : « Voir les résultats » n'apprenait
   * rien, alors qu'on règle un filtre précisément pour savoir combien il en
   * reste — et découvrir une liste vide après avoir fermé la modale oblige à
   * la rouvrir pour comprendre.
   */
  readonly resultCount: number;

  /** Remet tri, filtres, bascules et sources à leur état d'origine. */
  readonly onReset: () => void;
  /** `true` si quelque chose s'écarte de cet état : le bouton reste sinon inerte. */
  readonly dirty: boolean;
}

export function SortFilterModal({
  open,
  onClose,
  sort,
  onSortChange,
  sortOptions,
  toggles,
  quickFilters,
  onQuickFiltersChange,
  availableTypes,
  sources,
  selectedSources,
  onToggleSource,
  onClearSources,
  onCriteriaSaved,
  resultCount,
  onReset,
  dirty,
}: SortFilterModalProps): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null);
  // Filtre de la liste des sources : elles sont une quarantaine, retrouver
  // une agence à l'œil devenait pénible.
  const [sourceQuery, setSourceQuery] = useState('');

  const comparable = (value: string): string =>
    value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const shownSources = useMemo(() => {
    const query = comparable(sourceQuery).trim();
    if (query === '') return sources;
    // On cherche dans le nom LISIBLE (« L'Adresse ») comme dans l'identifiant
    // technique (« ladresse ») : l'un ou l'autre vient à l'esprit.
    return sources.filter(
      (id) => comparable(formatSourceName(id)).includes(query) || comparable(id).includes(query),
    );
  }, [sources, sourceQuery]);

  const patch = (part: Partial<QuickFilterValues>): void =>
    onQuickFiltersChange({ ...quickFilters, ...part });

  const toggleType = (type: PropertyType): void => {
    const next = new Set(quickFilters.types);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    patch({ types: next });
  };

  // Échap ferme la modale. Cet effet dépend de `onClose`, que l'appelant
  // recrée à chaque rendu : il se réexécute donc souvent, ce qui est sans
  // conséquence ici (on ne fait qu'abonner un écouteur).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Le focus n'entre dans la modale QU'À L'OUVERTURE. Le placer dans l'effet
  // ci-dessus le ramenait au premier contrôle à chaque rendu — donc à chaque
  // frappe : impossible de saisir une surface ou un budget.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button, input')?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      // Leaflet monte ses panneaux et contrôles jusqu'à z-index 1000 : en `z-50`
      // la carte passait DEVANT la modale.
      className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
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
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-0 px-2 text-muted-foreground"
          >
            <X aria-hidden="true" className="size-5" />
          </Button>
        </div>

        <fieldset className="mb-5">
          <legend className="mb-2 text-sm font-semibold text-muted-foreground">Budget</legend>
          {/* Fourchette libre plutôt que des paliers : chaque recherche a son
            propre encadrement, et un plancher sert à écarter les annonces trop
            bon marché pour être crédibles. */}
          <div className="flex items-center gap-2">
            <NumberField
              label="de"
              suffix="€"
              value={quickFilters.minPrice}
              onChange={(v) => patch({ minPrice: v })}
            />
            <NumberField
              label="à"
              suffix="€"
              value={quickFilters.maxPrice}
              onChange={(v) => patch({ maxPrice: v })}
            />
          </div>
        </fieldset>

        <fieldset className="mb-5">
          <legend className="mb-2 text-sm font-semibold text-muted-foreground">Surface</legend>
          {/* Un seul champ : une surface MINIMALE suffit à cet usage. */}
          <NumberField
            label="au moins"
            suffix="m²"
            value={quickFilters.minArea}
            onChange={(v) => patch({ minArea: v })}
          />
        </fieldset>

        <fieldset className="mb-5">
          <legend className="mb-2 text-sm font-semibold text-muted-foreground">Pièces</legend>
          <div className="flex flex-wrap gap-1.5">
            <PillButton
              selected={quickFilters.minRooms === null}
              onClick={() => patch({ minRooms: null })}
            >
              Indifférent
            </PillButton>
            {ROOM_PRESETS.map((r) => (
              <PillButton
                key={r}
                selected={quickFilters.minRooms === r}
                onClick={() => patch({ minRooms: r })}
              >
                {r}+
              </PillButton>
            ))}
          </div>
        </fieldset>

        {availableTypes.length > 1 && (
          <fieldset className="mb-5">
            <legend className="mb-2 text-sm font-semibold text-muted-foreground">
              Type de bien
            </legend>
            {/* Pilules plutôt que cases à cocher : même geste que « Pièces »
              juste au-dessus, et une sélection lisible d'un coup d'œil. */}
            <div className="flex flex-wrap gap-1.5">
              <PillButton
                selected={quickFilters.types.size === 0}
                onClick={() => patch({ types: new Set() })}
              >
                Tous
              </PillButton>
              {availableTypes.map((type) => (
                <PillButton
                  key={type}
                  selected={quickFilters.types.has(type)}
                  onClick={() => toggleType(type)}
                >
                  {formatPropertyType(type)}
                </PillButton>
              ))}
            </div>
          </fieldset>
        )}

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
                  <span aria-hidden="true" className="flex w-4 justify-center">
                    {sort === option.value ? <Check className="size-4" /> : null}
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
            <input
              type="search"
              value={sourceQuery}
              onChange={(event) => setSourceQuery(event.target.value)}
              placeholder="Filtrer les sources…"
              aria-label="Filtrer les sources par nom"
              className="mb-2 w-full rounded-lg border border-border px-2 py-1.5 text-sm"
            />
            <ul className="flex max-h-56 flex-col overflow-y-auto">
              {shownSources.length === 0 && (
                <li className="px-2 py-1.5 text-sm text-muted-foreground">
                  Aucune source trouvée.
                </li>
              )}
              {shownSources.map((sourceId) => (
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

        {/* CRITÈRES DE COLLECTE, repliés : on les règle une fois, pas à chaque
          consultation. Déplié, on retrouve exactement l'ancien onglet
          « Alertes » — devenu enregistrable depuis le site déployé, où il
          refusait jusqu'ici toute modification. */}
        <details className="mb-5 rounded-xl border border-border">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-muted-foreground">
            Critères de recherche
            <span className="ml-1 font-normal">— ce qui est collecté et signalé</span>
          </summary>
          <div className="border-t border-border px-3 py-3">
            <FiltersPanel compact onSaved={onCriteriaSaved} />
          </div>
        </details>

        {/* Réglages éparpillés sur quatre sections : les défaire un à un était
          fastidieux. Le bouton s'efface quand il n'y a rien à défaire, plutôt
          que de promettre une action sans effet. */}
        <div className="flex gap-2">
          {dirty && (
            <Button variant="outline" onClick={onReset}>
              <RotateCcw aria-hidden="true" className="size-4" />
              Réinitialiser
            </Button>
          )}
          <Button className="flex-1" onClick={onClose}>
            {resultCount === 0
              ? 'Aucun résultat'
              : `Voir ${resultCount} annonce${resultCount > 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Champ numérique court, précédé d'un libellé et suivi de son unité. */
function NumberField({
  label,
  suffix,
  value,
  onChange,
}: {
  readonly label: string;
  readonly suffix: string;
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.value.trim();
          onChange(next === '' ? null : Number(next));
        }}
        className="w-24 rounded-lg border border-border px-2 py-1.5"
      />
      <span className="text-muted-foreground">{suffix}</span>
    </label>
  );
}
