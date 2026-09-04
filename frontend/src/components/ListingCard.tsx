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
  formatDistrict,
  formatDuration,
  formatPrice,
  formatPropertyType,
  formatRooms,
  formatSourceName,
  formatTracking,
} from '../format.js';
import { AFFINITY_BADGE_THRESHOLD } from '../affinity.js';
import { PhotoCarousel } from './PhotoCarousel.js';
import { splitPhotos } from '../photos.js';
import { SHORT_TERM_LEASE_FEATURE, STUDENT_HOUSING_FEATURE } from '@rentfinder/shared';
import { Badge } from '@/components/ui/badge.js';
import { Card } from '@/components/ui/card.js';
import { Flame, Heart, TrainFront } from 'lucide-react';

interface ListingCardProps {
  readonly listing: ListingView;
  readonly nowMs: number;
  /**
   * Rang dans la liste, pour l'apparition en cascade. Absent = pas
   * d'animation d'entrée : c'est le cas d'une carte isolée.
   */
  readonly rank?: number;
  /** Ouvre la fiche. Toute la carte y mène — voir le commentaire du rendu. */
  readonly onOpen: (id: string) => void;
  /** Met (`true`) ou retire (`false`) l'annonce des favoris. */
  readonly onFavorite?: (favorite: boolean) => void;
  /** Score d'affinité [0,1] avec vos préférences, si assez de signal (§33). */
  readonly affinity?: number;
}

/**
 * Palier de priorité → libellé. La COULEUR, elle, ne varie plus : la barre est
 * verte partout, et c'est sa LONGUEUR qui compare deux annonces. Un dégradé de
 * teintes ajoutait un second code à déchiffrer pour la même information.
 *
 * Verte, parce qu'une priorité haute est une BONNE nouvelle — une annonce à
 * saisir, pas une alerte.
 */
/**
 * Score de risque à partir duquel l'annonce mérite un avertissement.
 *
 * Volontairement haut : un badge « suspect » posé à tort sur une annonce
 * honnête coûte plus qu'un badge manquant — on écarte un vrai logement.
 */
const SUSPICIOUS_RISK = 40;

function priorityLabel(priority: number): string {
  if (priority >= 85) return 'à contacter';
  if (priority >= 70) return 'à voir';
  return 'à étudier';
}

/**
 * Priorité d'action, en BARRE DE PROGRESSION (§36).
 *
 * La carte portait quatre anneaux de score — correspondance, opportunité,
 * visite, risque — plus une pastille de priorité : cinq chiffres à interpréter
 * pour une seule question, « dois-je contacter cette annonce maintenant ? ».
 * La priorité les résume déjà ; le détail des quatre reste sur la fiche, où
 * l'on vient précisément pour comprendre.
 *
 * Une barre plutôt qu'un nombre : deux cartes se comparent d'un coup d'œil,
 * sans lire, ce qu'un anneau de 48 px ne permettait pas.
 */
function PriorityBar({ priority }: { readonly priority: number }): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, priority));
  return (
    <div className="mt-2.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1 text-[0.68rem] font-semibold tracking-wide text-good uppercase">
          {priority >= 85 && <Flame aria-hidden="true" className="size-3.5" />}
          {priorityLabel(priority)}
        </span>
        {/* « 65/100 » et non « 65 » : le barème est ainsi dit, sans que
          l'utilisateur ait à deviner sur quoi la note est donnée. */}
        <span className="text-[0.95rem] leading-none font-bold text-good">
          {priority}
          <span className="text-[0.75rem] font-medium text-muted-foreground">/100</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Priorité d’action"
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-good transition-[width] duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>
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
      {/* « Trop beau pour être vrai ? » — le doute, pas le verdict, d'où le
        point d'interrogation : la fiche en donne les raisons, ligne à ligne.
        Ce badge attendait que le score cesse de se tromper. Il désignait 57
        annonces, dont 46 colocations dont on divisait le loyer d'une chambre
        par la surface de tout l'appartement, et pas une arnaque. La règle du
        €/m² ne s'applique plus à elles : il en reste onze, et le seuil de 40
        n'en retient que les plus douteuses. */}
      {listing.scores.risk.value >= SUSPICIOUS_RISK && <Badge variant="bad">Trop beau ?</Badge>}
      {listing.flatShare?.value === true && <Badge variant="warning">Colocation</Badge>}
      {/* Bail de neuf mois : le logement n'est pas louable l'été. Le taire
        laisserait croire à un logement à l'année (§17). */}
      {listing.features?.includes(SHORT_TERM_LEASE_FEATURE) === true && (
        <Badge variant="warning">Bail 9 mois</Badge>
      )}
      {/* Réservé aux étudiants : condition d'ACCÈS, pas argument de vente.
        Le badge ne s'affiche que sur les formes qui engagent la durée ou
        l'éligibilité — jamais sur un « idéal étudiant » (§17). */}
      {listing.features?.includes(STUDENT_HOUSING_FEATURE) === true && (
        <Badge variant="warning">Réservé aux étudiants</Badge>
      )}
    </>
  );
}

/**
 * Localisation la plus précise disponible : rue > quartier > (rien).
 *
 * Le quartier passe par le même formateur que la voie : les sources le
 * publient en capitales, parfois précédé d'un tiret de liste (« - BELLET »),
 * ce qui jurait à côté d'adresses correctement capitalisées.
 */
function pickNeighborhood(listing: ListingView): string | null {
  const street = listing.address.value !== null ? formatAddress(listing.address.value) : null;
  if (street !== null) return street;
  const district = listing.district?.value ?? null;
  return district !== null ? formatDistrict(district) : null;
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
  rank,
  onOpen,
  onFavorite,
  affinity,
}: ListingCardProps): React.JSX.Element {
  const sources = [...new Set(listing.occurrences.map((occurrence) => occurrence.sourceId))];
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
  // Format postal français, comme partout ailleurs (§20) : « 06000 Nice ».
  const cityLine = `${postal !== null ? `${postal} ` : ''}${formatCity(listing.city.value)}`;

  // La carte reste épurée : pas de pastilles DPE/atouts (réservées à la
  // fiche) ; seule la disponibilité, décisive pour agir, est affichée.
  const availability = formatAvailability(listing.availableAt.value, nowMs);

  // Photos, affichées directement depuis le site d'origine (§11 : jamais
  // téléchargées ni stockées) et défilables sur la carte même. Certaines
  // sources listent la même photo en plusieurs tailles (/original/,
  // /1600xauto/, /640x480/…) : on dédoublonne sur l'URL débarrassée de son
  // segment de taille pour ne pas montrer deux fois la même image. Sans photo,
  // la carte reste purement textuelle.
  //
  // Les photos que le navigateur refuserait (http sur une page https) sont
  // écartées ici : la carte n'a pas la place d'expliquer, la fiche s'en charge
  // et propose les liens.
  const seenPhotoKeys = new Set<string>();
  const photos = splitPhotos(listing.imageUrls ?? [])
    .embeddable.filter((url) => {
      const key = url.replace(/\/(original|\d+x(?:auto|\d+)|auto x\d+|thumb\w*)\//i, '/');
      if (seenPhotoKeys.has(key)) return false;
      seenPhotoKeys.add(key);
      return true;
    })
    .slice(0, 6);

  // Résumé lu à voix haute par les lecteurs d'écran : sans lui, la carte
  // n'annoncerait qu'un amas de chiffres.
  const label = `${formatPrice(listing.price.value)}, ${formatArea(listing.area.value)}, ${
    neighborhood ?? cityLine
  } — ouvrir la fiche`;

  return (
    <Card
      // TOUTE LA CARTE ouvre la fiche : c'est la seule action qu'elle porte,
      // les boutons ayant été retirés. Les commandes qui restent (cœur, flèches
      // du carrousel) arrêtent la propagation du clic, sinon les manipuler
      // ferait aussi changer de page.
      //
      // `role`/`tabIndex`/`onKeyDown` plutôt qu'un `<button>` englobant : un
      // bouton ne peut pas en contenir d'autres, et le cœur en est un.
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => onOpen(listing.id)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        // La barre d'espace fait défiler la page par défaut.
        event.preventDefault();
        onOpen(listing.id);
      }}
      // Le survol soulève d'un pixel et l'appui l'enfonce : sur téléphone,
      // où il n'y a pas de survol, `active:` est le seul retour qui dise que
      // le doigt a été reçu — la fiche met un instant à s'ouvrir.
      className={`${rank === undefined ? '' : 'rf-rise '}cursor-pointer overflow-hidden transition-[box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 active:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        isHot && !rented ? 'border-2 border-hot' : ''
      } ${archived || rented ? 'opacity-60' : uncertain ? 'opacity-70' : ''} ${
        rented ? 'grayscale' : ''
      }`}
      data-testid="listing-card"
      {...(rank === undefined
        ? {}
        : {
            // Au-delà de la dizaine, le décalage cumulé se verrait comme une
            // attente : on plafonne, les cartes suivantes entrent ensemble.
            style: { '--rf-delay': `${Math.min(rank, 10) * 30}ms` } as React.CSSProperties,
          })}
    >
      {/* La photo ne porte plus de pastille de score : la barre de priorité,
          sous le titre, joue ce rôle et laisse l'image entière. */}
      {photos.length > 0 && <PhotoCarousel urls={photos} />}
      <header className="flex items-start gap-3">
        <CardHeading listing={listing} neighborhood={neighborhood} cityLine={cityLine} />

        <span className="flex shrink-0 flex-col items-end gap-1">
          {onFavorite !== undefined && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onFavorite(!favorite);
              }}
              title={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              aria-label={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              aria-pressed={favorite}
              // L'étoile seule ne faisait que ~20 px de haut : trop petit pour
              // être visé au doigt. La zone cliquable est portée à 36 px sans
              // grossir le symbole.
              className={`-mt-1 flex size-9 cursor-pointer items-center justify-center text-xl leading-none transition-colors ${
                favorite ? 'text-hot' : 'text-muted-foreground hover:text-hot'
              }`}
            >
              {/* `key` change avec l'état : React remonte l'icône, ce qui
                relance l'animation. Sans cela elle ne jouerait qu'une fois. */}
              <Heart
                key={favorite ? 'on' : 'off'}
                aria-hidden="true"
                className={`size-5 ${favorite ? 'rf-pop fill-current' : ''}`}
              />
            </button>
          )}
          <StatusBadges listing={listing} rented={rented} archived={archived} affinity={affinity} />
        </span>
      </header>

      <PriorityBar priority={listing.actionPriority} />

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
          </span>
        ))}
      </div>

      {/* §13, §38 : d'où vient l'annonce et combien de fois elle circule. */}
      <p className="mt-1 text-[0.85rem] text-muted-foreground">
        {sources.length === 1 ? '1 source' : `${sources.length} sources`} ·{' '}
        {sources.map(formatSourceName).join(', ')}
      </p>
    </Card>
  );
}
