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

import { useEffect, useMemo, useState } from 'react';
import { FOLLOW_UP_TEMPLATE, prepareMessage, type TenantProfile } from '@rentfinder/shared';
import type { ListingView } from '../types.js';
import { fetchDocuments, isDemoMode, type DocumentInfo } from '../api/client.js';
import { Button, ButtonLink } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';

interface ContactPanelProps {
  readonly listing: ListingView;
  readonly profile: TenantProfile | null;
  readonly onRecorded: (channel: string, message: string, documents: readonly string[]) => void;
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

const MUTED_NOTE = 'my-1.5 text-[0.82rem] text-muted-foreground';

/** Portail d'origine déduit de l'URL de contact (ex. lien SeLoger d'une alerte). */
function portalOf(url: string | null): string | null {
  if (url === null) return null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (/seloger\.com$/i.test(host)) return 'SeLoger';
  if (/bienici\.com$/i.test(host)) return "Bien'ici";
  if (/leboncoin\.fr$/i.test(host)) return 'Leboncoin';
  if (/pap\.fr$/i.test(host)) return 'PAP';
  return null;
}

/**
 * Coordonnées publiques du bien et leur provenance (§21). Affiche ce qui est
 * réellement publié — jamais une coordonnée inventée (§17). Isolé de
 * `ContactPanel` pour la clarté.
 */
function ContactDetails({
  contact,
  hasAnyContact,
}: {
  readonly contact: ListingView['contact'];
  readonly hasAnyContact: boolean;
}): React.JSX.Element {
  const { name, agencyName, phone, email, formUrl, providedBy } = contact;
  return (
    <>
      <dl className="mb-4 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[0.92rem]">
        {name !== null && (
          <>
            <dt className="text-muted-foreground">Interlocuteur</dt>
            <dd>{name}</dd>
          </>
        )}
        {agencyName !== null && (
          <>
            <dt className="text-muted-foreground">Agence</dt>
            <dd>{agencyName}</dd>
          </>
        )}
        {phone !== null && (
          <>
            <dt className="text-muted-foreground">Téléphone</dt>
            <dd>
              <a href={`tel:${phone}`}>{phone}</a>
            </dd>
          </>
        )}
        {email !== null && (
          <>
            <dt className="text-muted-foreground">E-mail</dt>
            <dd>
              <a href={`mailto:${email}`}>{email}</a>
            </dd>
          </>
        )}
        {formUrl !== null && (
          <>
            <dt className="text-muted-foreground">Formulaire</dt>
            <dd>
              <a href={formUrl} target="_blank" rel="noreferrer noopener">
                Ouvrir le formulaire de l’annonce
              </a>
            </dd>
          </>
        )}
      </dl>

      {providedBy.length > 0 && (
        <p className={MUTED_NOTE}>Coordonnées issues de : {providedBy.join(', ')}</p>
      )}

      {/* §17 : ne pas faire croire à une coordonnée qui n'existe pas. */}
      {!hasAnyContact && (
        <p className={MUTED_NOTE}>
          Aucune coordonnée n’est publiée par les sources. Ouvrez l’annonce d’origine pour utiliser
          le canal prévu par le site.
        </p>
      )}
    </>
  );
}

export function ContactPanel({
  listing,
  profile,
  onRecorded,
  onConfigureProfile,
}: ContactPanelProps): React.JSX.Element {
  // §34 : une annonce déjà contactée propose une RELANCE, brève, plutôt que
  // de regénérer le premier message.
  const [followUp, setFollowUp] = useState(false);
  const alreadyContacted = listing.tracking === 'contacted';

  // Lien direct de l'annonce (1re occurrence), inséré dans le brouillon.
  const sourceUrl = listing.occurrences[0]?.sourceUrl ?? null;
  const prepared = useMemo(
    () =>
      profile === null
        ? null
        : prepareMessage(
            { ...listing, sourceUrl },
            profile,
            followUp ? FOLLOW_UP_TEMPLATE : undefined,
          ),
    [listing, profile, followUp, sourceUrl],
  );

  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  // §25 : pièces disponibles à joindre. On les coche toutes par défaut — un
  // dossier se transmet en entier — et on consigne celles réellement envoyées.
  const [documents, setDocuments] = useState<readonly DocumentInfo[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (isDemoMode()) return;
    void fetchDocuments()
      .then((docs) => {
        setDocuments(docs);
        setSelected(new Set(docs.map((doc) => doc.name)));
      })
      .catch(() => {
        /* API locale indisponible : pas de pièces proposées */
      });
  }, []);

  const toggleDocument = (name: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const { phone, email, formUrl } = listing.contact;
  const hasAnyContact = phone !== null || email !== null || formUrl !== null;

  const message = draft ?? prepared?.body ?? '';
  const subject = prepared?.subject ?? '';
  const channel = prepared?.channel ?? 'manual';
  const link = actionLink(channel, prepared?.recipient ?? null, subject, message);
  // Libellé du bouton d'ouverture : explicite le canal (« Contacter via SeLoger »
  // pour un lien de portail, « Appeler », « Ouvrir l'e-mail »…).
  const portal = channel === 'form' ? portalOf(prepared?.recipient ?? null) : null;
  const openLabel =
    channel === 'email'
      ? 'Ouvrir l’e-mail'
      : channel === 'phone'
        ? 'Appeler'
        : portal !== null
          ? `Contacter via ${portal}`
          : channel === 'form'
            ? 'Ouvrir le formulaire'
            : 'Ouvrir';

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
    <Card className="my-4" aria-labelledby="contact-title" role="region">
      <h3 id="contact-title" className="mb-2.5 text-base font-semibold">
        Contact
      </h3>

      <ContactDetails contact={listing.contact} hasAnyContact={hasAnyContact} />

      {profile === null ? (
        <div>
          <p className="mb-2">
            Renseignez votre profil locataire pour générer un message. Il reste stocké uniquement
            sur cet appareil et n’est jamais transmis.
          </p>
          <Button variant="outline" onClick={onConfigureProfile}>
            Configurer mon profil
          </Button>
        </div>
      ) : (
        <>
          {/* §34 : déjà contactée et sans réponse → proposer la relance. */}
          {alreadyContacted && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-medium/50 px-3 py-2 text-sm">
              <span className="flex-1">
                Annonce déjà contactée{followUp ? ' — message de relance préparé.' : '.'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFollowUp((value) => !value);
                  setDraft(null);
                }}
              >
                {followUp ? 'Premier message' : 'Relancer'}
              </Button>
            </div>
          )}
          <label
            className="mt-2 block text-[0.85rem] text-muted-foreground"
            htmlFor="contact-message"
          >
            Message préparé
          </label>
          <textarea
            id="contact-message"
            className="w-full resize-y bg-background text-[0.92rem]"
            value={message}
            readOnly={!editing}
            rows={10}
            onChange={(event) => setDraft(event.target.value)}
          />

          <p className={MUTED_NOTE}>
            Rien n’est envoyé automatiquement. Vous déclenchez l’envoi vous-même.
          </p>

          {/* §25 : pièces à joindre. Cocher n'envoie rien — c'est une trace
              locale de ce que vous déclarez avoir transmis avec ce contact. */}
          {documents.length > 0 && (
            <fieldset className="mt-3 rounded-lg border border-border px-3 py-2">
              <legend className="px-1 text-[0.82rem] text-muted-foreground">
                Pièces jointes envoyées
              </legend>
              <ul className="flex flex-col gap-1">
                {documents.map((doc) => (
                  <li key={doc.name}>
                    <label className="flex items-center gap-2 text-[0.9rem]">
                      <input
                        type="checkbox"
                        checked={selected.has(doc.name)}
                        onChange={() => toggleDocument(doc.name)}
                      />
                      <span className="truncate">{doc.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing((value) => !value)}>
              {editing ? 'Terminer' : 'Modifier'}
            </Button>

            <Button variant="outline" onClick={() => void handleCopy()}>
              {copied ? 'Copié' : 'Copier'}
            </Button>

            {link !== null && (
              <ButtonLink
                variant="outline"
                href={link}
                target={channel === 'form' ? '_blank' : undefined}
                rel="noreferrer noopener"
              >
                {openLabel}
              </ButtonLink>
            )}

            <Button onClick={() => onRecorded(channel, message, [...selected])}>J’ai envoyé</Button>
          </div>
        </>
      )}
    </Card>
  );
}
