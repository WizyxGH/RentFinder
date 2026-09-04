/**
 * Réglage des CRITÈRES DE RECHERCHE (§66) — ce qui est collecté et signalé.
 *
 * À ne pas confondre avec les filtres d'affichage de la modale, qui ne font que
 * trier ce qui est déjà là : ici on décide ce qui entrera dans la base et ce
 * qui déclenchera une alerte. Les deux vivent désormais dans la même modale,
 * dans deux sections distinctes, parce qu'on les cherche au même endroit.
 *
 * Budget et surface s'appliquent immédiatement à l'affichage ; les exclusions
 * (colocation, étudiant) sont figées à la collecte et prennent effet au
 * prochain run. L'écran le dit.
 */

import { useEffect, useState } from 'react';
import type { FilterConfig } from '../types.js';
import { MVP_CRITERIA } from '@rentfinder/shared';
import { fetchFilters, saveFilters } from '../api/client.js';
import { Button } from '@/components/ui/button.js';
import { PanelSkeleton } from './Skeletons.js';

interface FiltersPanelProps {
  /** Appelé après enregistrement, pour recharger la liste. */
  readonly onSaved: () => void;
  /**
   * Rendu sans son titre ni son introduction, pour s'insérer dans une section
   * qui les porte déjà (la modale « Trier et filtrer »).
   */
  readonly compact?: boolean;
}

const FIELD = 'w-28 rounded-lg border border-input bg-card px-2 py-1.5 text-right';
const ROW = 'flex items-center justify-between gap-3 py-2';

/**
 * Choix « nature du bailleur ». Les intitulés portent leur propre explication
 * — « seuls », « uniquement » — plutôt qu'une note en petits caractères à côté.
 */
const LANDLORD_OPTIONS: readonly {
  readonly value: 'all' | 'private' | 'agency';
  readonly label: string;
}[] = [
  { value: 'all', label: 'Tous' },
  { value: 'private', label: 'Particuliers seuls' },
  { value: 'agency', label: 'Agences uniquement' },
];

/** Choix « meublé » présentés dans l'ordre Tous / Meublé / Non meublé. */
const FURNISHED_OPTIONS: readonly {
  readonly value: 'all' | 'furnished' | 'unfurnished';
  readonly label: string;
}[] = [
  { value: 'all', label: 'Tous' },
  { value: 'furnished', label: 'Meublé' },
  { value: 'unfurnished', label: 'Non meublé' },
];

/** Bouton segmenté générique (choix exclusif parmi quelques options courtes). */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly ariaLabel: string;
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-lg border border-input text-sm"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 ${active ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-accent'}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function FiltersPanel({ onSaved, compact = false }: FiltersPanelProps): React.JSX.Element {
  const [filters, setFilters] = useState<FilterConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchFilters().then(setFilters);
  }, []);

  if (filters === null) return <PanelSkeleton rows={6} />;

  const set = (patch: Partial<FilterConfig>): void => setFilters({ ...filters, ...patch });

  /** Remet les critères aux valeurs par défaut du projet, sans enregistrer :
   * l'utilisateur voit le résultat et confirme avec « Enregistrer ». */
  const handleReset = (): void => {
    setFilters({
      cities: [...MVP_CRITERIA.cities],
      maxPrice: MVP_CRITERIA.maxPrice,
      minArea: MVP_CRITERIA.minArea,
      ...(MVP_CRITERIA.minPrice !== undefined ? { minPrice: MVP_CRITERIA.minPrice } : {}),
      ...(MVP_CRITERIA.maxCommuteMinutes !== undefined
        ? { maxCommuteMinutes: MVP_CRITERIA.maxCommuteMinutes }
        : {}),
      excludeFlatShare: MVP_CRITERIA.excludeFlatShare ?? true,
      excludeStudent: MVP_CRITERIA.excludeStudent ?? true,
      landlordFilter: 'all',
      furnishedFilter: 'all',
    });
    setMessage('Valeurs par défaut restaurées — « Enregistrer » pour appliquer.');
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setMessage(null);
    try {
      await saveFilters(filters);
      setMessage(
        'Filtres enregistrés. Le budget et la surface s’appliquent tout de suite ; les exclusions au prochain « pnpm collect ».',
      );
      onSaved();
    } catch {
      setMessage('Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      {!compact && (
        <>
          <h2 className="mb-1 text-lg font-semibold">Critères de recherche</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Réglez votre recherche. Budget et surface se répercutent immédiatement ; les exclusions
            prennent effet à la prochaine collecte.
          </p>
        </>
      )}

      <dl className="divide-y divide-border">
        {/* Une seule ligne « de … à … » : les deux bornes formaient deux
          réglages distincts, présentés dans l'ordre inverse de la lecture
          (maximum avant minimum), alors qu'elles décrivent UN budget. */}
        <div className={ROW}>
          <label htmlFor="minPrice">Budget (€/mois)</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">de</span>
            <input
              id="minPrice"
              type="number"
              min={0}
              aria-label="Loyer minimum"
              className={FIELD}
              value={filters.minPrice ?? 0}
              onChange={(e) => set({ minPrice: Number(e.target.value) })}
            />
            <span className="text-sm text-muted-foreground">à</span>
            <input
              id="maxPrice"
              type="number"
              min={0}
              aria-label="Loyer maximum"
              className={FIELD}
              value={filters.maxPrice}
              onChange={(e) => set({ maxPrice: Number(e.target.value) })}
            />
          </div>
        </div>
        <p className="pt-1 text-xs text-muted-foreground">
          Le plancher écarte les annonces trop bon marché pour être un logement (parkings, caves).
        </p>
        <div className={ROW}>
          <label htmlFor="minArea">Surface minimum (m²)</label>
          <input
            id="minArea"
            type="number"
            min={0}
            className={FIELD}
            value={filters.minArea}
            onChange={(e) => set({ minArea: Number(e.target.value) })}
          />
        </div>
        <div className={ROW}>
          <label htmlFor="maxCommuteMinutes">Trajet max domicile→travail (min)</label>
          <input
            id="maxCommuteMinutes"
            type="number"
            min={0}
            className={FIELD}
            value={filters.maxCommuteMinutes ?? 60}
            onChange={(e) => set({ maxCommuteMinutes: Number(e.target.value) })}
          />
        </div>
        <div className={ROW}>
          <label htmlFor="excludeFlatShare">Exclure les colocations</label>
          <input
            id="excludeFlatShare"
            type="checkbox"
            className="size-5"
            checked={filters.excludeFlatShare ?? false}
            onChange={(e) => set({ excludeFlatShare: e.target.checked })}
          />
        </div>
        <div className={ROW}>
          <label htmlFor="excludeStudent">Exclure les locations étudiantes</label>
          <input
            id="excludeStudent"
            type="checkbox"
            className="size-5"
            checked={filters.excludeStudent ?? false}
            onChange={(e) => set({ excludeStudent: e.target.checked })}
          />
        </div>
        <div className={ROW}>
          {/* Les intitulés disent eux-mêmes ce qu'ils font : « seuls » et
            « uniquement » rendent la note explicative inutile. */}
          <span>Bailleur</span>
          <Segmented
            ariaLabel="Nature du bailleur"
            options={LANDLORD_OPTIONS}
            value={filters.landlordFilter ?? 'all'}
            onChange={(landlordFilter) => set({ landlordFilter })}
          />
        </div>
        <div className={ROW}>
          <span>
            Meublé
            <span className="ml-1 text-xs text-muted-foreground">(inconnus conservés)</span>
          </span>
          <Segmented
            ariaLabel="Caractère meublé"
            options={FURNISHED_OPTIONS}
            value={filters.furnishedFilter ?? 'all'}
            onChange={(furnishedFilter) => set({ furnishedFilter })}
          />
        </div>
      </dl>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={saving}>
          Réinitialiser
        </Button>
        {message !== null && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </section>
  );
}
