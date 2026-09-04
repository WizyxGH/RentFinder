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
import { formatArea, formatPhone, formatPrice, formatSourceName, telHref } from '../format.js';
import {
  FOLLOW_UP_TEMPLATE,
  portalLabel,
  prepareMessage,
  type TenantProfile,
} from '@rentfinder/shared';
import type { ListingView, OccurrenceView } from '../types.js';
import { fetchDocuments, isDemoMode, type DocumentInfo } from '../api/client.js';
import { Button, ButtonLink } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { ChevronRight } from 'lucide-react';

interface ContactPanelProps {
  readonly listing: ListingView;
  readonly profile: TenantProfile | null;
  readonly onRecorded: (channel: string, message: string, documents: readonly string[]) => void;
  readonly onConfigureProfile: () => void;
  /** Ouvre la fiche de la source : ses infos et ses annonces actives. */
  readonly onOpenSource?: (sourceId: string) => void;
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

/** Libellé du bouton d'ouverture, explicite selon le canal disponible. */
function openButtonLabel(channel: string, recipient: string | null): string {
  if (channel === 'email') return 'Ouvrir l’e-mail';
  if (channel === 'phone') return 'Appeler';
  if (channel === 'form') {
    const portal = portalLabel(recipient);
    return portal !== null ? `Contacter via ${portal}` : 'Ouvrir le formulaire';
  }
  return 'Ouvrir';
}

/**
 * Coordonnées publiques du bien et leur provenance (§21). Affiche ce qui est
 * réellement publié — jamais une coordonnée inventée (§17). Isolé de
 * `ContactPanel` pour la clarté.
 */
/** « Foncia » et « foncia » désignent la même source. */
function sameName(a: string | undefined, b: string): boolean {
  const plain = (v: string): string =>
    v
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  return a !== undefined && plain(a) === plain(b);
}

/**
 * Une occurrence : la source, en lien vers l'annonce d'origine.
 *
 * Le loyer et la surface ne sont rappelés QUE s'ils diffèrent de ceux retenus
 * plus haut. Les répéter à l'identique sous chaque source encombrait la fiche
 * d'une information déjà lue trois lignes au-dessus ; les taire quand elles
 * divergent, en revanche, masquerait un désaccord entre sources (§15).
 */
function SourceRow({
  occurrence,
  price,
  area,
  onOpenSource,
}: {
  readonly occurrence: OccurrenceView;
  readonly price: number | null;
  readonly area: number | null;
  readonly onOpenSource?: (sourceId: string) => void;
}): React.JSX.Element {
  const differs = occurrence.price !== price || occurrence.area !== area;
  return (
    <>
      <a
        href={occurrence.sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="text-primary underline"
      >
        {formatSourceName(occurrence.sourceId)}
      </a>
      {/* Le nom ouvre l'annonce chez la source ; la flèche ouvre la fiche de
        la source ICI — ses coordonnées, sa santé, et tout ce qu'elle propose
        d'autre en ce moment. Deux destinations, deux cibles distinctes. */}
      {onOpenSource !== undefined && (
        <button
          type="button"
          onClick={() => onOpenSource(occurrence.sourceId)}
          aria-label={`Voir toutes les annonces de ${formatSourceName(occurrence.sourceId)}`}
          title={`Voir toutes les annonces de ${formatSourceName(occurrence.sourceId)}`}
          className="text-muted-foreground hover:text-primary ml-1 cursor-pointer align-middle transition-colors"
        >
          <ChevronRight aria-hidden="true" className="inline size-4" />
        </button>
      )}
      {differs && (
        <span className="text-muted-foreground">
          {' '}
          — {formatPrice(occurrence.price)}, {formatArea(occurrence.area)}
        </span>
      )}
    </>
  );
}

function ContactDetails({
  listing,
  hasAnyContact,
  onOpenSource,
}: {
  readonly listing: ListingView;
  readonly hasAnyContact: boolean;
  readonly onOpenSource?: (sourceId: string) => void;
}): React.JSX.Element {
  const { name, agencyName, phone, email, formUrl, providedBy } = listing.contact;
  // La source qui a fourni ces coordonnées, à défaut la première occurrence.
  const contactSource = providedBy[0] ?? listing.occurrences[0]?.sourceId ?? null;
  const openSource =
    onOpenSource !== undefined && contactSource !== null
      ? (): void => onOpenSource(contactSource)
      : null;
  const occurrences = listing.occurrences;
  // Le formulaire mène souvent à l'annonce elle-même : la ligne « Source »
  // ci-dessous porte alors déjà ce lien, et la répéter n'apprend rien (§15).
  const formIsSource = formUrl !== null && occurrences.some((o) => o.sourceUrl === formUrl);
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
            <dd>
              {/* Le nom mène à SA PAGE ICI : ses coordonnées, l'état de sa
                collecte, et toutes ses annonces actives — ce qu'on veut avant
                d'appeler.

                Il ouvrait auparavant la page d'ACCUEIL de l'agence, ce qui
                trompait deux fois : on croyait retomber sur l'annonce, et on
                arrivait sur un site à parcourir. Le lien vers l'annonce
                d'origine existe, une ligne plus bas, sous « Source ». */}
              {openSource === null ? (
                agencyName
              ) : (
                <button
                  type="button"
                  onClick={openSource}
                  className="text-primary cursor-pointer underline"
                  title={`Voir ${agencyName} et ses annonces`}
                >
                  {agencyName}
                </button>
              )}
            </dd>
          </>
        )}
        {phone !== null && (
          <>
            <dt className="text-muted-foreground">Téléphone</dt>
            <dd>
              <a href={telHref(phone)}>{formatPhone(phone)}</a>
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
        {formUrl !== null && !formIsSource && (
          <>
            <dt className="text-muted-foreground">Formulaire</dt>
            <dd>
              <a
                href={formUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline"
              >
                Ouvrir sur le site
              </a>
            </dd>
          </>
        )}

        {/* §38 : d'où vient l'annonce, avec le lien d'origine. Cette section
          vivait seule en bas de fiche, entre le statut et la description ;
          c'est pourtant une coordonnée comme les autres — le canal par lequel
          on joint le bien. */}
        {occurrences.length > 0 && (
          <>
            <dt className="text-muted-foreground">
              {occurrences.length > 1 ? 'Sources' : 'Source'}
            </dt>
            <dd data-testid="listing-sources">
              {occurrences.map((occurrence) => (
                <span key={occurrence.id} className="block">
                  <SourceRow
                    occurrence={occurrence}
                    price={listing.price.value}
                    area={listing.area.value}
                    onOpenSource={onOpenSource}
                  />
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>

      {/* La provenance ne s'affiche que si elle APPREND quelque chose : quand
        l'agence est déjà nommée au-dessus, « issues de : foncia » ne fait que
        répéter la même ligne (§15). */}
      {providedBy.length > 0 &&
        !(
          providedBy.length === 1 &&
          agencyName !== null &&
          sameName(providedBy[0], agencyName)
        ) && <p className={MUTED_NOTE}>Coordonnées issues de : {providedBy.join(', ')}</p>}

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
  onOpenSource,
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
  const openLabel = openButtonLabel(channel, prepared?.recipient ?? null);

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

      <ContactDetails listing={listing} hasAnyContact={hasAnyContact} onOpenSource={onOpenSource} />

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
                // Un formulaire web ne se pré-remplit pas : le message doit être
                // collé à la main. On le met donc au presse-papiers AU MOMENT
                // d'ouvrir, pour qu'il soit prêt quand le formulaire s'affiche —
                // sinon il fallait penser à « Copier » d'abord, et revenir.
                onClick={channel === 'form' ? () => void handleCopy() : undefined}
              >
                {openLabel}
              </ButtonLink>
            )}

            <Button onClick={() => onRecorded(channel, message, [...selected])}>J’ai envoyé</Button>
          </div>

          {channel === 'form' && <FormHint copied={copied} />}
        </>
      )}
    </Card>
  );
}

/** Rappel affiché sous les boutons quand le seul canal est un formulaire web. */
function FormHint({ copied }: { readonly copied: boolean }): React.JSX.Element {
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      {copied
        ? 'Message copié — il ne reste qu’à le coller dans le formulaire.'
        : 'Ouvrir le formulaire copie le message : plus qu’à le coller.'}
    </p>
  );
}
