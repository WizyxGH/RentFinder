/**
 * Accès aux écrans secondaires depuis les Paramètres (§39).
 *
 * La barre basse du téléphone ne porte que quatre destinations, et les onglets
 * du haut portent les MÊMES : tout le reste se rejoint ici — les écrans qu'on
 * ouvre une fois par mois, et ceux qu'on remplit une fois pour toutes.
 *
 * LE PROFIL ET LE DOSSIER EN FONT PARTIE. Ils occupaient tout le premier écran
 * des Paramètres : huit champs dépliés et une liste de fichiers, pour deux
 * réglages qu'on ne touche presque jamais, devant lesquels il fallait défiler
 * pour atteindre les alertes. Ils ont maintenant leur page, comme les autres.
 */

import { Bell, BarChart3, Bookmark, ChevronRight, FileText, MapPin, Radio, User } from './icons.js';

export interface SettingsLink {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly Icon: typeof Bell;
}

export const SETTINGS_LINKS: readonly SettingsLink[] = [
  {
    key: 'tenant',
    label: 'Profil locataire',
    hint: 'Sert à préparer vos messages de contact.',
    Icon: User,
  },
  {
    key: 'documents',
    label: 'Dossier de candidature',
    hint: 'Les pièces à joindre à une demande.',
    Icon: FileText,
  },
  {
    key: 'reference',
    label: 'Points de référence',
    hint: 'Les adresses d’où se compte le temps de trajet.',
    Icon: MapPin,
  },
  {
    // L'INTERRUPTEUR EST AU-DESSUS, dans les Paramètres mêmes. Cette entrée
    // disait « Alertes et historique » : elle promettait le réglage qu'elle
    // n'avait pas, et le répétait à trois centimètres de lui. Elle ne mène
    // plus qu'à ce qu'elle contient — les annonces déjà signalées.
    key: 'alerts',
    label: 'Historique des alertes',
    hint: 'Les annonces signalées, datées.',
    Icon: Bell,
  },
  {
    key: 'saved',
    label: 'Recherches enregistrées',
    hint: 'Vos jeux de critères, à rappeler d’un geste.',
    Icon: Bookmark,
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
  bare = false,
}: {
  readonly onNavigate: (key: string) => void;
  /**
   * `true` quand la liste EST la page : ni titre ni marge d'introduction. Le
   * titre « Autres réglages » n'avait de sens que sous quelque chose.
   */
  readonly bare?: boolean;
}): React.JSX.Element {
  return (
    <nav aria-label="Réglages" className={bare ? '' : 'mt-6'}>
      {!bare && <h2 className="mb-2 text-lg font-bold">Autres réglages</h2>}
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
