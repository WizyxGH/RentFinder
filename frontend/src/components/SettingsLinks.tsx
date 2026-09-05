/**
 * Les Paramètres, rangés (§39).
 *
 * C'ÉTAIT UNE LISTE PLATE DE SIX ENTRÉES, dans l'ordre où elles étaient
 * apparues : le profil locataire à côté de l'état de santé des sources, les
 * recherches enregistrées entre les alertes et les statistiques. Rien ne disait
 * ce qui relevait de SOI, de sa RECHERCHE, ou de l'APPLICATION — donc rien
 * n'aidait à trouver, et chaque ajout aggravait le cas.
 *
 * Trois groupes, dans l'ordre où l'on s'en sert :
 *
 *   VOUS       ce qu'on remplit une fois et qui sert à candidater ;
 *   RECHERCHE  ce qui décide de ce qu'on voit et de ce qui alerte ;
 *   APPLICATION l'apparence et l'état de l'outil lui-même.
 *
 * LES PRÉCISIONS DISENT CE QU'ON Y FAIT, pas ce que c'est. « Vos jeux de
 * critères, à rappeler d'un geste » décrivait joliment un concept ; « Retrouver
 * une recherche déjà réglée » dit à quoi sert le clic qu'on s'apprête à faire.
 */

import {
  Agency,
  BarChart3,
  Bell,
  Bookmark,
  ChevronRight,
  FileText,
  Mail,
  MapPin,
  Palette,
  Radio,
  User,
  type IconComponent,
} from './icons.js';

export interface SettingsLink {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly Icon: IconComponent;
}

interface SettingsSection {
  readonly title: string;
  readonly links: readonly SettingsLink[];
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    title: 'Vous',
    links: [
      {
        key: 'tenant',
        label: 'Profil locataire',
        hint: 'Votre situation, pour écrire vos messages sans les retaper.',
        Icon: User,
      },
      {
        key: 'documents',
        label: 'Dossier de candidature',
        hint: 'Déposez vos pièces une fois, joignez-les partout.',
        Icon: FileText,
      },
    ],
  },
  {
    title: 'Votre recherche',
    links: [
      {
        key: 'reference',
        label: 'Adresses de référence',
        hint: 'D’où se comptent les temps de trajet affichés.',
        Icon: MapPin,
      },
      {
        key: 'saved',
        label: 'Recherches enregistrées',
        hint: 'Retrouver une recherche déjà réglée, sans tout refaire.',
        Icon: Bookmark,
      },
      {
        // Les portails qui interdisent qu'on les visite (§10) n'ont qu'une voie
        // conforme : leur propre alerte par e-mail. Encore faut-il savoir où la
        // faire suivre — d'où cet écran, rangé avec ce qui décide de ce qu'on
        // voit, et non avec les réglages de l'application.
        key: 'forwarding',
        label: 'Alertes des portails',
        hint: 'Faites suivre vos alertes Leboncoin ou SeLoger vers votre adresse.',
        Icon: Mail,
      },
      {
        // L'INTERRUPTEUR VIT DERRIÈRE CETTE PORTE, et non plus au-dessus de la
        // liste. Il y était seul de son espèce — un réglage posé au milieu de
        // liens — et ne pouvait rien dire des familles d'alertes.
        key: 'notifications',
        label: 'Notifications',
        hint: 'Ce dont vous voulez être prévenu, et comment.',
        Icon: Bell,
      },
    ],
  },
  {
    title: 'Application',
    links: [
      {
        key: 'theme',
        label: 'Apparence',
        hint: 'Clair, sombre, ou comme votre appareil.',
        Icon: Palette,
      },
      {
        key: 'sources',
        label: 'Sources',
        hint: 'Les sites visités, et lesquels répondent encore.',
        Icon: Radio,
      },
      {
        key: 'agencies',
        label: 'Agences',
        hint: 'Qui publie quoi, et comment les joindre.',
        Icon: Agency,
      },
      {
        key: 'stats',
        label: 'Statistiques',
        hint: 'Couverture des sources et taux de réponse.',
        Icon: BarChart3,
      },
    ],
  },
];

/** Toutes les entrées à plat — pour qui a besoin de la liste, non des groupes. */
export const SETTINGS_LINKS: readonly SettingsLink[] = SETTINGS_SECTIONS.flatMap(
  (section) => section.links,
);

export function SettingsLinks({
  onNavigate,
}: {
  readonly onNavigate: (key: string) => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Réglages">
      {SETTINGS_SECTIONS.map((section) => (
        <section key={section.title} className="mb-5">
          <h2 className="text-muted-foreground mb-2 text-sm font-semibold">{section.title}</h2>
          <ul className="flex flex-col gap-2">
            {section.links.map(({ key, label, hint, Icon }) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onNavigate(key)}
                  className="border-border hover:bg-muted flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors"
                >
                  <Icon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{label}</span>
                    <span className="text-muted-foreground block text-[0.82rem]">{hint}</span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0"
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
