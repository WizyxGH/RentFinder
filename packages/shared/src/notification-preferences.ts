/**
 * Ce qu'on veut se faire signaler (§29).
 *
 * IL N'Y AVAIT QU'UN INTERRUPTEUR : les alertes de nouvelles annonces, tout ou
 * rien. Or une recherche de logement a plusieurs moments qui méritent qu'on
 * lève les yeux, et ils n'ont pas la même valeur selon le jour. Une annonce qui
 * vient de paraître, oui, toujours. Un rappel de candidater sur un favori mis
 * de côté il y a trois jours, peut-être. Un favori qui disparaît, sûrement — et
 * c'est justement celle qu'on ne pouvait pas demander.
 *
 * TOUT EST ACTIF PAR DÉFAUT, sauf ce qui n'existe pas encore : quelqu'un qui
 * allume les notifications veut être prévenu, pas cocher une liste. Le réglage
 * fin est là pour éteindre ce qui gêne, pas pour construire son service.
 *
 * CES PRÉFÉRENCES SONT LUES PAR LA COLLECTE, qui décide seule d'envoyer ou non.
 * Filtrer côté navigateur n'aurait rien filtré : la notification part du
 * collecteur vers le service de push, sans passer par la page.
 */

/** Les familles d'alertes, dans l'ordre où l'écran les présente. */
export type NotificationKind = 'newListings' | 'applicationReminders' | 'favoriteGone' | 'email';

export interface NotificationPreferences {
  /** Une annonce entre dans vos critères. C'est la raison d'être de l'outil. */
  readonly newListings: boolean;
  /** Un favori mis de côté et jamais contacté : le marché ne patiente pas. */
  readonly applicationReminders: boolean;
  /** Un favori a disparu de sa source — il est probablement loué. */
  readonly favoriteGone: boolean;
  /** Doubler les alertes par e-mail. PAS ENCORE EN SERVICE (voir ci-dessous). */
  readonly email: boolean;
}

/**
 * Tout allumé — sauf l'e-mail.
 *
 * L'envoi d'e-mails n'est pas branché : l'afficher actif promettrait des
 * messages qui n'arriveraient jamais, ce qui est exactement le genre de valeur
 * inventée qu'on s'interdit (§17). Il apparaît dans l'écran, éteint et annoncé
 * comme à venir, parce que le savoir possible vaut mieux que le découvrir
 * absent.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  newListings: true,
  applicationReminders: true,
  favoriteGone: true,
  email: false,
};

/**
 * Clé dans `app_settings`.
 *
 * CONTRAT INTER-PROCESSUS, comme les critères : la collecte la lit pour savoir
 * quoi envoyer, le site l'écrit. Ils n'ont aucun autre point de rencontre.
 */
export const NOTIFICATION_PREFERENCES_SETTING = 'notificationPreferences';

/**
 * Relit ce qui est stocké, en complétant par les défauts.
 *
 * Tolérante par construction : une préférence écrite par une version plus
 * ancienne ne connaît pas les familles ajoutées depuis. Refuser l'ensemble
 * couperait alors des alertes que personne n'a demandé de couper (§69).
 */
export function parseNotificationPreferences(value: unknown): NotificationPreferences {
  if (value === null || typeof value !== 'object') return DEFAULT_NOTIFICATION_PREFERENCES;
  const stored = value as Record<string, unknown>;
  const read = (key: NotificationKind): boolean =>
    typeof stored[key] === 'boolean' ? stored[key] : DEFAULT_NOTIFICATION_PREFERENCES[key];

  return {
    newListings: read('newListings'),
    applicationReminders: read('applicationReminders'),
    favoriteGone: read('favoriteGone'),
    // L'e-mail reste éteint tant qu'il n'est pas branché, même si la base dit
    // l'inverse : une préférence enregistrée ne fait pas exister un envoi.
    email: false,
  };
}
