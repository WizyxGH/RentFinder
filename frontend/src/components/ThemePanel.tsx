/**
 * Choix du thème — écran Paramètres → Apparence.
 *
 * Trois choix, pas davantage : suivre l'appareil, forcer le clair, forcer le
 * sombre. Un réglage d'apparence n'a pas à se négocier écran par écran.
 *
 * L'APERÇU EST L'ÉCRAN LUI-MÊME. Le choix s'applique à la sélection, sans
 * bouton de validation : on voit immédiatement ce qu'on obtient, et rien ne
 * s'enregistre ailleurs qu'ici — c'est une préférence locale à l'appareil,
 * comme la luminosité.
 */

import { useState } from 'react';
import { ArrowLeft, Check, Home, Moon, Sun } from './icons.js';
import type { IconComponent } from './icons.js';
import {
  THEME_HINTS,
  THEME_LABELS,
  THEME_PREFERENCES,
  applyTheme,
  readTheme,
  type ThemePreference,
} from '../theme.js';
import { Button } from '@/components/ui/button.js';

const ICONS: Readonly<Record<ThemePreference, IconComponent>> = {
  auto: Home,
  light: Sun,
  dark: Moon,
};

export function ThemePanel({ onBack }: { readonly onBack: () => void }): React.JSX.Element {
  const [choice, setChoice] = useState<ThemePreference>(readTheme);

  const pick = (preference: ThemePreference): void => {
    setChoice(preference);
    applyTheme(preference);
  };

  return (
    <div>
      <header className="mb-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Retour
        </Button>
      </header>

      <h1 className="mb-1 text-xl font-bold">Apparence</h1>
      <p className="text-muted-foreground mb-4 text-[0.9rem]">
        Ce choix ne vaut que pour cet appareil : l’éclairage n’est pas le même sur un téléphone le
        soir et sur un écran de bureau.
      </p>

      <ul className="flex flex-col gap-2">
        {THEME_PREFERENCES.map((preference) => {
          const Icon = ICONS[preference];
          const active = choice === preference;
          return (
            <li key={preference}>
              <button
                type="button"
                onClick={() => pick(preference)}
                aria-pressed={active}
                className={`border-border flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                  active ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                }`}
              >
                <Icon
                  aria-hidden="true"
                  weight={active ? 'fill' : 'regular'}
                  className={`size-5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{THEME_LABELS[preference]}</span>
                  <span className="text-muted-foreground block text-[0.82rem]">
                    {THEME_HINTS[preference]}
                  </span>
                </span>
                {active && <Check aria-hidden="true" className="text-primary size-5 shrink-0" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
