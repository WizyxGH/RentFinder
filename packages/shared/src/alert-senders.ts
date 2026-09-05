/**
 * Les portails dont on sait lire les alertes par e-mail (§6, §10).
 *
 * Ce module vit dans `shared` parce que DEUX composants en ont besoin, et qu'ils
 * doivent dire la même chose :
 *   - le COLLECTEUR, dont la recherche IMAP ne remonte que les messages venus
 *     de ces expéditeurs — c'est ce qui garantit que les messages personnels de
 *     l'utilisateur ne sont jamais lus (§26) ;
 *   - le SITE, qui affiche la liste à l'écran des réglages : c'est exactement
 *     elle qu'il faut recopier dans la règle de transfert de sa boîte.
 *
 * Les dupliquer garantirait qu'elles divergent (§75), et la divergence serait
 * silencieuse : l'écran conseillerait de transférer un expéditeur que le
 * collecteur ignore, et l'utilisateur attendrait des annonces qui ne
 * viendraient jamais.
 */

export interface AlertSender {
  /**
   * Fragment cherché dans l'adresse de l'expéditeur, en minuscules. Volontaire-
   * ment court : les portails changent de sous-domaine d'envoi sans prévenir.
   */
  readonly match: string;
  /** Nom du portail, tel qu'on le lit à l'écran. */
  readonly label: string;
}

export const ALERT_SENDERS: readonly AlertSender[] = [
  { match: 'leboncoin', label: 'Leboncoin' },
  { match: 'seloger', label: 'SeLoger' },
  { match: 'bienici', label: 'Bien’ici' },
  { match: 'bien-ici', label: 'Bien’ici' },
  { match: 'pap.fr', label: 'PAP' },
  { match: 'logic-immo', label: 'Logic-Immo' },
];

/** Les fragments seuls, pour la recherche IMAP. */
export const ALERT_SENDER_MATCHES: readonly string[] = ALERT_SENDERS.map((sender) => sender.match);

/** Les noms de portails, sans doublon, dans l'ordre d'affichage. */
export const ALERT_SENDER_LABELS: readonly string[] = [
  ...new Set(ALERT_SENDERS.map((sender) => sender.label)),
];
