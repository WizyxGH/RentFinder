/**
 * Fiche détaillée d'une annonce (§37, §38).
 *
 * Elle doit permettre d'AGIR vite : les coordonnées et le message sont en haut,
 * le détail des scores et l'historique en dessous.
 */

import { Fragment } from 'react';
import type { TenantProfile } from '@rentfinder/shared';
import type { ListingView, TrackingStatus } from '../types.js';
import {
  formatPostalAddress,
  formatAge,
  formatArea,
  formatCity,
  formatDuration,
  formatPrice,
  formatPropertyType,
  formatRooms,
  formatSourceName,
  formatTracking,
  TRACKING_ORDER,
  UNKNOWN,
  UNKNOWN_LABEL,
} from '../format.js';
import { ScoreDetail } from './Scores.js';
import { ContactPanel } from './ContactPanel.js';
import { PhotoCarousel } from './PhotoCarousel.js';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import { Archive, ArchiveRestore, ArrowLeft, Heart, MapPin, TrainFront } from 'lucide-react';

interface ListingDetailProps {
  readonly listing: ListingView;
  readonly profile: TenantProfile | null;
  readonly nowMs: number;
  readonly onBack: () => void;
  /** Archive (`true`) ou désarchive (`false`) l'annonce. */
  readonly onArchive?: (archived: boolean) => void;
  /** Met (`true`) ou retire (`false`) l'annonce des favoris. */
  readonly onFavorite?: (favorite: boolean) => void;
  readonly onTrackingChange: (status: TrackingStatus) => void;
  readonly onContactRecorded: (
    channel: string,
    message: string,
    documents: readonly string[],
  ) => void;
  readonly onConfigureProfile: () => void;
}

/** Affiche une valeur divergente entre sources plutôt que de la masquer (§15). */
function ConflictNote({
  conflicts,
  render,
}: {
  readonly conflicts: readonly { value: unknown; sourceId: string }[];
  readonly render: (value: unknown) => string;
}): React.JSX.Element | null {
  if (conflicts.length === 0) return null;
  return (
    <span
      className="text-[0.85rem] text-medium"
      title="Les sources ne s’accordent pas sur cette valeur"
    >
      {' '}
      (
      {conflicts.map((conflict, index) => (
        <span key={`${conflict.sourceId}-${index}`}>
          {index > 0 && ', '}
          {render(conflict.value)} selon {formatSourceName(conflict.sourceId)}
        </span>
      ))}
      )
    </span>
  );
}

/**
 * Suivi du statut (§35).
 *
 * Il vivait sous le bloc Contact, après une page entière de faits : on le
 * cherchait. Sa place est près du prix — c'est une ACTION sur l'annonce, pas
 * une de ses caractéristiques.
 */
function TrackingSelect({
  listing,
  onChange,
}: {
  readonly listing: ListingView;
  readonly onChange: (status: TrackingStatus) => void;
}): React.JSX.Element {
  return (
    <section className="mb-4 flex items-center gap-2">
      <label htmlFor="tracking-select" className="text-muted-foreground">
        Statut
      </label>
      <select
        id="tracking-select"
        value={listing.tracking}
        onChange={(event) => onChange(event.target.value as TrackingStatus)}
        className="rounded-lg border border-input bg-card px-2 py-1.5"
      >
        {TRACKING_ORDER.map((status) => (
          <option key={status} value={status}>
            {formatTracking(status)}
          </option>
        ))}
      </select>
    </section>
  );
}

/**
 * Les deux gestes qu'on porte sur une annonce : la retenir, l'écarter.
 *
 * La carte de liste ouvrant la fiche sur toute sa surface, elle ne peut plus
 * porter que le cœur ; et depuis une fiche ouverte par une notification, rien
 * ne permettait de retenir l'annonce sans revenir en arrière.
 */
function DetailActions({
  favorite,
  archived,
  onFavorite,
  onArchive,
}: {
  readonly favorite: boolean;
  readonly archived: boolean;
  readonly onFavorite?: (favorite: boolean) => void;
  readonly onArchive?: (archived: boolean) => void;
}): React.JSX.Element {
  return (
    <>
      {onFavorite !== undefined && (
        <Button
          variant="ghost"
          onClick={() => onFavorite(!favorite)}
          title={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          aria-label={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          aria-pressed={favorite}
          className={favorite ? 'text-hot' : undefined}
        >
          <Heart aria-hidden="true" className={`size-4 ${favorite ? 'fill-current' : ''}`} />
        </Button>
      )}
      {onArchive !== undefined && (
        <Button
          variant="ghost"
          onClick={() => onArchive(!archived)}
          title={archived ? 'Désarchiver' : 'Archiver'}
          aria-label={archived ? 'Désarchiver' : 'Archiver'}
        >
          {archived ? (
            <ArchiveRestore aria-hidden="true" className="size-4" />
          ) : (
            <Archive aria-hidden="true" className="size-4" />
          )}
        </Button>
      )}
    </>
  );
}

/** Grille étiquette/valeur utilisée par la fiche et le contact. */
const FACTS_GRID = 'mb-4 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[0.92rem]';
const FACT_LABEL = 'text-muted-foreground';

export function ListingDetail({
  listing,
  profile,
  nowMs,
  onBack,
  onArchive,
  onFavorite,
  onTrackingChange,
  onContactRecorded,
  onConfigureProfile,
}: ListingDetailProps): React.JSX.Element {
  const charges = listing.charges.value;
  const archived = listing.archived === true;
  const favorite = listing.favorite === true;

  // Requête Maps : la localisation la plus précise disponible (§20). Rue si
  // connue, sinon quartier, sinon ville + code postal.
  const mapsQuery = [
    listing.address.value ?? listing.district.value,
    listing.postalCode.value,
    formatCity(listing.city.value),
  ]
    .filter((part): part is string => part !== null && part !== '' && part !== UNKNOWN)
    .join(', ');

  return (
    <div>
      <header className="mb-2 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Retour
        </Button>
        <span className="flex items-center gap-2">
          {listing.priceDropped === true && <Badge variant="good">Prix en baisse</Badge>}
          {!listing.matchesCriteria && <Badge variant="warning">Hors critères de recherche</Badge>}
          <DetailActions
            favorite={favorite}
            archived={archived}
            {...(onFavorite !== undefined ? { onFavorite } : {})}
            {...(onArchive !== undefined ? { onArchive } : {})}
          />
        </span>
      </header>

      {/* Photos : affichées directement depuis le site d'origine (§11 : jamais
          téléchargées ni stockées). Le même carrousel que la carte de liste —
          flèches, points, une image à la fois — plutôt qu'un bandeau à faire
          glisser, dont rien n'indiquait qu'il continuait hors de l'écran. */}
      {listing.imageUrls.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-xl">
          <PhotoCarousel urls={listing.imageUrls.slice(0, 12)} tall />
        </div>
      )}

      <h1 className="mb-1 text-xl font-bold">{listing.title.value ?? 'Annonce sans titre'}</h1>

      <p className="mb-3 text-[1.05rem]">
        <strong>{formatPrice(listing.price.value)}</strong>
        <ConflictNote
          conflicts={listing.price.conflicts}
          render={(value) => formatPrice(value as number | null)}
        />
        {charges !== null && (
          <span className="text-sm text-muted-foreground"> + {charges} € de charges</span>
        )}
        <span aria-hidden="true"> · </span>
        {formatArea(listing.area.value)}
        <ConflictNote
          conflicts={listing.area.conflicts}
          render={(value) => formatArea(value as number | null)}
        />
        <span aria-hidden="true"> · </span>
        {formatRooms(listing.rooms.value)}
      </p>

      <TrackingSelect listing={listing} onChange={onTrackingChange} />

      <dl className={FACTS_GRID}>
        <dt className={FACT_LABEL}>Type</dt>
        <dd>{formatPropertyType(listing.propertyType.value)}</dd>

        <dt className={FACT_LABEL}>Meublé</dt>
        <dd>
          {listing.furnished.value === null
            ? UNKNOWN_LABEL
            : listing.furnished.value
              ? 'Oui'
              : 'Non'}
        </dd>

        <dt className={FACT_LABEL}>Colocation</dt>
        <dd>
          {listing.flatShare?.value == null
            ? UNKNOWN
            : listing.flatShare.value
              ? 'Oui'
              : 'Non — logement entier'}
        </dd>

        <dt className={FACT_LABEL}>DPE</dt>
        <dd>{listing.dpe?.value ? `Classe ${listing.dpe.value}` : UNKNOWN_LABEL}</dd>

        <dt className={FACT_LABEL}>Localisation</dt>
        <dd>
          {/* §20 : la localisation elle-même est le lien vers Maps — pas de
              lien « Ouvrir » séparé. */}
          {mapsQuery !== '' ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline"
              title="Ouvrir dans Maps"
            >
              <MapPin aria-hidden="true" className="inline size-4" />{' '}
              {formatPostalAddress({
                address: listing.address.value,
                postalCode: listing.postalCode.value,
                city: listing.city.value,
                district: listing.district.value,
              })}
            </a>
          ) : (
            formatPostalAddress({
              address: listing.address.value,
              postalCode: listing.postalCode.value,
              city: listing.city.value,
              district: listing.district.value,
            })
          )}
        </dd>

        {/* §20 : distances vers des points de référence privés, libellés
          neutres. Elles vivaient dans une liste à part, dans un style qui leur
          était propre ; ce sont des faits sur le logement comme les autres. */}
        {listing.distances.map((distance) => (
          <Fragment key={distance.label}>
            <dt className={FACT_LABEL}>{distance.label}</dt>
            <dd>
              {distance.durationSource === 'transit' && (
                <span aria-hidden="true" title="Temps réel en transports en commun">
                  <TrainFront aria-hidden="true" className="inline size-4" />{' '}
                </span>
              )}
              {formatDuration(distance.durationMinutes)}
              {distance.distanceKm !== undefined && (
                <span className="text-muted-foreground">
                  {' '}
                  ({distance.distanceKm} km à vol d’oiseau)
                </span>
              )}
            </dd>
          </Fragment>
        ))}

        <dt className={FACT_LABEL}>Publiée</dt>
        <dd>{formatAge(listing.publishedAt.value, nowMs)}</dd>

        <dt className={FACT_LABEL}>Disponible</dt>
        <dd>
          {listing.availableAt.value === null
            ? UNKNOWN
            : new Date(listing.availableAt.value).toLocaleDateString('fr-FR')}
        </dd>

        <dt className={FACT_LABEL}>Vue pour la première fois</dt>
        <dd>{formatAge(listing.firstSeenAt, nowMs)}</dd>
      </dl>

      {/* Atouts extraits de l'annonce (§17 : uniquement ce qui est mentionné). */}
      {listing.features !== undefined && listing.features.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-1.5">
          {listing.features.map((feature) => (
            <li
              key={feature}
              className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[0.8rem]"
            >
              {feature}
            </li>
          ))}
        </ul>
      )}

      {/* §22 : préparation du contact, en haut de page car c'est l'action utile. */}
      <ContactPanel
        listing={listing}
        profile={profile}
        onRecorded={onContactRecorded}
        onConfigureProfile={onConfigureProfile}
      />

      {listing.description.value !== null && (
        <section className="mt-4">
          <h3 className="font-semibold">Description</h3>
          <p className="whitespace-pre-wrap">{listing.description.value}</p>
        </section>
      )}

      <div className="mt-4 sm:grid sm:grid-cols-2 sm:gap-3">
        <ScoreDetail title="Correspondance" score={listing.scores.match} />
        <ScoreDetail title="Opportunité" score={listing.scores.opportunity} />
        <ScoreDetail
          title="Probabilité de visite"
          score={listing.scores.visitProbability}
          caveat="Indice fondé sur des règles explicites, pas sur une statistique. Il sert à comparer les annonces entre elles, pas à prédire un pourcentage réel."
        />
        <ScoreDetail title="Risque" score={listing.scores.risk} invert />
      </div>
    </div>
  );
}
