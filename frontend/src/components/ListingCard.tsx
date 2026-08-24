/**
 * Carte d'annonce de la liste principale (§36).
 *
 * Elle doit répondre en un coup d'œil, sur téléphone, à « dois-je contacter
 * cette annonce maintenant ? ». Tout ce qui n'aide pas à cette décision est
 * renvoyé à la fiche détaillée.
 */

import type { ListingView } from '../types.js';
import {
  formatAddress,
  formatAge,
  formatArea,
  formatAvailability,
  formatCity,
  formatDuration,
  formatPrice,
  formatPropertyType,
  formatRooms,
  formatSourceName,
  formatTracking,
} from '../format.js';
import { AFFINITY_BADGE_THRESHOLD } from '../affinity.js';
import { PhotoCarousel } from './PhotoCarousel.js';
import { ScoreRow } from './Scores.js';
import { Badge } from '@/components/ui/badge.js';
import { Button, ButtonLink } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';

interface ListingCardProps {
  readonly listing: ListingView;
  readonly nowMs: number;
  readonly onOpen: (id: string) => void;
  /** Marque l'annonce consultée sans naviguer (clic « Voir l'annonce »). */
  readonly onView?: (id: string) => void;
  /** Archive (`true`) ou désarchive (`false`) l'annonce. */
  readonly onArchive?: (archived: boolean) => void;
  /** Met (`true`) ou retire (`false`) l'annonce des favoris. */
  readonly onFavorite?: (favorite: boolean) => void;
  /** Score d'affinité [0,1] avec vos préférences, si assez de signal (§33). */
  readonly affinity?: number;
}

/**
 * Palier de priorité → couleurs, pour que le classement se lise sans réfléchir.
 * Les classes sont écrites en toutes lettres : Tailwind ne génère que les noms
 * de classe qu'il voit littéralement dans le source (pas d'interpolation).
 */
function priorityTier(priority: number): { text: string; bg: string; label: string } {
  if (priority >= 85) return { text: 'text-hot', bg: 'bg-hot/10', label: 'à contacter' };
  if (priority >= 70) return { text: 'text-good', bg: 'bg-good/10', label: 'à voir' };
  return { text: 'text-muted-foreground', bg: 'bg-muted-foreground/10', label: 'priorité' };
}

/**
 * Pastille de priorité d'action (§36). En `overlay` (posée sur la photo, coin
 * haut-droit), le fond devient opaque et ombré pour rester lisible sur l'image ;
 * sinon fond teinté léger (carte sans photo).
 */
function PriorityBadge({
  priority,
  overlay,
}: {
  readonly priority: number;
  readonly overlay: boolean;
}): React.JSX.Element {
  const tier = priorityTier(priority);
  const isHot = priority >= 85;
  const skin = overlay
    ? `${tier.text} bg-card/90 shadow-md ring-1 ring-border backdrop-blur`
    : `${tier.text} ${tier.bg}`;
  return (
    <div className={`flex w-14 shrink-0 flex-col items-center rounded-lg py-1.5 ${skin}`}>
      <span className="text-[1.6rem] leading-none font-bold">{priority}</span>
      <span className="mt-0.5 text-center text-[0.6rem] leading-tight tracking-wide uppercase">
        {isHot && <span aria-hidden="true">🔥 </span>}
        {tier.label}
      </span>
    </div>
  );
}

/**
 * Pastilles de statut, empilées par ordre de priorité. « Loué » prime sur tout
 * (§32) ; le suivi n'affiche qu'un seul statut, le plus avancé (« Consultée »
 * seulement si aucune action n'a suivi). Isolé de `ListingCard` pour la clarté.
 */
function StatusBadges({
  listing,
  rented,
  archived,
  affinity,
}: {
  readonly listing: ListingView;
  readonly rented: boolean;
  readonly archived: boolean;
  readonly affinity: number | undefined;
}): React.JSX.Element {
  const showAffinity =
    affinity !== undefined && affinity >= AFFINITY_BADGE_THRESHOLD && !archived && !rented;
  return (
    <>
      {rented && <Badge variant="bad">Loué</Badge>}
      {/* Absente de sa source au dernier passage : probablement retirée (§32). */}
      {listing.lifecycle === 'possiblyInactive' && !rented && (
        <Badge variant="warning">Peut-être retirée</Badge>
      )}
      {archived && !rented && <Badge variant="warning">Archivée</Badge>}
      {showAffinity && <Badge variant="good">Vos préférences</Badge>}
      {listing.tracking !== 'new' ? (
        <Badge>{formatTracking(listing.tracking)}</Badge>
      ) : (
        listing.viewed === true && !archived && <Badge>Consultée</Badge>
      )}
      {listing.priceDropped === true && <Badge variant="good">Prix en baisse</Badge>}
      {listing.flatShare?.value === true && <Badge variant="warning">Colocation</Badge>}
    </>
  );
}

/**
 * Barre d'actions d'une carte : « Voir l'annonce » ouvre l'annonce D'ORIGINE
 * (nouvel onglet) ; « Contacter » ouvre la fiche interne ; archivage optionnel.
 */
function CardActions({
  listing,
  sourceUrl,
  archived,
  onOpen,
  onView,
  onArchive,
}: {
  readonly listing: ListingView;
  readonly sourceUrl: string | null;
  readonly archived: boolean;
  readonly onOpen: (id: string) => void;
  readonly onView?: (id: string) => void;
  readonly onArchive?: (archived: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="mt-3 flex gap-2">
      {sourceUrl !== null ? (
        <ButtonLink
          variant="outline"
          className="flex-1"
          href={sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => onView?.(listing.id)}
        >
          Voir l’annonce
        </ButtonLink>
      ) : (
        <Button variant="outline" className="flex-1" onClick={() => onOpen(listing.id)}>
          Voir
        </Button>
      )}
      <Button className="flex-1" onClick={() => onOpen(listing.id)}>
        Contacter
      </Button>
      {onArchive !== undefined && (
        <Button
          variant="ghost"
          onClick={() => onArchive(!archived)}
          title={archived ? 'Désarchiver' : 'Archiver'}
          aria-label={archived ? 'Désarchiver' : 'Archiver'}
        >
          {archived ? '↩' : '🗄'}
        </Button>
      )}
    </div>
  );
}

/** Localisation la plus précise disponible : rue > quartier > (rien). */
function pickNeighborhood(listing: ListingView): string | null {
  const street = listing.address.value !== null ? formatAddress(listing.address.value) : null;
  return street ?? listing.district?.value ?? null;
}

/** En-tête d'une carte : titre (rue ou ville), sous-ligne ville/CP, prix. */
function CardHeading({
  listing,
  neighborhood,
  cityLine,
}: {
  readonly listing: ListingView;
  readonly neighborhood: string | null;
  readonly cityLine: string;
}): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1">
      {/* La RUE prime dans le titre quand on l'a (plus utile que « Nice »,
          toujours identique) ; sinon la ville. La ville/CP reste en dessous. */}
      <h2 className="truncate text-base font-semibold">
        {formatPropertyType(listing.propertyType.value)} ·{' '}
        {neighborhood ?? formatCity(listing.city.value)}
      </h2>
      {neighborhood !== null && (
        <p className="truncate text-[0.8rem] text-muted-foreground">{cityLine}</p>
      )}
      <p className="mt-1 flex items-baseline gap-1.5">
        <strong className="text-xl font-extrabold tracking-tight">
          {formatPrice(listing.price.value)}
        </strong>
        <span className="text-[0.9rem] text-muted-foreground">
          {formatArea(listing.area.value)} · {formatRooms(listing.rooms.value)}
        </span>
      </p>
    </div>
  );
}

export function ListingCard({
  listing,
  nowMs,
  onOpen,
  onView,
  onArchive,
  onFavorite,
  affinity,
}: ListingCardProps): React.JSX.Element {
  const sources = [...new Set(listing.occurrences.map((occurrence) => occurrence.sourceId))];
  // Lien direct vers l'annonce d'origine (première occurrence) — le « Voir »
  // ouvre l'agence, pas la fiche interne.
  const sourceUrl = listing.occurrences[0]?.sourceUrl ?? null;
  const isHot = listing.actionPriority >= 85;
  const archived = listing.archived === true;
  const rented = listing.rented === true;
  const uncertain = listing.lifecycle === 'possiblyInactive';
  const favorite = listing.favorite === true;
  const publishedAt = listing.publishedAt.value;
  // Localisation la plus précise pour le titre : rue si connue, sinon quartier
  // (ex. Orpi « Madeleine »), sinon la ville seule.
  const neighborhood = pickNeighborhood(listing);
  // Sous-ligne ville + code postal (affichée sous le titre quand la rue/quartier
  // occupe le titre). Précalculée pour garder le rendu simple.
  const postal = listing.postalCode?.value ?? null;
  const cityLine = `${formatCity(listing.city.value)}${postal !== null ? ` ${postal}` : ''}`;

  // La carte reste épurée : pas de pastilles DPE/atouts (réservées à la
  // fiche) ; seule la disponibilité, décisive pour agir, est affichée.
  const availability = formatAvailability(listing.availableAt.value, nowMs);

  // Photos, affichées directement depuis le site d'origine (§11 : jamais
  // téléchargées ni stockées) et défilables sur la carte même. Certaines
  // sources listent la même photo en plusieurs tailles (/original/,
  // /1600xauto/, /640x480/…) : on dédoublonne sur l'URL débarrassée de son
  // segment de taille pour ne pas montrer deux fois la même image. Sans photo,
  // la carte reste purement textuelle.
  const seenPhotoKeys = new Set<string>();
  const photos = (listing.imageUrls ?? [])
    .filter((url) => {
      const key = url.replace(/\/(original|\d+x(?:auto|\d+)|auto x\d+|thumb\w*)\//i, '/');
      if (seenPhotoKeys.has(key)) return false;
      seenPhotoKeys.add(key);
      return true;
    })
    .slice(0, 6);

  return (
    <Card
      className={`overflow-hidden transition-shadow hover:shadow-md ${
        isHot && !rented ? 'border-2 border-hot' : ''
      } ${archived || rented ? 'opacity-60' : uncertain ? 'opacity-70' : ''} ${
        rented ? 'grayscale' : ''
      }`}
      data-testid="listing-card"
    >
      {/* Score de priorité en overlay, coin haut-droit de l'image (§36). Sans
          photo, il reprend sa place en tête de carte. */}
      {photos.length > 0 ? (
        <div className="relative">
          <PhotoCarousel urls={photos} />
          <div className="absolute top-2 right-2 z-10">
            <PriorityBadge priority={listing.actionPriority} overlay />
          </div>
        </div>
      ) : null}
      <header className="flex items-start gap-3">
        {photos.length === 0 && <PriorityBadge priority={listing.actionPriority} overlay={false} />}

        <CardHeading listing={listing} neighborhood={neighborhood} cityLine={cityLine} />

        <span className="flex shrink-0 flex-col items-end gap-1">
          {onFavorite !== undefined && (
            <button
              type="button"
              onClick={() => onFavorite(!favorite)}
              title={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              aria-label={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              aria-pressed={favorite}
              className={`-mt-1 cursor-pointer text-xl leading-none transition-colors ${
                favorite ? 'text-hot' : 'text-muted-foreground hover:text-hot'
              }`}
            >
              {favorite ? '★' : '☆'}
            </button>
          )}
          <StatusBadges listing={listing} rented={rented} archived={archived} affinity={affinity} />
        </span>
      </header>

      <ScoreRow scores={listing.scores} />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.85rem] text-muted-foreground">
        <span>
          {publishedAt === null
            ? `Découverte ${formatAge(listing.firstSeenAt, nowMs)}`
            : `Publiée ${formatAge(publishedAt, nowMs)}`}
        </span>
        {availability !== null && <span className="text-foreground">{availability}</span>}
        {/* §20 : durée (transport réel si dispo, sinon estimée) + vol d'oiseau. */}
        {listing.distances.map((distance) => (
          <span key={distance.label} className="text-foreground">
            <span className="text-muted-foreground">{distance.label} </span>
            {distance.durationSource === 'transit' && (
              <span aria-hidden="true" title="Temps réel en transports en commun">
                🚆{' '}
              </span>
            )}
            {formatDuration(distance.durationMinutes)}
            <span className="text-muted-foreground">
              {' '}
              ({distance.distanceKm} km à vol d’oiseau)
            </span>
          </span>
        ))}
      </div>

      {/* §13, §38 : d'où vient l'annonce et combien de fois elle circule. */}
      <p className="mt-1 text-[0.85rem] text-muted-foreground">
        {sources.length === 1 ? '1 source' : `${sources.length} sources`} ·{' '}
        {sources.map(formatSourceName).join(', ')}
      </p>

      <CardActions
        listing={listing}
        sourceUrl={sourceUrl}
        archived={archived}
        onOpen={onOpen}
        onView={onView}
        onArchive={onArchive}
      />
    </Card>
  );
}
