/**
 * Champ d'adresse avec suggestions (§20).
 *
 * ON TAPAIT UNE ADRESSE À L'AVEUGLE, et on ne savait qu'à la collecte suivante
 * si elle avait été comprise — une faute de frappe, un nom de rue approximatif,
 * et le repère restait muet sans que rien ne l'explique. Choisir dans une liste
 * rend le géocodage certain avant même d'enregistrer.
 *
 * LA MÊME SOURCE QUE LA COLLECTE : la Base Adresse Nationale, service public
 * gratuit et sans clé. Le collecteur l'interroge déjà pour convertir ces
 * adresses en coordonnées ; suggérer depuis un autre annuaire aurait proposé
 * des libellés que le géocodeur, lui, n'aurait pas reconnus.
 *
 * FRAPPE PAR FRAPPE, MAIS PAS PLUS. La requête est différée, et abandonnée dès
 * qu'une nouvelle frappe arrive : une adresse se tape en vingt caractères, cela
 * ferait vingt appels à un service public pour dix-neuf réponses jetées.
 *
 * DÉGRADATION SILENCIEUSE. Service injoignable, hors ligne, réponse illisible :
 * le champ reste un champ de texte ordinaire. Une adresse saisie à la main a
 * toujours fonctionné, elle continue (§69).
 */

import { useEffect, useId, useRef, useState } from 'react';

/** Service public : pas de clé, pas de compte, CORS ouvert. */
const BAN_ENDPOINT = 'https://api-adresse.data.gouv.fr/search/';

/** Assez pour couvrir les hésitations, assez court pour rester vivant. */
const DEBOUNCE_MS = 250;

/** En dessous, la BAN renvoie tout Paris : on ne demande rien. */
const MIN_QUERY_LENGTH = 4;

interface Suggestion {
  /** Libellé complet, tel qu'il sera enregistré et re-géocodé. */
  readonly label: string;
  /** Ville, affichée en second pour distinguer deux rues homonymes. */
  readonly context: string;
}

interface BanFeature {
  readonly properties?: { readonly label?: unknown; readonly context?: unknown };
}

function parseSuggestions(payload: unknown): Suggestion[] {
  const features = (payload as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const parsed: Suggestion[] = [];
  for (const feature of features as BanFeature[]) {
    const label = feature.properties?.label;
    if (typeof label !== 'string' || label === '') continue;
    const context = feature.properties?.context;
    parsed.push({ label, context: typeof context === 'string' ? context : '' });
  }
  return parsed;
}

export function AddressField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  className,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ariaLabel: string;
  readonly placeholder?: string;
  readonly className?: string;
}): React.JSX.Element {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  /**
   * Ce qui vient d'être choisi dans la liste.
   *
   * Sans ce garde-fou, sélectionner une suggestion réécrit la valeur, ce qui
   * relance une recherche sur le texte complet — et rouvre la liste sous le
   * doigt au moment précis où l'on vient de la fermer.
   */
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return undefined;
    }
    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return undefined;
    }

    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      const url = `${BAN_ENDPOINT}?q=${encodeURIComponent(query)}&limit=5&autocomplete=1`;
      void fetch(url, { signal: abort.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          setSuggestions(parseSuggestions(payload));
          setActive(-1);
        })
        .catch(() => {
          // Hors ligne ou service indisponible : le champ redevient un simple
          // champ de texte, ce qu'il a toujours su être.
          setSuggestions([]);
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [value]);

  const pick = (suggestion: Suggestion): void => {
    justPicked.current = true;
    onChange(suggestion.label);
    setSuggestions([]);
    setOpen(false);
  };

  const visible = open && suggestions.length > 0;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!visible) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      const chosen = suggestions[active];
      if (chosen !== undefined) pick(chosen);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        {...(placeholder !== undefined ? { placeholder } : {})}
        // `off` ne suffit pas toujours ; `new-password` est le seul mot que
        // tous les navigateurs respectent pour ne pas superposer LEUR liste à
        // la nôtre.
        autoComplete="new-password"
        className={className}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Un `blur` immédiat annulerait le clic sur une suggestion : le
        // navigateur retire le focus AVANT de déclencher le clic.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {visible && (
        <ul
          id={listId}
          role="listbox"
          className="border-border bg-card absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border shadow-lg"
        >
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.label}-${index}`} role="option" aria-selected={index === active}>
              <button
                type="button"
                // `onMouseDown` et non `onClick` : le clic arrive après le
                // `blur`, qui a déjà fermé la liste.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(suggestion);
                }}
                className={`block w-full cursor-pointer px-3 py-2 text-left text-[0.9rem] ${
                  index === active ? 'bg-muted' : 'hover:bg-muted'
                }`}
              >
                <span className="block truncate">{suggestion.label}</span>
                {suggestion.context !== '' && (
                  <span className="text-muted-foreground block truncate text-[0.75rem]">
                    {suggestion.context}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
