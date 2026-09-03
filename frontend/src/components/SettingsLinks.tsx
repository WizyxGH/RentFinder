/**
 * Accès aux écrans secondaires depuis les Paramètres (§39).
 *
 * La barre basse du téléphone ne porte que quatre destinations, et les onglets
 * du haut ont été ramenés à quatre eux aussi : « Sources » n'y méritait pas une
 * place permanente — on y va une fois par mois, pour vérifier qu'un site n'est
 * pas tombé. Sa place est ici, avec les autres écrans qu'on consulte
 * ponctuellement, et cette liste s'affiche donc sur TOUS les formats.
 */

import { Bell, BarChart3, ChevronRight, Radio } from 'lucide-react';

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
    <nav aria-label="Autres réglages" className="mt-6">
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
