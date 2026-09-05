/**
 * Envoi d'e-mails transactionnels depuis le Worker (§24, §26).
 *
 * UN SEUL USAGE POUR L'INSTANT : le lien de réinitialisation de mot de passe.
 * Rien d'autre ne part d'ici — les messages aux agences restent envoyés par
 * l'utilisateur lui-même, depuis son propre client (§24), et cela ne change
 * pas.
 *
 * POURQUOI UNE API HTTP ET NON SMTP. Un Worker Cloudflare ne peut pas ouvrir de
 * connexion TCP arbitraire : SMTP lui est fermé. Le collecteur, lui, pourrait —
 * mais il ne tourne que sur minuterie, toutes les demi-heures au mieux et en
 * pratique toutes les deux à quatre heures : personne n'attend son mot de passe
 * aussi longtemps. Il faut donc une API appelable en HTTP.
 *
 * POURQUOI RESEND. Palier gratuit sans carte bancaire — la contrainte du projet
 * (§30) —, trois mille messages par mois, et une API d'une seule requête. Son
 * expéditeur de démarrage fonctionne sans posséder de domaine, ce qui permet de
 * s'en servir tout de suite.
 *
 * LE FOURNISSEUR EST ISOLÉ DANS CE FICHIER, et c'est délibéré : `sendEmail` est
 * la seule chose que le reste du Worker connaît. En changer revient à réécrire
 * `postToResend`, une vingtaine de lignes, sans toucher au flux de
 * réinitialisation.
 *
 * NON CONFIGURÉ = ON LE DIT. Sans clé d'API, `sendEmail` rend `false` au lieu
 * de faire semblant. L'écran affiche alors que la fonctionnalité n'est pas
 * disponible, plutôt que « un message vous a été envoyé » pour un message qui
 * ne partira jamais (§17) — l'utilisateur attendrait, rafraîchirait sa boîte,
 * et n'aurait aucun moyen de comprendre.
 */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Corps en texte brut. Aucun HTML : rien ici n'a besoin de mise en forme. */
  readonly text: string;
}

export interface MailerEnv {
  /** Clé d'API du fournisseur d'envoi. Absente = envoi désactivé. */
  readonly EMAIL_API_KEY?: string;
  /** Expéditeur, ex. `Maïoun <compte@example.invalid>`. */
  readonly EMAIL_FROM?: string;
}

/** `true` si l'envoi est configuré — donc si l'on peut promettre un message. */
export function mailerConfigured(env: MailerEnv): boolean {
  return (
    env.EMAIL_API_KEY !== undefined &&
    env.EMAIL_API_KEY.trim() !== '' &&
    env.EMAIL_FROM !== undefined &&
    env.EMAIL_FROM.trim() !== ''
  );
}

/**
 * Envoie un message. `false` si l'envoi n'est pas configuré ou a échoué.
 *
 * NE LÈVE JAMAIS (§69). Un fournisseur indisponible ne doit pas transformer une
 * demande de réinitialisation en erreur 500 : l'appelant décide quoi dire, et
 * il n'a de toute façon rien de mieux à répondre qu'« essayez plus tard ».
 */
export async function sendEmail(env: MailerEnv, message: EmailMessage): Promise<boolean> {
  if (!mailerConfigured(env)) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.EMAIL_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
