/**
 * Application (§36, §39).
 *
 * Pas de routeur, pas de gestionnaire d'état : trois vues et un `useState`
 * suffisent. §39 et §65 demandent explicitement de limiter les dépendances —
 * ajouter react-router ici coûterait 15 ko pour naviguer entre trois écrans.
 *
 * STRUCTURE UX : toutes les vues partagent la même coquille (`Shell`) — un
 * en-tête persistant avec la navigation par onglets — pour que l'utilisateur
 * sache toujours où il est et comment revenir. La liste met en avant les
 * annonces à contacter MAINTENANT (§36 : classement par action, pas par prix).
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { TenantProfile } from '@rentfinder/shared';
import { MVP_CRITERIA } from '@rentfinder/shared';
import type { ListingView, SortMode, SourceStateView, TrackingStatus } from './types.js';
import {
  fetchFilters,
  fetchListing,
  fetchListings,
  fetchCurrentUser,
  fetchSavedSearches,
  fetchSources,
  isDemoMode,
  requiresLogin,
  markViewed,
  setArchived,
  recordContact,
  saveFilters,
  saveSavedSearches,
  savedSearchesAvailable,
  setFavorite,
  updateTracking,
} from './api/client.js';
import { clearProfile, loadProfile, saveProfile } from './profile.js';
import { AFFINITY_BOOST, computeAffinity } from './affinity.js';
import { formatSourceName } from './format.js';
import { markAlertsSeen, readAlertsSeenAt, unreadAlertCount } from './notifications.js';
import { Button } from '@/components/ui/button.js';
import { DocumentsSection } from './components/DocumentsSection.js';
import { ReferencePointsSection } from './components/ReferencePointsSection.js';
import { ListingCard } from './components/ListingCard.js';
import { ListingDetail } from './components/ListingDetail.js';
import { ProfileForm } from './components/ProfileForm.js';
import { SourcesPanel } from './components/SourcesPanel.js';
import { SavedSearchesPanel } from './components/SavedSearchesPanel.js';
import { HomePanel } from './components/HomePanel.js';
import { LoginScreen } from './components/LoginScreen.js';
import { AlertsToggle } from './components/AlertsToggle.js';
import {
  newSearchId,
  suggestName,
  toQuickFilters,
  toSavedView,
  type SavedSearch,
} from './saved-searches.js';
import { SourcePanel } from './components/SourcePanel.js';
import { StatsPanel } from './components/StatsPanel.js';
import { ArrowLeft, Bell, Flame, List, Map, Search, SlidersHorizontal } from 'lucide-react';
import { SortFilterModal } from './components/SortFilterModal.js';
import { NotificationsPanel } from './components/NotificationsPanel.js';
import { BottomNav, type BottomTab } from './components/BottomNav.js';
import { ListingListSkeleton, MapSkeleton } from './components/Skeletons.js';
import { SettingsLinks } from './components/SettingsLinks.js';
import { ProfileSummary } from './components/ProfileSummary.js';
import {
  QuickFilters,
  DEFAULT_QUICK_FILTERS,
  hasActiveQuickFilters,
  matchesQuickFilters,
  type QuickFilterValues,
} from './components/QuickFilters.js';
import { matchesSearch } from './search.js';
import { useNewListingAlerts } from './use-new-listing-alerts.js';
import { readViewState, writeViewState } from './view-state.js';
import { useWideScreen } from './use-wide-screen.js';
import { mergeToasts, ToastStack, type Toast } from './components/ToastStack.js';

// Leaflet n'entre dans le bundle que si la vue carte est ouverte (§65).
const MapView = lazy(() => import('./components/MapView.js'));

type View =
  | 'home'
  | 'list'
  | 'detail'
  | 'stats'
  | 'profile'
  | 'tenant'
  | 'documents'
  | 'reference'
  | 'saved'
  | 'sources'
  | 'source'
  | 'alerts';

/**
 * Ce qu'un onglet peut viser. « favoris » n'est PAS une vue : c'est la liste
 * assortie d'un filtre. Lui donner une vue à part aurait créé une seconde
 * source de vérité à côté de `favoritesOnly`, que la modale règle aussi.
 */
type NavTarget = View | 'favorites';

/** Seuil de mise en avant : au-delà, l'annonce mérite un contact immédiat. */
const HOT_PRIORITY = 85;

/** Options de tri de la liste (§36). L'ordre définit celui du menu. */
const SORT_OPTIONS: readonly { value: SortMode; label: string }[] = [
  { value: 'priority', label: 'Priorité d’action' },
  { value: 'recent', label: 'Plus récentes' },
  { value: 'price', label: 'Loyer croissant' },
];

/**
 * Coquille commune : en-tête persistant + navigation par onglets.
 * L'onglet actif est souligné — l'utilisateur sait toujours où il est.
 */
function Shell({
  view,
  favoritesOnly,
  onNavigate,
  unreadAlerts = 0,
  bottomTab,
  onBottomSelect,
  children,
}: {
  readonly view: View;
  readonly favoritesOnly: boolean;
  readonly onNavigate: (target: NavTarget) => void;
  /** Alertes reçues depuis la dernière visite de la page Notifications. */
  readonly unreadAlerts?: number;
  /** Onglet bas actif, ou `null` hors des quatre destinations. */
  readonly bottomTab?: BottomTab | null;
  readonly onBottomSelect?: (tab: BottomTab) => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  // LES MÊMES QUATRE DESTINATIONS QUE LA BARRE BASSE, dans le même ordre.
  // Le haut d'écran en portait cinq et la barre basse quatre, avec des noms
  // différents pour la même page : passer du téléphone à l'ordinateur
  // demandait de réapprendre la navigation. « Stats » a rejoint les
  // Paramètres, où vivent déjà les écrans qu'on consulte une fois par mois.
  const tabs: readonly { key: NavTarget; label: string }[] = [
    { key: 'home', label: 'Accueil' },
    { key: 'list', label: 'Recherche' },
    { key: 'favorites', label: 'Favoris' },
    // « Paramètres » et non « Profil » : cet écran ne porte plus le formulaire
    // mais les chemins vers lui, le dossier, les alertes et les sources.
    { key: 'profile', label: 'Paramètres' },
  ];
  // La fiche appartient à l'univers « Recherche » ; le filtre favoris prime.
  const active: NavTarget =
    view === 'list' || view === 'detail' ? (favoritesOnly ? 'favorites' : 'list') : view;

  // La liste s'élargit sur grand écran pour afficher les cartes en grille ; les
  // autres vues (fiche, profil, stats) restent en colonne étroite, plus lisible.
  const wide = view === 'list';
  return (
    <main
      className={`mx-auto px-3 py-4 pb-12 sm:px-4 sm:py-6 sm:pb-16 ${
        wide ? 'max-w-[720px] lg:max-w-[1120px]' : 'max-w-[720px]'
      }`}
    >
      <header className="mb-4">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Maïoun</h1>
          <div className="flex items-center gap-2">
            {/* Seule entrée vers les notifications : ce n'est pas un onglet.
              Régler ses alertes n'est pas un endroit où l'on navigue, c'est un
              aparté dont on revient — la page s'ouvre donc par-dessus, sans la
              barre d'onglets, et se referme par « Retour ». */}
            <button
              type="button"
              onClick={() => onNavigate('alerts')}
              aria-label={
                unreadAlerts > 0
                  ? `Notifications, ${unreadAlerts} non lue${unreadAlerts > 1 ? 's' : ''}`
                  : 'Notifications'
              }
              className="relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground"
            >
              <Bell aria-hidden="true" className="size-4" />
              {/* Pastille des alertes non lues : sans elle, rien ne distinguait
                une cloche qui a quelque chose à dire d'une cloche muette — il
                fallait ouvrir la page pour le savoir. */}
              {unreadAlerts > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1.5 -right-1.5 flex min-w-4.5 items-center justify-center rounded-full bg-hot px-1 text-[0.65rem] leading-4.5 font-bold text-white"
                >
                  {unreadAlerts > 9 ? '9+' : unreadAlerts}
                </span>
              )}
            </button>
          </div>
        </div>
        <nav
          // La barre ne défile qu'en HORIZONTAL :
          //  - `touch-pan-x` cantonne le geste tactile à cet axe, sinon un
          //    glissement vertical y est capté et fait rebondir la barre ;
          //  - `overscroll-contain` empêche ce rebond de se propager à la page ;
          //  - `select-none` évite de sélectionner le libellé en glissant.
          // Masqués sur MOBILE : la barre basse les remplace, et une rangée
          // coulissante dont la moitié vit hors de l'écran ne se découvre pas.
          className="mt-3 hidden touch-pan-x gap-1 overflow-x-auto overscroll-contain border-b border-border select-none sm:flex [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Navigation principale"
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onNavigate(tab.key)}
              aria-current={active === tab.key ? 'page' : undefined}
              className={`-mb-px min-h-11 shrink-0 cursor-pointer border-b-2 px-3 text-[0.95rem] whitespace-nowrap transition-colors ${
                active === tab.key
                  ? 'border-primary font-semibold text-primary'
                  : 'border-transparent font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      {/* Fondue au changement de vue, relancée par la `key` : sans elle, passer
        de la liste à une fiche remplaçait l'écran d'un coup, sans qu'on sache
        si c'était la même page qui avait changé ou une autre qui s'était
        ouverte. Un glissement latéral, lui, aurait suggéré une direction que
        la navigation n'a pas. */}
      <div key={view} className="rf-fade">
        {children}
      </div>
      {/* `pb-20` sur mobile : sans cela, la barre fixe recouvre la fin de la
        liste et le dernier élément reste inatteignable. */}
      {onBottomSelect !== undefined && (
        <>
          <div aria-hidden="true" className="h-20 sm:hidden" />
          <BottomNav active={bottomTab ?? null} onSelect={onBottomSelect} />
        </>
      )}
    </main>
  );
}

/**
 * `true` si l'affichage S'ÉCARTE de son état d'ouverture — ce qui rend le
 * bouton « Réinitialiser » utile. Hors du composant : ce n'est qu'un calcul,
 * et l'y laisser alourdissait `App` au-delà de la complexité tolérée.
 */
function isDefaultView(view: {
  readonly sort: SortMode;
  readonly quickFilters: QuickFilterValues;
  readonly sourceCount: number;
  readonly search: string;
  readonly toggles: readonly boolean[];
}): boolean {
  return (
    view.sort !== 'priority' ||
    hasActiveQuickFilters(view.quickFilters) ||
    view.sourceCount > 0 ||
    view.search !== '' ||
    view.toggles.some(Boolean)
  );
}

/**
 * Nombre de réglages qui écartent l'affichage de son état d'ouverture — c'est
 * la pastille du bouton « Trier et filtrer ». Hors du composant : ce n'est
 * qu'un décompte, et l'y laisser alourdissait `App` sans rien apprendre.
 */
function countActiveSettings(view: {
  readonly sort: SortMode;
  readonly sourceCount: number;
  readonly toggles: readonly boolean[];
}): number {
  return (
    view.toggles.filter(Boolean).length +
    (view.sort === 'priority' ? 0 : 1) +
    (view.sourceCount === 0 ? 0 : 1)
  );
}

/**
 * Onglet bas correspondant à la vue courante, ou `null` hors des quatre
 * destinations. Hors du composant : ce n'est qu'une correspondance, et l'y
 * laisser alourdissait `App` au-delà de la complexité tolérée.
 */
function bottomTabFor(
  view: View,
  favoritesOnly: boolean,
  sortFilterOpen: boolean,
): BottomTab | null {
  // La modale ouverte, c'est « Recherche » qui est actif : l'onglet doit
  // refléter ce que l'utilisateur regarde, modale comprise.
  if (sortFilterOpen) return 'search';
  if (view === 'home') return 'home';
  // La LISTE est la recherche, et non l'accueil : celui-ci est devenu un point
  // de situation. L'onglet doit dire où l'on est, pas où l'on était.
  if (view === 'list' || view === 'detail') return favoritesOnly ? 'favorites' : 'search';
  if (view === 'profile' || view === 'tenant' || view === 'documents' || view === 'saved') {
    return 'settings';
  }
  return null;
}

/**
 * Les RÉSULTATS d'une recherche : le chargement, le vide, et les deux mises
 * en page possibles.
 *
 * Extrait d'`App`, qui portait tout : la coquille, la navigation, une
 * douzaine d'écrans secondaires ET ce bloc-ci. Le fichier passait le seuil de
 * complexité toléré, et surtout on ne trouvait plus rien dedans.
 *
 * DEUX MISES EN PAGE, une seule décision : au-dessus de 1024 px, les annonces
 * et le plan tiennent côte à côte — c'est le parti d'Airbnb, et il vaut ici
 * pour la même raison : chercher un logement, c'est comparer un loyer À un
 * endroit. En dessous, la place manque et la bascule Liste/Carte reprend son
 * sens.
 */
function SearchResults({
  loading,
  filtered,
  ranked,
  hot,
  rest,
  split,
  favoritesOnly,
  emptyBecauseFiltered,
  nowMs,
  affinity,
  onOpen,
  onFavorite,
}: {
  readonly loading: boolean;
  readonly filtered: readonly ListingView[];
  readonly ranked: readonly ListingView[];
  readonly hot: readonly ListingView[];
  readonly rest: readonly ListingView[];
  /** `true` = annonces et plan côte à côte ; `false` = la liste seule. */
  readonly split: boolean;
  readonly favoritesOnly: boolean;
  /** `true` si le vide vient d'un filtre, et non d'un inventaire vide. */
  readonly emptyBecauseFiltered: boolean;
  readonly nowMs: number;
  readonly affinity: { active: boolean; scores: ReadonlyMap<string, number> };
  readonly onOpen: (id: string) => void;
  readonly onFavorite: (id: string, favorite: boolean) => void;
}): React.JSX.Element {
  return loading ? (
    <ListingListSkeleton />
  ) : filtered.length === 0 ? (
    <p className="py-8 text-center text-muted-foreground">
      {favoritesOnly
        ? 'Aucun favori. Touchez le cœur d’une annonce pour la retrouver ici.'
        : emptyBecauseFiltered
          ? 'Aucune annonce ne correspond à ces filtres.'
          : 'Aucune annonce ne correspond à vos critères pour l’instant.'}
    </p>
  ) : split ? (
    <>
      {/* DEUX COLONNES SUR GRAND ÉCRAN, façon Airbnb : les cartes à
        gauche, la carte à droite. La bascule Liste/Carte échangeait
        l'une contre l'autre — on perdait les faits en regardant les
        positions, et les positions en lisant les faits, alors que
        l'écran a la place pour les deux. Sur téléphone il ne l'a pas :
        la carte y reste seule, et la bascule garde tout son sens.

        La carte COLLE au défilement (`sticky`) et la colonne de gauche
        défile sous elle : c'est ce qui fait tenir la comparaison —
        faire défiler cent annonces en gardant le plan sous les yeux. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-4">
        {/* `space-y-3` et NON `flex flex-col` : dans une colonne flex à
          hauteur bornée, les enfants se COMPRIMENT pour tenir, et les
          cartes se réduisaient à quelques pixels de haut. Un empilement
          ordinaire les laisse à leur taille et fait défiler le reste. */}
        <div className="hidden max-h-[calc(100vh-10rem)] space-y-3 overflow-y-auto pr-2 lg:block">
          {ranked.map((listing, rank) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              nowMs={nowMs}
              rank={rank}
              onOpen={onOpen}
              onFavorite={(favorite) => onFavorite(listing.id, favorite)}
              affinity={affinity.active ? affinity.scores.get(listing.id) : undefined}
            />
          ))}
        </div>
        <div className="lg:sticky lg:top-4">
          <Suspense fallback={<MapSkeleton />}>
            <MapView listings={ranked} onOpen={onOpen} />
          </Suspense>
        </div>
      </div>
    </>
  ) : (
    <>
      {hot.length > 0 && (
        <section aria-labelledby="hot-title" className="mb-6">
          <h2 id="hot-title" className="mb-2 flex items-center gap-1.5 text-lg font-bold">
            <Flame aria-hidden="true" className="size-4" /> À contacter maintenant
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {hot.map((listing, rank) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                nowMs={nowMs}
                rank={rank}
                onOpen={onOpen}
                onFavorite={(favorite) => onFavorite(listing.id, favorite)}
                affinity={affinity.active ? affinity.scores.get(listing.id) : undefined}
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="all-title">
        {hot.length > 0 && (
          <h2 id="all-title" className="mb-2 text-lg font-bold text-muted-foreground">
            Toutes les annonces <span className="text-sm font-normal">({ranked.length})</span>
          </h2>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          {rest.map((listing, rank) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              nowMs={nowMs}
              rank={rank}
              onOpen={onOpen}
              onFavorite={(favorite) => onFavorite(listing.id, favorite)}
            />
          ))}
        </div>
      </section>
    </>
  );
}

/**
 * Ce qui, dans une fiche affichée, vient de VOS gestes et non de la base.
 *
 * Quand on recharge une annonce depuis Turso pour en obtenir la description et
 * les scores détaillés, la réponse porte l'état tel qu'il était en base — pas
 * celui que l'écran vient d'appliquer de façon optimiste. Sans ce report, un
 * favori posé une seconde plus tôt se serait défait sous les yeux.
 */
function userState(listing: ListingView): Partial<ListingView> {
  return {
    favorite: listing.favorite,
    archived: listing.archived,
    tracking: listing.tracking,
    viewed: listing.viewed,
  };
}

export function App(): React.JSX.Element {
  const [listings, setListings] = useState<readonly ListingView[]>([]);
  const [sources, setSources] = useState<readonly SourceStateView[]>([]);
  // L'accueil est un point de situation ; la liste vit sous « Recherche ».
  const [view, setView] = useState<View>('home');
  const [savedSearches, setSavedSearches] = useState<readonly SavedSearch[]>([]);
  // Qui est connecté. `undefined` = on ne sait pas encore : montrer l'écran de
  // connexion à ce moment-là le ferait clignoter chez quelqu'un qui a déjà une
  // session valide.
  const [currentUser, setCurrentUser] = useState<string | null | undefined>(
    requiresLogin() ? undefined : 'moi',
  );
  // Source dont on regarde la fiche ; `null` hors de cette vue.
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Réglages d'AFFICHAGE restaurés depuis ce navigateur : ils ne survivaient
  // pas à un rafraîchissement, et il fallait les refaire plusieurs fois par
  // jour. Lus une seule fois, à l'initialisation des états.
  const [restored] = useState(readViewState);
  const [sort, setSort] = useState<SortMode>(restored.sort);
  const [sortFilterOpen, setSortFilterOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [search, setSearch] = useState(restored.search);
  const [hideUncertain, setHideUncertain] = useState(restored.hideUncertain);
  const [includeOutOfCriteria, setIncludeOutOfCriteria] = useState(restored.includeOutOfCriteria);
  const [showArchived, setShowArchived] = useState(restored.showArchived);
  const [favoritesOnly, setFavoritesOnly] = useState(restored.favoritesOnly);
  // Filtre par source : ensemble vide = toutes les sources affichées. Une
  // annonce passe si l'une de ses occurrences vient d'une source sélectionnée.
  const [selectedSources, setSelectedSources] = useState<ReadonlySet<string>>(
    restored.selectedSources,
  );
  // Filtres rapides façon SeLoger (budget, surface, pièces, type) : affinent la
  // liste déjà chargée, sans toucher aux critères de collecte (§66).
  const [quickFilters, setQuickFilters] = useState<QuickFilterValues>(restored.quickFilters);
  // Liste ⇄ Carte : deux façons de parcourir les mêmes annonces (§36, §39).
  const [displayMode, setDisplayMode] = useState<'list' | 'map'>(restored.displayMode);
  // Au-dessus de 1024 px, annonces et plan tiennent ensemble : la vue
  // partagée s'impose, et la bascule n'a plus lieu d'être.
  const wideScreen = useWideScreen();
  const [profile, setProfile] = useState<TenantProfile | null>(() => loadProfile());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Instant de rendu, figé par chargement : évite que chaque carte recalcule
  // « il y a X min » à partir d'une horloge légèrement différente.
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Pastille de la cloche. `alertsSeenAt` s'amorce à l'instant du premier
  // lancement : compter tout l'historique afficherait « 90 » à quelqu'un qui
  // n'a rien manqué.
  const [alertsSeenAt, setAlertsSeenAt] = useState(() => readAlertsSeenAt(Date.now()));
  // Instant de la visite PRÉCÉDENTE, figé à l'ouverture de la page. Sans lui,
  // marquer les alertes comme vues effacerait les repères « non lue » dans la
  // seconde où on arrive dessus.
  const [alertsViewedFrom, setAlertsViewedFrom] = useState(alertsSeenAt);
  // Bandeaux d'alerte affichés DANS la page : la notification navigateur ne se
  // voit pas quand l'onglet a le focus, et pas du tout sans permission.
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  // Affinité : apprend de vos consultations/suivis/archivages pour remonter les
  // annonces qui vous ressemblent (§33). Hook placé AVANT tout return
  // conditionnel (règle des hooks). Recalculée quand la liste change.
  const affinity = useMemo(() => computeAffinity(listings), [listings]);

  // Mémorise les réglages d'affichage à chaque changement. Un effet plutôt
  // qu'une écriture dans chaque setter : neuf points d'écriture auraient fini
  // par diverger, et un oubli ne se voit pas.
  //
  // DIFFÉRÉ d'un tiers de seconde : `localStorage` écrit de façon synchrone, et
  // sérialiser tout l'état à chaque caractère tapé dans la recherche bloquait
  // le fil principal pour rien. Une écriture par pause de saisie suffit.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeViewState({
        sort,
        quickFilters,
        selectedSources,
        search,
        hideUncertain,
        includeOutOfCriteria,
        showArchived,
        favoritesOnly,
        displayMode,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    sort,
    quickFilters,
    selectedSources,
    search,
    hideUncertain,
    includeOutOfCriteria,
    showArchived,
    favoritesOnly,
    displayMode,
  ]);
  const unreadAlerts = useMemo(
    () => unreadAlertCount(listings, alertsSeenAt),
    [listings, alertsSeenAt],
  );

  // Dérivations d'affichage MÉMOÏSÉES : elles filtrent et trient des centaines
  // d'annonces. Sans mémoïsation, tout serait recalculé à chaque rendu — donc à
  // chaque frappe dans un filtre. Placées avant tout return conditionnel (règle
  // des hooks). Chacune ne se recalcule que si ses entrées changent.
  const availableSources = useMemo(
    () =>
      [...new Set(listings.flatMap((l) => l.occurrences.map((o) => o.sourceId)))].sort((a, b) =>
        formatSourceName(a).localeCompare(formatSourceName(b)),
      ),
    [listings],
  );
  const availableTypes = useMemo(
    () =>
      [...new Set(listings.map((l) => l.propertyType.value))].filter((t) => t !== 'unknown').sort(),
    [listings],
  );
  // Filtre par source (§13), puis filtres rapides (budget/surface/pièces/type),
  // puis la recherche libre.
  const filtered = useMemo(() => {
    const bySource =
      selectedSources.size === 0
        ? listings
        : listings.filter((l) => l.occurrences.some((o) => selectedSources.has(o.sourceId)));
    // Les champs AFFICHENT vos critères, mais ne filtrent qu'une fois modifiés.
    // Les appliquer d'emblée aurait ré-exclu aussitôt les annonces demandées par
    // la bascule « hors critères » — deux réglages qui se contredisent.
    const byQuick = hasActiveQuickFilters(quickFilters)
      ? bySource.filter((l) => matchesQuickFilters(l, quickFilters))
      : bySource;
    const bySearch = byQuick.filter((l) => matchesSearch(l, search));
    // « À vérifier » = disparue de sa source depuis plusieurs collectes. On peut
    // les masquer pour ne garder que ce qui est encore publié (§33).
    return hideUncertain ? bySearch.filter((l) => l.lifecycle !== 'possiblyInactive') : bySearch;
  }, [listings, selectedSources, quickFilters, search, hideUncertain]);
  // §36 : en tri par priorité, on classe par priorité d'action AJUSTÉE de
  // l'affinité — les annonces proches de vos préférences remontent.
  const ranked = useMemo(
    () =>
      sort === 'priority'
        ? [...filtered].sort(
            (a, b) =>
              b.actionPriority +
              (affinity.scores.get(b.id) ?? 0) * AFFINITY_BOOST -
              (a.actionPriority + (affinity.scores.get(a.id) ?? 0) * AFFINITY_BOOST),
          )
        : filtered,
    [filtered, sort, affinity],
  );
  // La section « à contacter maintenant » reste fondée sur l'urgence réelle.
  // Pas de section « à contacter maintenant » dans les FAVORIS : on y vient
  // revoir ce qu'on a retenu, pas se faire hiérarchiser sa propre sélection.
  const grouped = sort === 'priority' && !favoritesOnly;
  const hot = useMemo(
    () => (grouped ? ranked.filter((l) => l.actionPriority >= HOT_PRIORITY) : []),
    [ranked, grouped],
  );
  const rest = useMemo(
    () => (grouped ? ranked.filter((l) => l.actionPriority < HOT_PRIORITY) : ranked),
    [ranked, grouped],
  );

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchListings({
        sort,
        includeOutOfCriteria,
        includeArchived: showArchived,
        favoritesOnly,
      });
      setListings(response.listings);
      setNowMs(Date.now());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [sort, includeOutOfCriteria, showArchived, favoritesOnly]);

  useEffect(() => {
    if (!requiresLogin()) return;
    void fetchCurrentUser()
      .then(setCurrentUser)
      .catch(() => setCurrentUser(null));
  }, []);

  useEffect(() => {
    // Rien à charger tant qu'on ne sait pas qui regarde : la requête partirait
    // sans cookie et reviendrait « connexion requise ».
    if (currentUser === undefined || currentUser === null) return;
    void load();
  }, [load, currentUser]);

  // Recherches enregistrées et santé des sources : deux lectures, une fois par
  // session, dont l'accueil a besoin dès son ouverture. Un échec n'est pas une
  // erreur d'écran — on affiche simplement une liste vide (§69).
  useEffect(() => {
    void fetchSavedSearches()
      .then(setSavedSearches)
      .catch(() => undefined);
    void fetchSources()
      .then((response) => setSources(response.sources))
      .catch(() => undefined);
  }, []);

  // Intentions venues d'une NOTIFICATION (§29). Le service worker ne peut pas
  // écrire en base — les identifiants de connexion vivent dans le stockage de
  // la page — il transmet donc l'action par l'URL, et c'est ici qu'on l'exécute.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const favori = params.get('favori');
    const listing = params.get('listing');
    if (favori === null && listing === null) return;

    // L'URL est nettoyée tout de suite : un rechargement ne doit pas rejouer
    // l'action, et le lien reste partageable.
    window.history.replaceState({}, '', window.location.pathname);
    if (favori !== null) {
      void setFavorite(favori, true).catch(() => {
        setError('Le favori n’a pas pu être enregistré');
      });
      setListings((current) =>
        current.map((l) => (l.id === favori ? { ...l, favorite: true } : l)),
      );
    }
    const target = listing ?? favori;
    if (target !== null) {
      setSelectedId(target);
      setView('detail');
    }
  }, []);

  // Ouvre une fiche et la marque « consultée » (§37). En `useCallback` car
  // partagée par le rendu ET le sondage de notifications (hook ci-dessous).
  const openListing = useCallback((id: string): void => {
    setSelectedId(id);
    setView('detail');
    // Optimiste : on met à jour l'affichage tout de suite, l'API suit.
    setListings((current) =>
      current.map((listing) => (listing.id === id ? { ...listing, viewed: true } : listing)),
    );
    void markViewed(id).catch(() => {
      /* l'échec réseau n'empêche pas de consulter la fiche */
    });
    // LA FICHE COMPLÈTE, à l'ouverture seulement. La liste ne transporte ni
    // description, ni coordonnées, ni détail des scores — c'est ce qui la rend
    // légère (six méga-octets de moins). On les demande ici, pour UNE annonce,
    // au moment où elles servent (§30). L'échec n'est pas bloquant : la fiche
    // s'affiche avec ce que la liste en savait.
    void fetchListing(id)
      .then((full) =>
        setListings((current) =>
          current.map((listing) =>
            listing.id === id ? { ...full, viewed: true, ...userState(listing) } : listing,
          ),
        ),
      )
      .catch(() => {
        /* fiche non rechargée : celle de la liste reste affichée */
      });
  }, []);

  // §29 : bandeaux dans la page + notifications navigateur, site ouvert.
  const handleFresh = useCallback(
    (fresh: readonly ListingView[]): void => setToasts((current) => mergeToasts(current, fresh)),
    [],
  );
  useNewListingAlerts({ onFresh: handleFresh, onOpen: openListing });

  const dismissToast = useCallback((id: string): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const navigate = (next: NavTarget): void => {
    if (next === 'alerts') {
      // Consulter l'historique, c'est avoir vu les alertes : la pastille tombe.
      // Les LIGNES, elles, gardent leur repère « non lue » — d'où l'instant
      // précédent, mis de côté avant d'être écrasé.
      const seenAt = Date.now();
      setAlertsViewedFrom(alertsSeenAt);
      markAlertsSeen(seenAt);
      setAlertsSeenAt(seenAt);
    }
    if (next === 'favorites') {
      setFavoritesOnly(true);
      setSelectedId(null);
      setView('list');
      return;
    }
    if (next === 'sources') {
      void openSources();
      return;
    }
    if (next === 'list') {
      setSelectedId(null);
      // Sans cela, on resterait coincé dans les favoris : la barre qui porte
      // la bascule est masquée là-bas.
      setFavoritesOnly(false);
    }
    setView(next);
  };

  const openSources = async (): Promise<void> => {
    try {
      const response = await fetchSources();
      setSources(response.sources);
      setView('sources');
    } catch {
      setError('Impossible de charger l’état des sources');
    }
  };

  /**
   * Ouvre la fiche d'une source. L'état d'exécution est chargé au passage
   * quand il manque — venir depuis une annonce ne l'a pas fait charger — mais
   * son échec n'empêche rien : les annonces, elles, sont déjà là.
   */
  const openSource = async (sourceId: string): Promise<void> => {
    setSelectedSourceId(sourceId);
    setView('source');
    if (sources.length > 0) return;
    try {
      const response = await fetchSources();
      setSources(response.sources);
    } catch {
      // La fiche reste lisible sans l'encart « Collecte » (§69).
    }
  };

  const selected = listings.find((listing) => listing.id === selectedId) ?? null;

  // DÉCLARÉ ICI, avec les autres actions sur une annonce, et non plus après le
  // rendu de la liste : la vue FICHE sort du composant par un `return` anticipé,
  // si bien que la déclaration qui suivait n'était jamais atteinte. Le cœur de
  // la fiche capturait alors une liaison non initialisée, et le clic levait une
  // `ReferenceError` au lieu d'enregistrer le favori.
  const handleFavorite = async (id: string, favorite: boolean): Promise<void> => {
    // Optimiste ; si on n'affiche que les favoris, retirer un favori le fait
    // disparaître de la liste.
    setListings((current) =>
      !favorite && favoritesOnly
        ? current.filter((listing) => listing.id !== id)
        : current.map((listing) => (listing.id === id ? { ...listing, favorite } : listing)),
    );
    try {
      await setFavorite(id, favorite);
    } catch {
      setError('Le favori n’a pas pu être enregistré');
    }
  };

  const handleArchive = async (id: string, archived: boolean): Promise<void> => {
    // Optimiste : si on archive et qu'on ne montre pas les archivées, l'annonce
    // disparaît de la liste ; sinon on met simplement à jour son état.
    setListings((current) =>
      archived && !showArchived
        ? current.filter((listing) => listing.id !== id)
        : current.map((listing) => (listing.id === id ? { ...listing, archived } : listing)),
    );
    // Archiver depuis la fiche renvoie à la liste : l'annonce n'y est plus.
    if (view === 'detail' && archived) setView('list');
    try {
      await setArchived(id, archived);
    } catch {
      setError('L’archivage n’a pas pu être enregistré');
    }
  };
  const handleTrackingChange = async (status: TrackingStatus): Promise<void> => {
    if (selected === null) return;
    setListings((current) =>
      current.map((listing) =>
        listing.id === selected.id ? { ...listing, tracking: status } : listing,
      ),
    );
    try {
      await updateTracking(selected.id, status);
    } catch {
      setError('Le statut n’a pas pu être enregistré');
    }
  };

  const handleContactRecorded = async (
    channel: string,
    message: string,
    documents: readonly string[],
  ): Promise<void> => {
    if (selected === null) return;
    const sourceId = selected.occurrences[0]?.sourceId ?? 'unknown';
    setListings((current) =>
      current.map((listing) =>
        listing.id === selected.id ? { ...listing, tracking: 'contacted' as const } : listing,
      ),
    );
    try {
      await recordContact(selected.id, { channel, message, sourceId, documents });
    } catch {
      setError('Le contact n’a pas pu être enregistré');
    }
  };

  // Onglet bas actif. « Favoris » n'est pas une vue mais la liste filtrée :
  // le même état sert au réglage de la modale, et deux sources de vérité
  // auraient fini par diverger.
  const bottomTab = bottomTabFor(view, favoritesOnly, sortFilterOpen);

  const selectBottomTab = (tab: BottomTab): void => {
    if (tab === 'search') {
      // « Recherche » OUVRE LA RECHERCHE, et non le menu de tri. Le geste
      // ouvrait une modale par-dessus la page qu'on quittait : on demandait à
      // voir des annonces, on obtenait un panneau de réglages.
      setFavoritesOnly(false);
      setSortFilterOpen(false);
      setView('list');
      return;
    }
    if (tab === 'settings') return setView('profile');
    if (tab === 'home') {
      setFavoritesOnly(false);
      setView('home');
      return;
    }
    // Favoris : la même liste, filtrée.
    setFavoritesOnly(true);
    setView('list');
  };

  /** Rappelle une recherche enregistrée : critères, affinage et tri. */
  const applySavedSearch = async (saved: SavedSearch): Promise<void> => {
    setQuickFilters(toQuickFilters(saved.view));
    setSelectedSources(new Set(saved.view.sources ?? []));
    setSort(saved.view.sort ?? 'priority');
    setSearch(saved.view.search ?? '');
    setFavoritesOnly(false);
    setView('list');
    try {
      // Les critères repartent en base : ils décident de ce que la PROCHAINE
      // collecte ramènera, pas seulement de ce qu'on regarde aujourd'hui.
      await saveFilters(saved.criteria);
      await load();
    } catch {
      setError('Les critères de cette recherche n’ont pas pu être appliqués');
    }
  };

  /** Enregistre l'état courant de la recherche sous un nom. */
  const saveCurrentSearch = async (name: string): Promise<void> => {
    try {
      const criteria = await fetchFilters();
      const entry: SavedSearch = {
        id: newSearchId(),
        name,
        createdAt: new Date().toISOString(),
        criteria,
        view: toSavedView(quickFilters, { sources: selectedSources, sort, search }),
      };
      const next = [entry, ...savedSearches];
      await saveSavedSearches(next);
      setSavedSearches(next);
    } catch {
      setError('La recherche n’a pas pu être enregistrée');
    }
  };

  /** Renomme une recherche. Le nom est la seule chose qu'on relit vraiment. */
  const renameSavedSearch = async (id: string, name: string): Promise<void> => {
    const next = savedSearches.map((saved) => (saved.id === id ? { ...saved, name } : saved));
    setSavedSearches(next);
    try {
      await saveSavedSearches(next);
    } catch {
      setError('Le nouveau nom n’a pas pu être enregistré');
    }
  };

  const deleteSavedSearch = async (id: string): Promise<void> => {
    const next = savedSearches.filter((saved) => saved.id !== id);
    setSavedSearches(next);
    try {
      await saveSavedSearches(next);
    } catch {
      setError('La suppression n’a pas pu être enregistrée');
    }
  };

  /**
   * Combien d'annonces DÉJÀ CHARGÉES une recherche enregistrée laisserait
   * passer.
   *
   * Approximation assumée : on n'applique que l'affinage, pas les critères de
   * collecte — ceux-ci décident de ce qui a été RAMENÉ, et l'appliquer
   * demanderait de recharger depuis la base pour chaque recherche affichée
   * (§30). Le chiffre reste un ordre de grandeur utile pour reconnaître sa
   * recherche, et le libellé ne promet rien de plus.
   */
  const countForSearch = (saved: SavedSearch): number => {
    const quick = toQuickFilters(saved.view);
    const sources = new Set(saved.view.sources ?? []);
    return listings.filter((listing) => {
      if (listing.lifecycle !== 'active') return false;
      if (!matchesQuickFilters(listing, quick)) return false;
      if (sources.size === 0) return true;
      return listing.occurrences.some((one) => sources.has(one.sourceId));
    }).length;
  };

  // Les bandeaux d'alerte flottent AU-DESSUS de la vue courante, quelle qu'elle
  // soit : une annonce trouvée pendant qu'on lit une fiche doit se voir aussi.
  // D'où ce fragment répété aux trois sorties du composant.
  const overlay = <ToastStack toasts={toasts} onOpen={openListing} onDismiss={dismissToast} />;

  // On ne sait pas encore qui regarde : un instant blanc vaut mieux qu'un
  // écran de connexion qui clignote chez quelqu'un déjà connecté.
  if (currentUser === undefined) return <></>;

  // Personne n'est connecté, et cet accès l'exige : rien ne s'affiche avant.
  if (currentUser === null) {
    return (
      <LoginScreen
        onSignedIn={() => {
          setCurrentUser('inconnu');
          void fetchCurrentUser()
            .then(setCurrentUser)
            .catch(() => setCurrentUser(null));
        }}
      />
    );
  }

  // Vues « secondaires » (plein écran), regroupées hors du corps principal pour
  // garder App lisible : chacune rend sa coquille ou `null` si non concernée.
  const secondaryView = (): React.JSX.Element | null => {
    if (view === 'home') {
      return (
        <Shell
          view={view}
          favoritesOnly={favoritesOnly}
          onNavigate={navigate}
          unreadAlerts={unreadAlerts}
          bottomTab={bottomTab}
          onBottomSelect={selectBottomTab}
        >
          <HomePanel
            listings={listings}
            sources={sources}
            savedSearches={savedSearches}
            nowMs={nowMs}
            seenAtMs={alertsViewedFrom}
            profileComplete={profile !== null}
            onOpenListing={openListing}
            onOpenSearch={() => {
              setFavoritesOnly(false);
              setView('list');
            }}
            onOpenFavorites={() => {
              setFavoritesOnly(true);
              setView('list');
            }}
            onOpenAlerts={() => navigate('alerts')}
            onOpenSavedSearches={() => setView('saved')}
            onOpenProfile={() => {
              setEditingProfile(true);
              setView('tenant');
            }}
            onApplySearch={(saved) => void applySavedSearch(saved)}
          />
        </Shell>
      );
    }
    if (view === 'alerts') {
      return (
        <main className="mx-auto max-w-[720px] px-3 py-4 pb-12 sm:px-4 sm:py-6 sm:pb-16">
          <Button variant="ghost" className="mb-2" onClick={() => setView('home')}>
            <ArrowLeft aria-hidden="true" className="size-4" /> Retour
          </Button>
          <NotificationsPanel
            listings={listings}
            nowMs={nowMs}
            onOpen={openListing}
            seenAtMs={alertsViewedFrom}
          />
        </main>
      );
    }
    // PARAMÈTRES : rien que des chemins. Le profil locataire et les pièces du
    // dossier occupaient tout le premier écran — huit champs et une liste de
    // fichiers pour deux réglages qu'on touche une fois. Ils ont maintenant
    // leur page, comme les autres.
    if (view === 'profile') {
      return (
        <Shell
          view={view}
          favoritesOnly={favoritesOnly}
          onNavigate={navigate}
          unreadAlerts={unreadAlerts}
          bottomTab={bottomTab}
          onBottomSelect={selectBottomTab}
        >
          <h1 className="mb-3 text-xl font-bold">Paramètres</h1>
          {/* Le seul réglage qui vaut d'être ici, plutôt que derrière un lien :
            on l'allume une fois, et c'est lui qui fait vivre l'outil. */}
          <AlertsToggle />
          {/* `navigate` et non `setView` : certaines vues doivent CHARGER
            leurs données avant d'apparaître (les sources, notamment). */}
          <SettingsLinks onNavigate={(key) => navigate(key as View)} bare />
        </Shell>
      );
    }
    if (view === 'documents') {
      return (
        <Shell
          view={view}
          favoritesOnly={favoritesOnly}
          onNavigate={navigate}
          unreadAlerts={unreadAlerts}
          bottomTab={bottomTab}
          onBottomSelect={selectBottomTab}
        >
          <Button variant="ghost" className="mb-2" onClick={() => setView('profile')}>
            <ArrowLeft aria-hidden="true" className="size-4" /> Retour
          </Button>
          <DocumentsSection />
        </Shell>
      );
    }
    if (view === 'reference') {
      return (
        <Shell
          view={view}
          favoritesOnly={favoritesOnly}
          onNavigate={navigate}
          unreadAlerts={unreadAlerts}
          bottomTab={bottomTab}
          onBottomSelect={selectBottomTab}
        >
          <Button variant="ghost" className="mb-2" onClick={() => setView('profile')}>
            <ArrowLeft aria-hidden="true" className="size-4" /> Retour
          </Button>
          <ReferencePointsSection />
        </Shell>
      );
    }
    if (view === 'saved') {
      return (
        <Shell
          view={view}
          favoritesOnly={favoritesOnly}
          onNavigate={navigate}
          unreadAlerts={unreadAlerts}
          bottomTab={bottomTab}
          onBottomSelect={selectBottomTab}
        >
          <SavedSearchesPanel
            searches={savedSearches}
            nowMs={nowMs}
            available={savedSearchesAvailable()}
            countFor={countForSearch}
            onBack={() => setView('profile')}
            onApply={(saved) => void applySavedSearch(saved)}
            onDelete={(id) => void deleteSavedSearch(id)}
            onRename={(id, name) => void renameSavedSearch(id, name)}
            onSaveCurrent={(name) => void saveCurrentSearch(name)}
            suggestion={suggestName(
              {
                cities: [...MVP_CRITERIA.cities],
                maxPrice: MVP_CRITERIA.maxPrice,
                minArea: MVP_CRITERIA.minArea,
              },
              quickFilters,
            )}
          />
        </Shell>
      );
    }
    if (view === 'tenant') {
      return (
        <Shell
          view={view}
          favoritesOnly={favoritesOnly}
          onNavigate={navigate}
          unreadAlerts={unreadAlerts}
          bottomTab={bottomTab}
          onBottomSelect={selectBottomTab}
        >
          <Button
            variant="ghost"
            className="mb-2"
            onClick={() => {
              setEditingProfile(false);
              setView('profile');
            }}
          >
            <ArrowLeft aria-hidden="true" className="size-4" /> Retour
          </Button>
          {/* Le formulaire ne s'ouvre QUE pour modifier — huit champs dépliés
            en permanence, pour un profil qu'on remplit une fois, occupaient
            l'écran sans rien apprendre. SAUF quand il n'y a rien à résumer :
            un profil vide n'affichait qu'une phrase et un bouton « Renseigner
            mon profil », soit un écran entier pour un clic. On ouvre alors
            directement le formulaire. */}
          {editingProfile || profile === null ? (
            <ProfileForm
              initial={profile}
              onSave={(next) => {
                saveProfile(next);
                setProfile(next);
                setEditingProfile(false);
                // On revient à l'annonce d'où l'on venait : le profil n'est
                // presque jamais une fin en soi, il sert à écrire un message.
                setView(selectedId !== null ? 'detail' : 'profile');
              }}
              onCancel={() => {
                setEditingProfile(false);
                setView(selectedId !== null ? 'detail' : 'profile');
              }}
              onClear={() => {
                clearProfile();
                setProfile(null);
                setEditingProfile(false);
              }}
            />
          ) : (
            <ProfileSummary profile={profile} onEdit={() => setEditingProfile(true)} />
          )}
        </Shell>
      );
    }
    if (view === 'sources') {
      return (
        <Shell
          view={view}
          favoritesOnly={favoritesOnly}
          onNavigate={navigate}
          unreadAlerts={unreadAlerts}
          bottomTab={bottomTab}
          onBottomSelect={selectBottomTab}
        >
          <SourcesPanel
            sources={sources}
            nowMs={nowMs}
            onBack={() => setView('profile')}
            onOpenSource={(sourceId) => void openSource(sourceId)}
          />
        </Shell>
      );
    }
    if (view === 'source' && selectedSourceId !== null) {
      return (
        <Shell
          view={view}
          favoritesOnly={favoritesOnly}
          onNavigate={navigate}
          unreadAlerts={unreadAlerts}
          bottomTab={bottomTab}
          onBottomSelect={selectBottomTab}
        >
          <SourcePanel
            sourceId={selectedSourceId}
            state={sources.find((one) => one.sourceId === selectedSourceId) ?? null}
            listings={listings}
            nowMs={nowMs}
            onBack={() => setView('sources')}
            onSelect={openListing}
            onFavorite={(id, favorite) => void handleFavorite(id, favorite)}
          />
        </Shell>
      );
    }
    if (view === 'stats') {
      return (
        <Shell
          view={view}
          favoritesOnly={favoritesOnly}
          onNavigate={navigate}
          unreadAlerts={unreadAlerts}
          bottomTab={bottomTab}
          onBottomSelect={selectBottomTab}
        >
          <StatsPanel />
        </Shell>
      );
    }
    if (view === 'detail' && selected !== null) {
      return (
        <Shell
          view={view}
          favoritesOnly={favoritesOnly}
          onNavigate={navigate}
          unreadAlerts={unreadAlerts}
          bottomTab={bottomTab}
          onBottomSelect={selectBottomTab}
        >
          <ListingDetail
            listing={selected}
            profile={profile}
            nowMs={nowMs}
            onBack={() => setView('list')}
            onArchive={(archived) => void handleArchive(selected.id, archived)}
            onFavorite={(favorite) => void handleFavorite(selected.id, favorite)}
            onTrackingChange={(status) => void handleTrackingChange(status)}
            onContactRecorded={(channel, message, documents) =>
              void handleContactRecorded(channel, message, documents)
            }
            onOpenSource={(sourceId) => void openSource(sourceId)}
            onConfigureProfile={() => {
              // Venir de « Configurer mon profil », c'est vouloir le remplir :
              // le résumé ferait faire un clic de plus pour rien.
              setEditingProfile(true);
              setView('tenant');
            }}
          />
        </Shell>
      );
    }
    return null;
  };

  const secondary = secondaryView();
  if (secondary !== null) {
    return (
      <>
        {secondary}
        {overlay}
      </>
    );
  }

  // Deux compteurs distincts pour la liste : les annonces encore actives, et
  // celles qui ont disparu de leur source (affichées, mais à vérifier).
  const activeCount = filtered.filter((l) => l.lifecycle === 'active').length;
  const uncertainCount = filtered.filter((l) => l.lifecycle === 'possiblyInactive').length;
  // RÉINITIALISATION. « Par défaut » = le tri par priorité, les critères de
  // recherche dans les champs, aucune bascule, toutes les sources — c'est-à-dire
  // exactement l'écran d'ouverture. La recherche textuelle en fait partie : la
  // laisser en place après un « Réinitialiser » surprendrait.
  const somethingChanged = isDefaultView({
    sort,
    quickFilters,
    sourceCount: selectedSources.size,
    search,
    toggles: [favoritesOnly, includeOutOfCriteria, showArchived, hideUncertain],
  });

  const resetSortAndFilters = (): void => {
    setSort('priority');
    setQuickFilters(DEFAULT_QUICK_FILTERS);
    setSelectedSources(new Set());
    setSearch('');
    setFavoritesOnly(false);
    setIncludeOutOfCriteria(false);
    setShowArchived(false);
    setHideUncertain(false);
  };

  const toolbarBadge = countActiveSettings({
    sort,
    sourceCount: selectedSources.size,
    toggles: [favoritesOnly, includeOutOfCriteria, showArchived, hideUncertain],
  });

  const toggleSource = (sourceId: string): void =>
    setSelectedSources((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });

  return (
    <Shell
      view={view}
      favoritesOnly={favoritesOnly}
      onNavigate={navigate}
      unreadAlerts={unreadAlerts}
      bottomTab={bottomTab}
      onBottomSelect={selectBottomTab}
    >
      {isDemoMode() && (
        <p
          className="my-2 rounded-xl border border-border bg-primary/10 px-3 py-2 text-[0.85rem]"
          role="status"
        >
          Mode démonstration — données fictives. Définissez <code>VITE_API_URL</code> pour vous
          connecter à vos données.
        </p>
      )}

      {/* FAVORIS : rien que les cartes. Chercher, trier ou filtrer une liste
        qu'on a soi-même constituée n'a pas de sens — on y vient pour revoir ce
        qu'on a retenu, pas pour l'explorer. La barre entière disparaît donc,
        recherche comprise. */}
      {favoritesOnly ? (
        <header className="my-3 flex items-baseline gap-2">
          <h2 className="text-lg font-bold">Favoris</h2>
          {/* Le compteur est un repère, pas un sous-titre : il se lit à droite,
            comme celui de la liste principale — y compris sur téléphone. */}
          <span className="ml-auto text-sm font-semibold text-muted-foreground">
            {filtered.length} annonce{filtered.length > 1 ? 's' : ''}
          </span>
        </header>
      ) : (
        <div
          className="my-3 flex flex-col gap-2 text-sm"
          role="group"
          aria-label="Barre de filtres"
        >
          {/* Recherche et réglages occupent leur PROPRE RANGÉE, à toute largeur.
          La bascule et le compteur ne passaient dessous que par un repli de
          mobile ; sur grand écran tout s'alignait sur une seule ligne, et la
          recherche s'y trouvait comprimée entre des commandes sans rapport.
          Deux rangées explicites valent mieux qu'un `flex-wrap` dont le
          résultat dépend de la largeur. */}
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher (quartier, rue, agence…)"
                aria-label="Rechercher une annonce"
                // 16 px (`text-base`) sur mobile : en dessous, iOS zoome
                // automatiquement à la mise au point et désaligne la page.
                className="w-full rounded-full border border-input bg-card py-2.5 pl-9 pr-3 text-base sm:py-1.5 sm:text-sm"
              />
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
            </div>

            {/* Tri, affichage et sources dans une seule modale : trois menus
              côte à côte tenaient mal, et rien ne disait qu'ils formaient un
              même réglage (§36). Le libellé disparaît sur mobile — l'icône et
              la pastille suffisent, et la recherche gagne la place. */}
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              aria-label="Trier et filtrer"
              onClick={() => setSortFilterOpen(true)}
            >
              <SlidersHorizontal aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">Trier et filtrer</span>
              {toolbarBadge > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                  {toolbarBadge}
                </span>
              )}
            </Button>
          </div>

          {/* Seconde rangée : bascule de vue à gauche, compteur à droite. */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Bascule Liste ⇄ Carte, SUR PETIT ÉCRAN SEULEMENT. Au-dessus de
              1024 px les deux s'affichent côte à côte : il n'y a plus rien à
              choisir, et un bouton qui ne change rien est pire qu'absent. */}
            <div
              className="inline-flex rounded-lg border border-border p-0.5 lg:hidden"
              role="group"
            >
              <button
                type="button"
                onClick={() => setDisplayMode('list')}
                aria-pressed={displayMode === 'list'}
                className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-3 font-medium transition-colors ${
                  displayMode === 'list'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <List aria-hidden="true" className="size-4" /> Liste
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('map')}
                aria-pressed={displayMode === 'map'}
                className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-3 font-medium transition-colors ${
                  displayMode === 'map'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Map aria-hidden="true" className="size-4" /> Carte
              </button>
            </div>

            {/* Compteur de résultats, poussé à droite (repère façon SeLoger).
            Il distingue les annonces ACTIVES de celles disparues de leur source :
            un total unique laissait croire à deux fois plus d'opportunités, et
            divergeait du compteur de l'onglet Statistiques (§33, §17). */}
            {!loading && (
              <span className="ml-auto font-semibold text-muted-foreground" aria-live="polite">
                {activeCount} résultat{activeCount > 1 ? 's' : ''}
                {uncertainCount > 0 && (
                  <span className="font-normal"> · {uncertainCount} à vérifier</span>
                )}
              </span>
            )}
          </div>

          <SortFilterModal
            open={sortFilterOpen}
            onClose={() => setSortFilterOpen(false)}
            sort={sort}
            onSortChange={setSort}
            sortOptions={SORT_OPTIONS}
            toggles={[
              ['Masquer les annonces à vérifier', hideUncertain, setHideUncertain],
              ['Favoris uniquement', favoritesOnly, setFavoritesOnly],
              ['Annonces hors critères', includeOutOfCriteria, setIncludeOutOfCriteria],
              ['Annonces archivées', showArchived, setShowArchived],
            ]}
            quickFilters={quickFilters}
            onQuickFiltersChange={setQuickFilters}
            availableTypes={availableTypes}
            sources={availableSources}
            selectedSources={selectedSources}
            onToggleSource={toggleSource}
            onClearSources={() => setSelectedSources(new Set())}
            resultCount={filtered.length}
            dirty={somethingChanged}
            onReset={resetSortAndFilters}
          />

          {/* Rangée des filtres rapides. */}
          <QuickFilters values={quickFilters} onChange={setQuickFilters} />
        </div>
      )}

      {error !== null && (
        <p className="rounded-xl border border-bad px-3 py-2 text-bad" role="alert">
          {error}
        </p>
      )}

      <SearchResults
        loading={loading}
        filtered={filtered}
        ranked={ranked}
        hot={hot}
        rest={rest}
        split={displayMode === 'map' || wideScreen}
        favoritesOnly={favoritesOnly}
        emptyBecauseFiltered={hasActiveQuickFilters(quickFilters) || selectedSources.size > 0}
        nowMs={nowMs}
        affinity={affinity}
        onOpen={openListing}
        onFavorite={(id, favorite) => void handleFavorite(id, favorite)}
      />
      {overlay}
    </Shell>
  );
}
