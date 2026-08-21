/**
 * Filtres rapides de la liste, façon SeLoger (§36, §39).
 *
 * Une rangée de « pills » — Budget, Surface, Pièces, Type — qui affinent la
 * liste DÉJÀ chargée (filtrage d'affichage, sans toucher aux critères de
 * collecte réglés dans l'onglet « Filtres »). Une pill active est surlignée et
 * porte sa valeur ; sous la rangée, des puces rappellent les filtres posés et
 * permettent de les retirer un à un ou tous d'un coup.
 */

import type { PropertyType } from '@rentfinder/shared';
import { formatPropertyType } from '../format.js';
import { Dropdown } from './Dropdown.js';

/** État des filtres rapides. `null`/vide = filtre inactif. */
export interface QuickFilterValues {
  readonly maxPrice: number | null;
  readonly minArea: number | null;
  readonly minRooms: number | null;
  readonly types: ReadonlySet<PropertyType>;
}

export const EMPTY_QUICK_FILTERS: QuickFilterValues = {
  maxPrice: null,
  minArea: null,
  minRooms: null,
  types: new Set(),
};

/** `true` si au moins un filtre rapide est posé. */
export function hasActiveQuickFilters(v: QuickFilterValues): boolean {
  return v.maxPrice !== null || v.minArea !== null || v.minRooms !== null || v.types.size > 0;
}

/** Champs d'une annonce que les filtres rapides inspectent (§17). */
export interface QuickFilterable {
  readonly price: { readonly value: number | null };
  readonly area: { readonly value: number | null };
  readonly rooms: { readonly value: number | null };
  readonly propertyType: { readonly value: PropertyType };
}

/**
 * `true` si l'annonce satisfait TOUS les filtres posés. Une valeur inconnue ne
 * peut pas satisfaire un seuil → l'annonce est écartée quand ce filtre est posé.
 */
export function matchesQuickFilters(listing: QuickFilterable, v: QuickFilterValues): boolean {
  if (v.maxPrice !== null && (listing.price.value === null || listing.price.value > v.maxPrice)) {
    return false;
  }
  if (v.minArea !== null && (listing.area.value === null || listing.area.value < v.minArea)) {
    return false;
  }
  if (v.minRooms !== null && (listing.rooms.value === null || listing.rooms.value < v.minRooms)) {
    return false;
  }
  return v.types.size === 0 || v.types.has(listing.propertyType.value);
}

const PRICE_PRESETS = [700, 900, 1100, 1300, 1500] as const;
const AREA_PRESETS = [20, 30, 40, 50, 60] as const;
const ROOM_PRESETS = [1, 2, 3, 4, 5] as const;

interface QuickFiltersProps {
  readonly values: QuickFilterValues;
  readonly onChange: (next: QuickFilterValues) => void;
  /** Types de biens réellement présents dans la liste, pour ne proposer qu'eux. */
  readonly availableTypes: readonly PropertyType[];
}

export function QuickFilters({
  values,
  onChange,
  availableTypes,
}: QuickFiltersProps): React.JSX.Element {
  const patch = (part: Partial<QuickFilterValues>): void => onChange({ ...values, ...part });

  const toggleType = (type: PropertyType): void => {
    const next = new Set(values.types);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    patch({ types: next });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Budget (loyer maximum). */}
        <Dropdown
          label={values.maxPrice === null ? 'Budget' : `≤ ${values.maxPrice} €`}
          active={values.maxPrice !== null}
          panelClassName="w-56"
        >
          <PresetGrid
            options={PRICE_PRESETS.map((p) => ({ value: p, label: `≤ ${p} €` }))}
            selected={values.maxPrice}
            onSelect={(v) => patch({ maxPrice: v })}
          />
          <CustomNumber
            label="Loyer max (€)"
            value={values.maxPrice}
            onChange={(v) => patch({ maxPrice: v })}
          />
        </Dropdown>

        {/* Surface (minimum). */}
        <Dropdown
          label={values.minArea === null ? 'Surface' : `≥ ${values.minArea} m²`}
          active={values.minArea !== null}
          panelClassName="w-56"
        >
          <PresetGrid
            options={AREA_PRESETS.map((a) => ({ value: a, label: `≥ ${a} m²` }))}
            selected={values.minArea}
            onSelect={(v) => patch({ minArea: v })}
          />
          <CustomNumber
            label="Surface min (m²)"
            value={values.minArea}
            onChange={(v) => patch({ minArea: v })}
          />
        </Dropdown>

        {/* Pièces (minimum). */}
        <Dropdown
          label={values.minRooms === null ? 'Pièces' : `${values.minRooms}+ pièces`}
          active={values.minRooms !== null}
          panelClassName="w-48"
        >
          <div className="flex flex-wrap gap-1.5">
            <PillButton
              selected={values.minRooms === null}
              onClick={() => patch({ minRooms: null })}
            >
              Indifférent
            </PillButton>
            {ROOM_PRESETS.map((r) => (
              <PillButton
                key={r}
                selected={values.minRooms === r}
                onClick={() => patch({ minRooms: r })}
              >
                {r}+
              </PillButton>
            ))}
          </div>
        </Dropdown>

        {/* Type de bien (multi-sélection, limité aux types présents). */}
        {availableTypes.length > 1 && (
          <Dropdown
            label={values.types.size === 0 ? 'Type' : `Type · ${values.types.size}`}
            active={values.types.size > 0}
            panelClassName="w-52"
          >
            <ul className="flex flex-col gap-0.5">
              {availableTypes.map((type) => (
                <li key={type}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={values.types.has(type)}
                      onChange={() => toggleType(type)}
                    />
                    <span>{formatPropertyType(type)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Dropdown>
        )}
      </div>

      {/* Puces des filtres actifs, retirables. */}
      {hasActiveQuickFilters(values) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {values.maxPrice !== null && (
            <FilterChip
              label={`≤ ${values.maxPrice} €`}
              onRemove={() => patch({ maxPrice: null })}
            />
          )}
          {values.minArea !== null && (
            <FilterChip
              label={`≥ ${values.minArea} m²`}
              onRemove={() => patch({ minArea: null })}
            />
          )}
          {values.minRooms !== null && (
            <FilterChip
              label={`${values.minRooms}+ pièces`}
              onRemove={() => patch({ minRooms: null })}
            />
          )}
          {[...values.types].map((type) => (
            <FilterChip
              key={type}
              label={formatPropertyType(type)}
              onRemove={() => toggleType(type)}
            />
          ))}
          <button
            type="button"
            onClick={() => onChange(EMPTY_QUICK_FILTERS)}
            className="ml-1 min-h-9 cursor-pointer text-sm font-medium text-muted-foreground underline hover:text-foreground"
          >
            Effacer tout
          </button>
        </div>
      )}
    </div>
  );
}

/** Grille de valeurs prédéfinies ; re-cliquer la valeur active la désactive. */
function PresetGrid({
  options,
  selected,
  onSelect,
}: {
  readonly options: readonly { value: number; label: string }[];
  readonly selected: number | null;
  readonly onSelect: (value: number | null) => void;
}): React.JSX.Element {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {options.map((option) => (
        <PillButton
          key={option.value}
          selected={selected === option.value}
          onClick={() => onSelect(selected === option.value ? null : option.value)}
        >
          {option.label}
        </PillButton>
      ))}
    </div>
  );
}

/** Petit bouton-pilule sélectionnable, réutilisé dans les panneaux. */
function PillButton({
  selected,
  onClick,
  children,
}: {
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-h-9 cursor-pointer rounded-full border px-3 text-sm font-medium transition-colors ${
        selected
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-foreground hover:border-primary'
      }`}
    >
      {children}
    </button>
  );
}

/** Saisie libre d'un nombre, avec bouton d'effacement. */
function CustomNumber({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
}): React.JSX.Element {
  return (
    <label className="mt-1 flex items-center gap-2 border-t border-border pt-2 text-sm">
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
        className="w-20 rounded-lg border border-border px-2 py-1"
      />
    </label>
  );
}

/** Puce d'un filtre actif, avec croix de retrait. */
function FilterChip({
  label,
  onRemove,
}: {
  readonly label: string;
  readonly onRemove: () => void;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-1 pr-1 pl-2.5 text-sm font-medium text-primary">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Retirer le filtre ${label}`}
        className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full hover:bg-primary/20"
      >
        ×
      </button>
    </span>
  );
}
