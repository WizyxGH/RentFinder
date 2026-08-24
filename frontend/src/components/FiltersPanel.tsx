/**
 * Réglage des filtres de recherche depuis l'interface (§66).
 *
 * Les filtres numériques (budget, surface) s'appliquent immédiatement à
 * l'affichage. Les exclusions (colocation, étudiant) sont figées à la collecte :
 * elles prennent effet au prochain `pnpm collect`. L'écran le dit clairement.
 */

import { useEffect, useState } from 'react';
import type { FilterConfig } from '../types.js';
import { fetchFilters, saveFilters } from '../api/client.js';
import { Button } from '@/components/ui/button.js';

interface FiltersPanelProps {
  /** Appelé après enregistrement, pour recharger la liste. */
  readonly onSaved: () => void;
}

const FIELD = 'w-28 rounded-lg border border-input bg-card px-2 py-1.5 text-right';
const ROW = 'flex items-center justify-between gap-3 py-2';

/** Choix « nature du bailleur » présentés dans l'ordre Tous / Particuliers / Agences. */
const LANDLORD_OPTIONS: readonly {
  readonly value: 'all' | 'private' | 'agency';
  readonly label: string;
}[] = [
  { value: 'all', label: 'Tous' },
  { value: 'private', label: 'Particuliers' },
  { value: 'agency', label: 'Agences' },
];

export function FiltersPanel({ onSaved }: FiltersPanelProps): React.JSX.Element {
  const [filters, setFilters] = useState<FilterConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchFilters().then(setFilters);
  }, []);

  if (filters === null) return <p className="text-muted-foreground">Chargement des filtres…</p>;

  const set = (patch: Partial<FilterConfig>): void => setFilters({ ...filters, ...patch });

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
      <h2 className="mb-1 text-lg font-semibold">Filtres de recherche</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Réglez votre recherche. Budget et surface se répercutent immédiatement ; les exclusions
        prennent effet à la prochaine collecte.
      </p>

      <dl className="divide-y divide-border">
        <div className={ROW}>
          <label htmlFor="maxPrice">Budget maximum (€/mois)</label>
          <input
            id="maxPrice"
            type="number"
            min={0}
            className={FIELD}
            value={filters.maxPrice}
            onChange={(e) => set({ maxPrice: Number(e.target.value) })}
          />
        </div>
        <div className={ROW}>
          <label htmlFor="minPrice">Loyer minimum (€ — écarte les parkings)</label>
          <input
            id="minPrice"
            type="number"
            min={0}
            className={FIELD}
            value={filters.minPrice ?? 0}
            onChange={(e) => set({ minPrice: Number(e.target.value) })}
          />
        </div>
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
          <span>
            Bailleur
            <span className="ml-1 text-xs text-muted-foreground">
              (« Particuliers » masque les agences)
            </span>
          </span>
          <div
            role="group"
            aria-label="Nature du bailleur"
            className="inline-flex overflow-hidden rounded-lg border border-input text-sm"
          >
            {LANDLORD_OPTIONS.map((opt) => {
              const active = (filters.landlordFilter ?? 'all') === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => set({ landlordFilter: opt.value })}
                  className={`px-3 py-1.5 ${active ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-accent'}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </dl>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
        {message !== null && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </section>
  );
}
