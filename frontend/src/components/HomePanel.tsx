/**
 * Accueil : un point de situation, pas une liste de plus.
 *
 * L'accueil était la liste des annonces — la même que l'onglet Recherche, au
 * filtre près. Ouvrir l'application posait donc une question à laquelle on
 * venait rarement répondre d'emblée (« que contient tout le stock ? ») plutôt
 * que celle qu'on se pose vraiment : QU'EST-CE QUI A BOUGÉ, ET QU'AI-JE À
 * FAIRE ?
 *
 * D'où trois étages, dans cet ordre :
 *
 *   1. ce qui est arrivé depuis la dernière visite — c'est périssable ;
 *   2. ce qui attend une action de votre part — un logement se prend en
 *      appelant, pas en consultant ;
 *   3. de quoi repartir : la recherche en cours et les recherches gardées.
 *
 * Chaque chiffre est cliquable et mène à ce qu'il compte. Un nombre sur lequel
 * on ne peut pas agir n'est qu'une décoration.
 */

import type { ListingView, SourceStateView } from '../types.js';
import type { SavedSearch } from '../saved-searches.js';
import { describeSearch } from '../saved-searches.js';
import { formatAge, formatArea, formatCity, formatPrice, formatSourceName } from '../format.js';
import { Badge } from '@/components/ui/badge.js';
import { Card } from '@/components/ui/card.js';
import { ArrowRight, Bell, Bookmark, Heart, PhoneCall, Search, TriangleAlert } from './icons.js';

/** Au-delà, une annonce n'est plus une nouveauté. */
const FRESH_HOURS = 48;

/** Priorité à partir de laquelle l'annonce mérite un appel aujourd'hui. */
const HOT_PRIORITY = 85;

interface HomePanelProps {
  readonly listings: readonly ListingView[];
  readonly sources: readonly SourceStateView[];
  readonly savedSearches: readonly SavedSearch[];
  readonly nowMs: number;
  /** Instant de la visite précédente : ce qui a été signalé après est nouveau. */
  readonly seenAtMs: number;
  readonly profileComplete: boolean;
  readonly onOpenListing: (id: string) => void;
  readonly onOpenSearch: () => void;
  readonly onOpenFavorites: () => void;
  readonly onOpenAlerts: () => void;
  readonly onOpenSavedSearches: () => void;
  readonly onOpenProfile: () => void;
  readonly onApplySearch: (search: SavedSearch) => void;
}

/** Un chiffre et ce qu'il compte, cliquable. */
function StatTile({
  label,
  value,
  Icon,
  onClick,
  accent = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly Icon: typeof Heart;
  readonly onClick: () => void;
  readonly accent?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-border hover:bg-muted flex cursor-pointer flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-colors ${
        accent ? 'border-hot' : ''
      }`}
    >
      <Icon
        aria-hidden="true"
        className={`size-4 ${accent ? 'text-hot' : 'text-muted-foreground'}`}
      />
      <span className="text-xl leading-tight font-bold">{value}</span>
      <span className="text-muted-foreground text-[0.8rem] leading-tight">{label}</span>
    </button>
  );
}

/** Une ligne d'annonce compacte : de quoi la reconnaître, et rien de plus. */
function MiniRow({
  listing,
  onOpen,
}: {
  readonly listing: ListingView;
  readonly onOpen: (id: string) => void;
}): React.JSX.Element {
  const sources = [...new Set(listing.occurrences.map((occurrence) => occurrence.sourceId))];
  const photo = listing.imageUrls.find((url) => url.startsWith('https://'));
  return (
    <button
      type="button"
      onClick={() => onOpen(listing.id)}
      className="border-border hover:bg-muted flex w-full cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-left transition-colors"
    >
      {photo === undefined ? (
        <span aria-hidden="true" className="bg-muted size-12 shrink-0 rounded-lg" />
      ) : (
        <img
          src={photo}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="bg-muted size-12 shrink-0 rounded-lg object-cover"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <strong>{formatPrice(listing.price.value)}</strong>
          <span className="text-muted-foreground text-sm">{formatArea(listing.area.value)}</span>
        </span>
        <span className="text-muted-foreground block truncate text-[0.82rem]">
          {formatCity(listing.city.value)} · {sources.map(formatSourceName).join(', ')}
        </span>
      </span>
      <ArrowRight aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
}

export function HomePanel({
  listings,
  sources,
  savedSearches,
  nowMs,
  seenAtMs,
  profileComplete,
  onOpenListing,
  onOpenSearch,
  onOpenFavorites,
  onOpenAlerts,
  onOpenSavedSearches,
  onOpenProfile,
  onApplySearch,
}: HomePanelProps): React.JSX.Element {
  const active = listings.filter((listing) => listing.lifecycle === 'active');

  // Nouveautés : signalées depuis la dernière visite, ou apparues dans les
  // deux derniers jours si l'on n'avait encore jamais ouvert la page.
  const freshFrom = Math.max(seenAtMs, nowMs - FRESH_HOURS * 60 * 60 * 1000);
  const fresh = active
    .filter((listing) => Date.parse(listing.notifiedAt ?? listing.firstSeenAt) >= freshFrom)
    .sort(
      (a, b) =>
        Date.parse(b.notifiedAt ?? b.firstSeenAt) - Date.parse(a.notifiedAt ?? a.firstSeenAt),
    );

  // À FAIRE : ce qui attend un geste. Une annonce « à contacter » n'a pas
  // encore été appelée ; un favori laissé en « nouvelle » non plus.
  const toCall = active.filter(
    (listing) =>
      listing.actionPriority >= HOT_PRIORITY &&
      listing.tracking === 'new' &&
      listing.archived !== true,
  );
  const favorites = active.filter((listing) => listing.favorite === true);
  const favoritesUntouched = favorites.filter((listing) => listing.tracking === 'new');
  const ailing = sources.filter((source) => source.health !== 'healthy');

  const hasChores = toCall.length > 0 || favoritesUntouched.length > 0 || !profileComplete;

  return (
    <div className="flex flex-col gap-6">
      {/* 1. CE QUI A BOUGÉ. En tête parce que c'est périssable : une annonce
        de deux jours est souvent déjà louée. */}
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Nouveautés</h2>
          {fresh.length > 0 && (
            <button
              type="button"
              onClick={onOpenAlerts}
              className="text-primary cursor-pointer text-sm underline"
            >
              Tout l’historique
            </button>
          )}
        </div>
        {fresh.length === 0 ? (
          <Card className="text-muted-foreground text-[0.92rem]">
            Rien de neuf depuis votre dernier passage. Les annonces signalées s’affichent ici, et
            l’historique complet est dans les notifications.
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {fresh.slice(0, 4).map((listing, rank) => (
              <li
                key={listing.id}
                className="rf-rise"
                style={{ '--rf-delay': `${rank * 30}ms` } as React.CSSProperties}
              >
                <MiniRow listing={listing} onOpen={onOpenListing} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. CE QUI ATTEND UN GESTE. Un logement se prend en appelant. */}
      {hasChores && (
        <section>
          <h2 className="mb-2 text-lg font-bold">À faire</h2>
          <ul className="flex flex-col gap-2">
            {toCall.length > 0 && (
              <li>
                <button
                  type="button"
                  onClick={onOpenSearch}
                  className="border-hot hover:bg-muted flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors"
                >
                  <PhoneCall aria-hidden="true" className="text-hot size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {toCall.length} annonce{toCall.length > 1 ? 's' : ''} à contacter
                    </span>
                    <span className="text-muted-foreground block text-[0.82rem]">
                      Priorité haute, jamais appelées.
                    </span>
                  </span>
                  <ArrowRight aria-hidden="true" className="text-muted-foreground size-4" />
                </button>
              </li>
            )}
            {favoritesUntouched.length > 0 && (
              <li>
                <button
                  type="button"
                  onClick={onOpenFavorites}
                  className="border-border hover:bg-muted flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors"
                >
                  <Heart aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {favoritesUntouched.length} favori
                      {favoritesUntouched.length > 1 ? 's' : ''} sans suite
                    </span>
                    <span className="text-muted-foreground block text-[0.82rem]">
                      Retenus, mais pas encore contactés.
                    </span>
                  </span>
                  <ArrowRight aria-hidden="true" className="text-muted-foreground size-4" />
                </button>
              </li>
            )}
            {!profileComplete && (
              <li>
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="border-border hover:bg-muted flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors"
                >
                  <TriangleAlert aria-hidden="true" className="text-medium size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">Compléter le profil locataire</span>
                    <span className="text-muted-foreground block text-[0.82rem]">
                      Sans lui, aucun message de contact ne peut être préparé.
                    </span>
                  </span>
                  <ArrowRight aria-hidden="true" className="text-muted-foreground size-4" />
                </button>
              </li>
            )}
          </ul>
        </section>
      )}

      {/* 3. DE QUOI REPARTIR. */}
      <section>
        <h2 className="mb-2 text-lg font-bold">Votre recherche</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile
            label="dans vos critères"
            value={active.length}
            Icon={Search}
            onClick={onOpenSearch}
          />
          <StatTile
            label="à contacter"
            value={toCall.length}
            Icon={PhoneCall}
            onClick={onOpenSearch}
            accent={toCall.length > 0}
          />
          <StatTile
            label="favoris"
            value={favorites.length}
            Icon={Heart}
            onClick={onOpenFavorites}
          />
          <StatTile
            label="signalées récemment"
            value={fresh.length}
            Icon={Bell}
            onClick={onOpenAlerts}
          />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Recherches enregistrées</h2>
          <button
            type="button"
            onClick={onOpenSavedSearches}
            className="text-primary cursor-pointer text-sm underline"
          >
            {savedSearches.length > 0 ? 'Toutes' : 'En enregistrer une'}
          </button>
        </div>
        {savedSearches.length === 0 ? (
          <Card className="text-muted-foreground text-[0.92rem]">
            Aucune pour l’instant. Réglez vos critères dans la recherche, puis «&nbsp;Enregistrer
            cette recherche&nbsp;» — vous la rappellerez d’un geste.
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {savedSearches.slice(0, 3).map((search) => (
              <li key={search.id}>
                <button
                  type="button"
                  onClick={() => onApplySearch(search)}
                  className="border-border hover:bg-muted flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors"
                >
                  <Bookmark aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{search.name}</span>
                    <span className="text-muted-foreground block truncate text-[0.82rem]">
                      {describeSearch(search)}
                    </span>
                  </span>
                  <ArrowRight aria-hidden="true" className="text-muted-foreground size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* La santé des sources ne s'affiche QUE si elle cloche : « tout va
        bien » n'apprend rien, et occuperait la place d'une annonce. */}
      {ailing.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-bold">Collecte</h2>
          <Card className="flex items-center gap-3">
            <TriangleAlert aria-hidden="true" className="text-medium size-5 shrink-0" />
            <span className="min-w-0 flex-1 text-[0.92rem]">
              {ailing.length} source{ailing.length > 1 ? 's' : ''} ne répond
              {ailing.length > 1 ? 'ent' : ''} plus normalement — moins d’annonces arrivent.
            </span>
            <Badge variant="warning">{formatAge(ailing[0]?.lastRunAt ?? null, nowMs)}</Badge>
          </Card>
        </section>
      )}
    </div>
  );
}
