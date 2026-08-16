/**
 * Fiche détaillée d'une annonce (§37, §38).
 *
 * Elle doit permettre d'AGIR vite : les coordonnées et le message sont en haut,
 * le détail des scores et l'historique en dessous.
 */

import type { TenantProfile } from '@rentfinder/shared';
import type { ListingView, TrackingStatus } from '../types.js';
import {
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
} from '../format.js';
import { ScoreDetail } from './Scores.js';
import { ContactPanel } from './ContactPanel.js';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';

interface ListingDetailProps {
  readonly listing: ListingView;
  readonly profile: TenantProfile | null;
  readonly nowMs: number;
  readonly onBack: () => void;
  readonly onTrackingChange: (status: TrackingStatus) => void;
  readonly onContactRecorded: (channel: string, message: string) => void;
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

/** Grille étiquette/valeur utilisée par la fiche et le contact. */
const FACTS_GRID = 'mb-4 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[0.92rem]';
const FACT_LABEL = 'text-muted-foreground';

export function ListingDetail({
  listing,
  profile,
  nowMs,
  onBack,
  onTrackingChange,
  onContactRecorded,
  onConfigureProfile,
}: ListingDetailProps): React.JSX.Element {
  const charges = listing.charges.value;

  // Requête Maps : la localisation la plus précise disponible (§20). Adresse de
  // rue si connue, sinon ville + code postal.
  const mapsQuery = [
    listing.address.value,
    listing.postalCode.value,
    formatCity(listing.city.value),
  ]
    .filter((part): part is string => part !== null && part !== '' && part !== UNKNOWN)
    .join(', ');

  return (
    <div>
      <header className="mb-2 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Retour
        </Button>
        <span className="flex gap-2">
          {listing.priceDropped === true && <Badge variant="good">Prix en baisse</Badge>}
          {!listing.matchesCriteria && <Badge variant="warning">Hors critères de recherche</Badge>}
        </span>
      </header>

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

      <dl className={FACTS_GRID}>
        <dt className={FACT_LABEL}>Type</dt>
        <dd>{formatPropertyType(listing.propertyType.value)}</dd>

        <dt className={FACT_LABEL}>Meublé</dt>
        <dd>
          {listing.furnished.value === null ? UNKNOWN : listing.furnished.value ? 'Oui' : 'Non'}
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
        <dd>{listing.dpe?.value ? `Classe ${listing.dpe.value}` : UNKNOWN}</dd>

        <dt className={FACT_LABEL}>Localisation</dt>
        <dd>
          {formatCity(listing.city.value)}
          {listing.postalCode.value !== null && ` (${listing.postalCode.value})`}
          {listing.address.value !== null && ` — ${listing.address.value}`}
          {mapsQuery !== '' && (
            <>
              {' '}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
                target="_blank"
                rel="noreferrer noopener"
                className="whitespace-nowrap text-primary underline"
              >
                📍 Ouvrir dans Maps
              </a>
            </>
          )}
        </dd>

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

      {/* §20 : distances vers des points de référence privés, libellés neutres. */}
      {listing.distances.length > 0 && (
        <ul className="mb-4">
          {listing.distances.map((distance) => (
            <li key={distance.label}>
              <strong>{distance.label}</strong> : {formatDuration(distance.durationMinutes)}{' '}
              <span className="text-sm text-muted-foreground">
                ({distance.distanceKm} km à vol d’oiseau)
              </span>
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

      {/* §35 : suivi du statut. */}
      <section className="my-4 flex items-center gap-2">
        <label htmlFor="tracking-select">Statut</label>
        <select
          id="tracking-select"
          value={listing.tracking}
          onChange={(event) => onTrackingChange(event.target.value as TrackingStatus)}
        >
          {TRACKING_ORDER.map((status) => (
            <option key={status} value={status}>
              {formatTracking(status)}
            </option>
          ))}
        </select>
      </section>

      {/* §38 : toutes les sources, avec leurs URLs d'origine. */}
      <section data-testid="listing-sources">
        <h3 className="font-semibold">Cette annonce a été trouvée sur</h3>
        <ul className="mt-1.5 list-disc pl-5">
          {listing.occurrences.map((occurrence) => (
            <li key={occurrence.id}>
              <a href={occurrence.sourceUrl} target="_blank" rel="noreferrer noopener">
                {formatSourceName(occurrence.sourceId)}
              </a>
              <span className="text-sm text-muted-foreground">
                {' '}
                — {formatPrice(occurrence.price)}, {formatArea(occurrence.area)}
              </span>
            </li>
          ))}
        </ul>
      </section>

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
