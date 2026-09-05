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
    id: '2026-09-05-mdp',
    date: '2026-09-05',
    title: 'Un mot de passe oublié ne perd plus le compte',
    body: 'L’écran de connexion propose « Mot de passe oublié » : un lien part vers l’adresse de votre compte, valable une heure et une seule fois. Pensez à renseigner cette adresse — sans elle, il n’y a nulle part où écrire.',
  },
  {
    id: '2026-09-05-filtres',
    date: '2026-09-05',
    title: 'Les filtres filtrent enfin, et le thème change vraiment',
    body: 'Colocations, locations étudiantes, bailleur et meublé s’appliquent désormais à la liste que vous avez sous les yeux, sans attendre la collecte suivante. Le choix clair/sombre agit pour de bon. Le tri sort des filtres et gagne « Le plus proche ».',
  },
  {
    id: '2026-09-05-garanties',
    date: '2026-09-05',
    title: 'Plusieurs garanties, et une situation à choisir',
    body: 'Deux parents qui se portent caution ensemble, ou un garant doublé d’une garantie Visale : déclarez-les toutes. Chaque garant physique a ses propres pièces au dossier. La situation professionnelle se choisit dans une liste — vos messages s’accordent enfin.',
  },
  {
    id: '2026-09-05-transfert',
    date: '2026-09-05',
    title: 'Vos alertes Leboncoin et SeLoger, sur votre compte',
    body: 'Ces portails interdisent qu’on visite leurs pages : leur alerte par e-mail est la seule voie autorisée. Paramètres → Alertes des portails vous donne une adresse qui n’est qu’à vous, vers laquelle faire suivre ces e-mails depuis votre boîte. Nous ne vous demandons jamais votre mot de passe.',
  },
  {
    id: '2026-09-05-garantie',
    date: '2026-09-05',
    title: 'Visale, Garantme : dites laquelle est la vôtre',
    body: 'La case « j’ai un garant » devient un choix : une personne, la garantie Visale, une caution privée ou aucune. Vos messages le disent dans les termes qu’un bailleur reconnaît, et le dossier ne réclame plus que les pièces qui vous concernent — une attestation Visale au lieu du dossier complet d’un garant.',
  },
  {
    id: '2026-09-05-alertes',
    date: '2026-09-05',
    title: 'L’historique des alertes ne s’efface plus',
    body: 'Les annonces dont vous avez été prévenu restent dans l’historique, même si elles sortent ensuite de vos critères. Et toucher une notification rouvre bien l’annonce.',
  },
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
