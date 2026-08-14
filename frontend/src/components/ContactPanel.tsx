/**
 * Préparation du contact — MODE MANUEL (§22).
 *
 * GARANTIE CENTRALE : ce composant n'envoie jamais rien tout seul.
 *
 * Il affiche les coordonnées disponibles, compose un message, et propose
 * quatre actions que seul l'utilisateur peut déclencher :
 *   [Modifier] éditer le texte
 *   [Copier]   mettre dans le presse-papiers
 *   [Ouvrir]   ouvrir le client mail, le téléphone ou le formulaire
 *   [Envoyé]   consigner que le contact a eu lieu (§33, §35)
 *
 * Le bouton « Envoyé » ne transmet aucun message : il enregistre le fait que
 * l'utilisateur a agi, pour le suivi et les statistiques.
 */

import { useMemo, useState } from 'react';
import { prepareMessage, type TenantProfile } from '@rentfinder/shared';
import type { ListingView } from '../types.js';

interface ContactPanelProps {
  readonly listing: ListingView;
  readonly profile: TenantProfile | null;
  readonly onRecorded: (channel: string, message: string) => void;
  readonly onConfigureProfile: () => void;
}

/** Construit le lien à ouvrir selon le canal disponible. */
function actionLink(
  channel: string,
  recipient: string | null,
  subject: string,
  body: string,
): string | null {
  if (recipient === null) return null;
  if (channel === 'email') {
    return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  if (channel === 'phone') return `tel:${recipient}`;
  if (channel === 'form') return recipient;
  return null;
}

export function ContactPanel({
  listing,
  profile,
  onRecorded,
  onConfigureProfile,
}: ContactPanelProps): React.JSX.Element {
  const prepared = useMemo(
    () => (profile === null ? null : prepareMessage(listing, profile)),
    [listing, profile],
  );

  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const { phone, email, formUrl, name, agencyName } = listing.contact;
  const hasAnyContact = phone !== null || email !== null || formUrl !== null;

  const message = draft ?? prepared?.body ?? '';
  const subject = prepared?.subject ?? '';
  const channel = prepared?.channel ?? 'manual';
  const link = actionLink(channel, prepared?.recipient ?? null, subject, message);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé : le texte reste sélectionnable dans la zone.
    }
  };

  return (
    <section className="contact" aria-labelledby="contact-title">
      <h3 id="contact-title">Contact</h3>

      {/* §21 : afficher ce qui est publiquement disponible, et sa source. */}
      <dl className="contact__details">
        {name !== null && (
          <>
            <dt>Interlocuteur</dt>
            <dd>{name}</dd>
          </>
        )}
        {agencyName !== null && (
          <>
            <dt>Agence</dt>
            <dd>{agencyName}</dd>
          </>
        )}
        {phone !== null && (
          <>
            <dt>Téléphone</dt>
            <dd>
              <a href={`tel:${phone}`}>{phone}</a>
            </dd>
          </>
        )}
        {email !== null && (
          <>
            <dt>E-mail</dt>
            <dd>
              <a href={`mailto:${email}`}>{email}</a>
            </dd>
          </>
        )}
        {formUrl !== null && (
          <>
            <dt>Formulaire</dt>
            <dd>
              <a href={formUrl} target="_blank" rel="noreferrer noopener">
                Ouvrir le formulaire de l’annonce
              </a>
            </dd>
          </>
        )}
      </dl>

      {listing.contact.providedBy.length > 0 && (
        <p className="contact__provenance">
          Coordonnées issues de : {listing.contact.providedBy.join(', ')}
        </p>
      )}

      {/* §17 : ne pas faire croire à une coordonnée qui n'existe pas. */}
      {!hasAnyContact && (
        <p className="contact__empty">
          Aucune coordonnée n’est publiée par les sources. Ouvrez l’annonce d’origine pour utiliser
          le canal prévu par le site.
        </p>
      )}

      {profile === null ? (
        <div className="contact__profile-missing">
          <p>
            Renseignez votre profil locataire pour générer un message. Il reste stocké uniquement
            sur cet appareil et n’est jamais transmis.
          </p>
          <button type="button" className="btn btn--secondary" onClick={onConfigureProfile}>
            Configurer mon profil
          </button>
        </div>
      ) : (
        <>
          <label className="contact__label" htmlFor="contact-message">
            Message préparé
          </label>
          <textarea
            id="contact-message"
            className="contact__message"
            value={message}
            readOnly={!editing}
            rows={10}
            onChange={(event) => setDraft(event.target.value)}
          />

          <p className="contact__notice">
            Rien n’est envoyé automatiquement. Vous déclenchez l’envoi vous-même.
          </p>

          <div className="contact__actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? 'Terminer' : 'Modifier'}
            </button>

            <button type="button" className="btn btn--secondary" onClick={() => void handleCopy()}>
              {copied ? 'Copié' : 'Copier'}
            </button>

            {link !== null && (
              <a
                className="btn btn--secondary"
                href={link}
                target={channel === 'form' ? '_blank' : undefined}
                rel="noreferrer noopener"
              >
                Ouvrir
              </a>
            )}

            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onRecorded(channel, message)}
            >
              J’ai envoyé
            </button>
          </div>
        </>
      )}
    </section>
  );
}
