/**
 * Accès aux écrans secondaires, MOBILE UNIQUEMENT (§39).
 *
 * La barre basse ne porte que quatre destinations. Sur grand écran, les
 * onglets du haut mènent partout ; sur mobile ils sont masqués, ce qui rendrait
 * Notifications, Statistiques et Sources inatteignables. Cette liste les
 * rouvre depuis « Paramètres », qui est leur place naturelle.
 */

import { Bell, BarChart3, ChevronRight, Radio, SlidersHorizontal } from 'lucide-react';

export interface SettingsLink {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly Icon: typeof Bell;
}

export const SETTINGS_LINKS: readonly SettingsLink[] = [
  {
    key: 'alerts',
    label: 'Notifications',
    hint: 'Canaux actifs et historique des alertes.',
    Icon: Bell,
  },
  {
    key: 'filters',
    label: 'Critères de recherche',
    hint: 'Ce qui est collecté et signalé.',
    Icon: SlidersHorizontal,
  },
  {
    key: 'stats',
    label: 'Statistiques',
    hint: 'Couverture des sources et taux de réponse.',
    Icon: BarChart3,
  },
  { key: 'sources', label: 'Sources', hint: 'État de santé de chaque site.', Icon: Radio },
];

export function SettingsLinks({
  onNavigate,
}: {
  readonly onNavigate: (key: string) => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Autres réglages" className="mt-6 sm:hidden">
      <h2 className="mb-2 text-lg font-bold">Autres réglages</h2>
      <ul className="flex flex-col gap-2">
        {SETTINGS_LINKS.map(({ key, label, hint, Icon }) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => onNavigate(key)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted"
            >
              <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{label}</span>
                <span className="block text-[0.82rem] text-muted-foreground">{hint}</span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
