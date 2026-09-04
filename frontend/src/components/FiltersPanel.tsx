/**
 * Réglage des CRITÈRES DE RECHERCHE (§66) — ce qui est collecté et signalé.
 *
 * À ne pas confondre avec les filtres d'affichage de la modale, qui ne font que
 * trier ce qui est déjà là : ici on décide ce qui entrera dans la base et ce
 * qui déclenchera une alerte. Les deux vivent dans la même modale parce qu'on
 * les cherche au même endroit — mais dans deux familles nettement séparées,
 * l'une titrée « Affiner ces résultats », celle-ci dans son propre cadre.
 *
 * TOUT S'APPLIQUE À LA SAISIE, comme le reste de la modale.
 *
 * Ce panneau demandait un clic sur « Appliquer les critères », et proposait à
 * côté un « Valeurs par défaut » qui réécrivait six champs sans les enregistrer
 * — il fallait donc encore appliquer derrière. Deux boutons dont la portée ne
 * se devinait pas, dans le seul bloc d'un écran où tout le reste — tri, budget,
 * pilules, cases — agit dès qu'on y touche. Qui règle un critère puis referme
 * n'a aucune raison de soupçonner qu'il vient de tout perdre.
 *
 * L'écriture est donc DIFFÉRÉE de quelques centaines de millisecondes : frappe
 * par frappe, on enverrait « 4 » puis « 45 » à une base dont Turso facture les
 * accès (§30). Et elle est FORCÉE au démontage — refermer la modale juste après
 * une frappe ne doit pas perdre le réglage.
 */

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { FilterConfig } from '../types.js';
import { fetchFilters, saveFilters } from '../api/client.js';
import { PanelSkeleton } from './Skeletons.js';

const FIELD = 'w-28 rounded-lg border border-input bg-card px-2 py-1.5 text-right';
const ROW = 'flex items-center justify-between gap-3 py-2';

/**
 * Délai avant écriture. Assez long pour qu'un nombre à deux chiffres ne compte
 * que pour une écriture, assez court pour que l'accusé arrive pendant qu'on
 * regarde encore le champ.
 */
const SAVE_DELAY_MS = 600;

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

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function FiltersPanel(): React.JSX.Element {
  const [filters, setFilters] = useState<FilterConfig | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');

  /**
   * La minuterie d'écriture différée, et ce qui reste à écrire tant qu'elle
   * n'a pas expiré. C'est ce couple qui permet de forcer l'écriture au
   * démontage.
   */
  const timer = useRef<number | null>(null);
  const unsaved = useRef<FilterConfig | null>(null);

  useEffect(() => {
    void fetchFilters().then(setFilters);
  }, []);

  // Refermer la modale démonte ce panneau. Sans ce filet, une valeur saisie
  // moins d'une demi-seconde avant la fermeture serait perdue — et rien ne
  // l'aurait laissé deviner.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (unsaved.current !== null) void saveFilters(unsaved.current);
    },
    [],
  );

  if (filters === null) return <PanelSkeleton rows={5} />;

  const commit = async (next: FilterConfig): Promise<void> => {
    try {
      await saveFilters(next);
      unsaved.current = null;
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  const set = (patch: Partial<FilterConfig>): void => {
    const next = { ...filters, ...patch };
    setFilters(next);
    unsaved.current = next;
    setStatus('saving');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void commit(next), SAVE_DELAY_MS);
  };

  return (
    <section>
      <dl className="divide-y divide-border">
        {/* BUDGET ET SURFACE NE SONT PAS ICI : les filtres d'affichage, quelques
          centimètres plus haut, portent déjà les mêmes deux réglages. Les
          montrer deux fois posait la question « lequel des deux compte ? », à
          laquelle il n'y avait pas de bonne réponse. C'est « Enregistrer cette
          recherche » qui reporte les valeurs des filtres sur les critères. */}
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

      {/* L'accusé occupe une ligne RÉSERVÉE : sans elle, son apparition
        déplaçait le contenu sous le doigt au moment précis où l'on règle. */}
      <p role="status" className="mt-2 min-h-5 text-[0.82rem] text-muted-foreground">
        {status === 'saving' && 'Enregistrement…'}
        {status === 'saved' && (
          <span className="text-good inline-flex items-center gap-1">
            <Check aria-hidden="true" className="size-3.5" /> Enregistré
          </span>
        )}
        {status === 'error' && <span className="text-bad">Échec de l’enregistrement.</span>}
      </p>
    </section>
  );
}
