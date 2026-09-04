/**
 * Les nouveautés, telles qu'on les raconte à quelqu'un qui revient.
 *
 * POURQUOI CE FICHIER EXISTE. Le site change sous les pieds de ses utilisateurs
 * — des écrans se déplacent, des réglages apparaissent, un bouton disparaît. Ne
 * rien dire laisse croire à une panne : « je ne retrouve plus le bouton
 * Enregistrer » est plus vite pensé que « il a dû bouger ».
 *
 * ON N'Y ÉCRIT PAS DES COMMITS. Le journal Git raconte ce qui a été fait au
 * code ; celui-ci raconte ce qui change POUR QUELQU'UN. « Retrait de l'accès
 * direct à Turso » n'a aucun sens hors du dépôt ; « vous ne saisissez plus vos
 * identifiants de base à chaque visite » en a un.
 *
 * LES ENTRÉES NE BOUGENT PLUS UNE FOIS PUBLIÉES. Leur identifiant sert à savoir
 * ce qui a déjà été lu : réécrire une entrée ancienne la ferait ressurgir chez
 * tout le monde.
 */

export interface ChangelogEntry {
  /** Identifiant stable, jamais réutilisé. Sert de repère de lecture. */
  readonly id: string;
  /** Date de publication, en ISO court. Affichée telle quelle. */
  readonly date: string;
  readonly title: string;
  /** Ce que ça change concrètement, en une ou deux phrases. */
  readonly body: string;
}

/**
 * De la plus récente à la plus ancienne — l'ordre d'affichage.
 *
 * On n'en garde qu'une poignée : personne ne lit quinze nouveautés, et les
 * anciennes n'intéressent plus celui qui vient de les vivre.
 */
export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    id: '2026-09-04-adresses',
    date: '2026-09-04',
    title: 'Vos adresses de référence se règlent depuis le site',
    body: 'Lieu de travail, gare : saisissez-les dans Paramètres → Adresses de référence, avec des suggestions à la frappe. Les temps de trajet affichés sur les annonces s’y ajustent à la collecte suivante.',
  },
  {
    id: '2026-09-04-notifications',
    date: '2026-09-04',
    title: 'Des alertes par famille, et non plus tout ou rien',
    body: 'Nouvelles annonces, annonces proches de vos critères, rappel de candidature, favori qui disparaît : chaque famille s’allume séparément depuis Paramètres → Notifications.',
  },
  {
    id: '2026-09-04-dossier',
    date: '2026-09-04',
    title: 'Votre dossier de candidature vous suit',
    body: 'Les pièces déposées une fois sont désormais accessibles depuis tous vos appareils, rangées selon la liste du décret n° 2015-1437. Rien n’est jamais envoyé sans votre geste.',
  },
  {
    id: '2026-09-04-recherches',
    date: '2026-09-04',
    title: 'Les recherches enregistrées se renomment',
    body: 'Créer, lancer, renommer et supprimer se font maintenant au même endroit, depuis Paramètres → Recherches enregistrées.',
  },
  {
    id: '2026-09-04-theme',
    date: '2026-09-04',
    title: 'Thème clair, sombre ou automatique',
    body: 'Paramètres → Apparence. Par défaut, le site suit le réglage de votre appareil.',
  },
];

/**
 * Ce qui reste à lire.
 *
 * `null` = on n'a jamais rien lu. Ce n'est PAS « tout est nouveau » : quelqu'un
 * qui découvre l'application n'a rien à rattraper, et lui servir cinq
 * nouveautés avant sa première annonce serait absurde. L'appelant marque donc
 * le journal comme lu à la fin du premier parcours.
 */
export function unseenEntries(lastSeenId: string | null): readonly ChangelogEntry[] {
  if (lastSeenId === null) return [];
  const index = CHANGELOG.findIndex((entry) => entry.id === lastSeenId);
  // Repère inconnu — une entrée retirée depuis, ou un identifiant d'une version
  // future : on ne montre rien plutôt que de tout remontrer.
  return index === -1 ? [] : CHANGELOG.slice(0, index);
}

/** L'entrée la plus récente, celle qu'on enregistre après lecture. */
export function latestEntryId(): string | null {
  return CHANGELOG[0]?.id ?? null;
}
