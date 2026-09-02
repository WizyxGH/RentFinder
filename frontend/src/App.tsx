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
  fetchListings,
  fetchSources,
  isDemoMode,
  isUnconfigured,
  markViewed,
  recordContact,
  setArchived,
  setFavorite,
  updateTracking,
} from './api/client.js';
import { clearProfile, loadProfile, saveProfile } from './profile.js';
import { AFFINITY_BOOST, computeAffinity } from './affinity.js';
import { formatSourceName } from './format.js';
import {
  diffForNotification,
  fireNotifications,
  NOTIFY_POLL_MS,
  notificationPermission,
  readOptIn,
  readSeen,
  writeSeen,
} from './notifications.js';
import { Button } from '@/components/ui/button.js';
import { DocumentsSection } from './components/DocumentsSection.js';
import { ListingCard } from './components/ListingCard.js';
import { NotificationBell } from './components/NotificationBell.js';
import { ListingDetail } from './components/ListingDetail.js';
import { ProfileForm } from './components/ProfileForm.js';
import { SourcesPanel } from './components/SourcesPanel.js';
import { FiltersPanel } from './components/FiltersPanel.js';
import { StatsPanel } from './components/StatsPanel.js';
import { Flame, List, Map, Search, SlidersHorizontal } from 'lucide-react';
import { SortFilterModal } from './components/SortFilterModal.js';
import { ConnectPanel } from './components/ConnectPanel.js';
import {
  QuickFilters,
  EMPTY_QUICK_FILTERS,
  hasActiveQuickFilters,
  matchesQuickFilters,
  type QuickFilterValues,
} from './components/QuickFilters.js';
import { matchesSearch } from './search.js';

// Leaflet n'entre dans le bundle que si la vue carte est ouverte (§65).
const MapView = lazy(() => import('./components/MapView.js'));

type View = 'list' | 'detail' | 'filters' | 'stats' | 'profile' | 'sources';

/** Seuil de mise en avant : au-delà, l'annonce mérite un contact immédiat. */
const HOT_PRIORITY = 85;

/** Options de tri de la liste (§36). L'ordre définit celui du menu. */
const SORT_OPTIONS: readonly { value: SortMode; label: string }[] = [
  { value: 'priority', label: 'Priorité d’action' },
  { value: 'recent', label: 'Plus récentes' },
  { value: 'price', label: 'Loyer croissant' },
];

/**
 * Bandeau de synthèse (§33) : de quoi comprendre l'état de la recherche d'un
 * coup d'œil, sans page dédiée. Calculé depuis les annonces déjà chargées —
 * aucun appel supplémentaire.
 */
function StatsStrip({
  listings,
}: {
  readonly listings: readonly ListingView[];
}): React.JSX.Element {
  const hot = listings.filter((l) => l.actionPriority >= HOT_PRIORITY).length;
  const contacted = listings.filter((l) =>
    ['contacted', 'replied', 'visitOffered', 'visitScheduled', 'visited'].includes(l.tracking),
  ).length;
  const replied = listings.filter((l) =>
    ['replied', 'visitOffered', 'visitScheduled', 'visited'].includes(l.tracking),
  ).length;

  const cells: readonly { label: string; value: number; tone?: string }[] = [
    { label: 'pertinentes', value: listings.length },
    { label: 'à contacter', value: hot, tone: 'text-hot' },
    { label: 'contactées', value: contacted },
    { label: 'réponses', value: replied, tone: 'text-good' },
  ];

  return (
    <dl className="my-3 grid grid-cols-4 gap-2">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="rounded-xl border border-border bg-card px-2 py-2 text-center"
        >
          <dd className={`text-xl font-bold ${cell.tone ?? ''}`}>{cell.value}</dd>
          <dt className="text-[0.7rem] text-muted-foreground">{cell.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/**
 * Coquille commune : en-tête persistant + navigation par onglets.
 * L'onglet actif est souligné — l'utilisateur sait toujours où il est.
 */
function Shell({
  view,
  onNavigate,
  children,
}: {
  readonly view: View;
  readonly onNavigate: (view: View) => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const tabs: readonly { key: View; label: string }[] = [
    { key: 'list', label: 'Annonces' },
    // « Alertes » plutôt que « Filtres » : ces critères décident de ce qui est
    // COLLECTÉ et NOTIFIÉ, alors que la modale de la liste ne filtre que
    // l'affichage. Deux choses différentes portaient le même nom.
    { key: 'filters', label: 'Alertes' },
    { key: 'stats', label: 'Stats' },
    { key: 'profile', label: 'Profil' },
    { key: 'sources', label: 'Sources' },
  ];
  // La fiche appartient à l'univers « Annonces ».
  const active = view === 'detail' ? 'list' : view;

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
          <h1 className="text-2xl font-bold tracking-tight">Recherche Nice</h1>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              ≤ {MVP_CRITERIA.maxPrice} € · ≥ {MVP_CRITERIA.minArea} m²
            </p>
            <NotificationBell />
          </div>
        </div>
        <nav
          className="mt-3 flex gap-1 overflow-x-auto border-b border-border [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
      {children}
    </main>
  );
}

export function App(): React.JSX.Element {
  const [listings, setListings] = useState<readonly ListingView[]>([]);
  const [sources, setSources] = useState<readonly SourceStateView[]>([]);
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('priority');
  const [sortFilterOpen, setSortFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [hideUncertain, setHideUncertain] = useState(false);
  const [includeOutOfCriteria, setIncludeOutOfCriteria] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // Filtre par source : ensemble vide = toutes les sources affichées. Une
  // annonce passe si l'une de ses occurrences vient d'une source sélectionnée.
  const [selectedSources, setSelectedSources] = useState<ReadonlySet<string>>(new Set());
  // Filtres rapides façon SeLoger (budget, surface, pièces, type) : affinent la
  // liste déjà chargée, sans toucher aux critères de collecte (§66).
  const [quickFilters, setQuickFilters] = useState<QuickFilterValues>(EMPTY_QUICK_FILTERS);
  // Liste ⇄ Carte : deux façons de parcourir les mêmes annonces (§36, §39).
  const [displayMode, setDisplayMode] = useState<'list' | 'map'>('list');
  const [profile, setProfile] = useState<TenantProfile | null>(() => loadProfile());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Instant de rendu, figé par chargement : évite que chaque carte recalcule
  // « il y a X min » à partir d'une horloge légèrement différente.
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Affinité : apprend de vos consultations/suivis/archivages pour remonter les
  // annonces qui vous ressemblent (§33). Hook placé AVANT tout return
  // conditionnel (règle des hooks). Recalculée quand la liste change.
  const affinity = useMemo(() => computeAffinity(listings), [listings]);

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
    const byQuick = bySource.filter((l) => matchesQuickFilters(l, quickFilters));
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
  const hot = useMemo(
    () => (sort === 'priority' ? ranked.filter((l) => l.actionPriority >= HOT_PRIORITY) : []),
    [ranked, sort],
  );
  const rest = useMemo(
    () => (sort === 'priority' ? ranked.filter((l) => l.actionPriority < HOT_PRIORITY) : ranked),
    [ranked, sort],
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
    void load();
  }, [load]);

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
  }, []);

  // Consultée SANS navigation : clic « Voir l'annonce » (ouvre l'agence dans un
  // nouvel onglet) — on marque quand même l'annonce comme vue (§37).
  const markSeen = useCallback((id: string): void => {
    setListings((current) =>
      current.map((listing) => (listing.id === id ? { ...listing, viewed: true } : listing)),
    );
    void markViewed(id).catch(() => {
      /* l'échec réseau n'empêche pas d'ouvrir l'annonce */
    });
  }, []);

  // Notifications navigateur des nouvelles annonces, site ouvert (§29). Sonde
  // périodiquement, indépendamment des filtres d'affichage, et ne notifie que
  // si l'utilisateur a donné sa permission ET activé la cloche. Le premier
  // sondage amorce la mémoire sans sonner (voir `diffForNotification`).
  useEffect(() => {
    if (isDemoMode()) return; // pas de vraies données à surveiller

    let cancelled = false;
    const tick = async (): Promise<void> => {
      if (!readOptIn() || notificationPermission() !== 'granted') return;
      try {
        const response = await fetchListings({ sort: 'recent' });
        if (cancelled) return;
        const { fresh, nextSeen } = diffForNotification(response.listings, readSeen());
        writeSeen(nextSeen);
        fireNotifications(fresh, openListing);
      } catch {
        /* réseau indisponible : nouveau sondage au prochain tick */
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), NOTIFY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [openListing]);

  const navigate = (next: View): void => {
    if (next === 'sources') {
      void openSources();
      return;
    }
    if (next === 'list') setSelectedId(null);
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

  const selected = listings.find((listing) => listing.id === selectedId) ?? null;

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

  // Pas d'accès à la base : on demande les identifiants et on s'arrête là.
  // Sans eux, rien ne s'affiche — c'est la protection du site.
  if (isUnconfigured()) {
    return (
      <Shell view={view} onNavigate={navigate}>
        <ConnectPanel />
      </Shell>
    );
  }

  // Vues « secondaires » (plein écran), regroupées hors du corps principal pour
  // garder App lisible : chacune rend sa coquille ou `null` si non concernée.
  const secondaryView = (): React.JSX.Element | null => {
    if (view === 'profile') {
      return (
        <Shell view={view} onNavigate={navigate}>
          <ProfileForm
            initial={profile}
            onSave={(next) => {
              saveProfile(next);
              setProfile(next);
              setView(selectedId === null ? 'list' : 'detail');
            }}
            onCancel={() => setView(selectedId === null ? 'list' : 'detail')}
            onClear={() => {
              clearProfile();
              setProfile(null);
              setView('list');
            }}
          />
          <DocumentsSection />
        </Shell>
      );
    }
    if (view === 'sources') {
      return (
        <Shell view={view} onNavigate={navigate}>
          <SourcesPanel sources={sources} nowMs={nowMs} onBack={() => setView('list')} />
        </Shell>
      );
    }
    if (view === 'filters') {
      return (
        <Shell view={view} onNavigate={navigate}>
          <FiltersPanel
            onSaved={() => {
              void load();
            }}
          />
        </Shell>
      );
    }
    if (view === 'stats') {
      return (
        <Shell view={view} onNavigate={navigate}>
          <StatsPanel />
        </Shell>
      );
    }
    if (view === 'detail' && selected !== null) {
      return (
        <Shell view={view} onNavigate={navigate}>
          <ListingDetail
            listing={selected}
            profile={profile}
            nowMs={nowMs}
            onBack={() => setView('list')}
            onTrackingChange={(status) => void handleTrackingChange(status)}
            onContactRecorded={(channel, message, documents) =>
              void handleContactRecorded(channel, message, documents)
            }
            onConfigureProfile={() => setView('profile')}
          />
        </Shell>
      );
    }
    return null;
  };

  const secondary = secondaryView();
  if (secondary !== null) return secondary;

  // Pastille du bouton « Trier et filtrer » : nombre de réglages qui écartent
  // l'affichage du réglage par défaut (tri par priorité, aucune bascule, toutes
  // les sources).
  const activeFilterCount =
    (favoritesOnly ? 1 : 0) +
    (includeOutOfCriteria ? 1 : 0) +
    (showArchived ? 1 : 0) +
    (hideUncertain ? 1 : 0);
  // Deux compteurs distincts pour la liste : les annonces encore actives, et
  // celles qui ont disparu de leur source (affichées, mais à vérifier).
  const activeCount = filtered.filter((l) => l.lifecycle === 'active').length;
  const uncertainCount = filtered.filter((l) => l.lifecycle === 'possiblyInactive').length;
  const toolbarBadge =
    activeFilterCount + (sort !== 'priority' ? 1 : 0) + (selectedSources.size > 0 ? 1 : 0);

  const toggleSource = (sourceId: string): void =>
    setSelectedSources((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });

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
    if (view === 'detail' && archived) setView('list');
    try {
      await setArchived(id, archived);
    } catch {
      setError('L’archivage n’a pas pu être enregistré');
    }
  };

  return (
    <Shell view={view} onNavigate={navigate}>
      {isDemoMode() && (
        <p
          className="my-2 rounded-xl border border-border bg-primary/10 px-3 py-2 text-[0.85rem]"
          role="status"
        >
          Mode démonstration — données fictives. Définissez <code>VITE_API_URL</code> pour vous
          connecter à vos données.
        </p>
      )}

      {/* Barre d'outils façon SeLoger : une rangée « vue + tri + affichage +
          sources » et son compteur, puis une rangée de filtres rapides (budget,
          surface, pièces, type) avec puces actives. Se replie sur mobile (§39). */}
      <div className="my-3 flex flex-col gap-2 text-sm" role="group" aria-label="Barre de filtres">
        <div className="flex flex-wrap items-center gap-2">
          {/* Bascule Liste ⇄ Carte. */}
          <div className="inline-flex rounded-lg border border-border p-0.5" role="group">
            <button
              type="button"
              onClick={() => setDisplayMode('list')}
              aria-pressed={displayMode === 'list'}
              className={`min-h-9 cursor-pointer rounded-md px-3 font-medium transition-colors ${
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
              className={`min-h-9 cursor-pointer rounded-md px-3 font-medium transition-colors ${
                displayMode === 'map'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Map aria-hidden="true" className="size-4" /> Carte
            </button>
          </div>

          {/* Recherche libre : quartier, rue, agence, mot du titre (§36). */}
          {/* `basis-full` lui donne SA PROPRE LIGNE sur mobile — coincée entre
            deux boutons, elle devenait trop étroite pour être utilisable. Sur
            écran large elle repasse dans la rangée et occupe l'espace restant
            (`sm:basis-0 sm:flex-1`), sans plafond de largeur. */}
          <div className="relative min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">
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

          {/* Tri, affichage et sources sont regroupés dans une seule modale :
            trois menus déroulants côte à côte tenaient mal sur mobile et rien
            ne disait qu'ils formaient un même réglage (§36). */}
          <Button variant="outline" size="sm" onClick={() => setSortFilterOpen(true)}>
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            Trier et filtrer
            {toolbarBadge > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                {toolbarBadge}
              </span>
            )}
          </Button>

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
        />

        {/* Rangée des filtres rapides. */}
        <QuickFilters values={quickFilters} onChange={setQuickFilters} />
      </div>

      {error !== null && (
        <p className="rounded-xl border border-bad px-3 py-2 text-bad" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-muted-foreground">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          {hasActiveQuickFilters(quickFilters) || selectedSources.size > 0
            ? 'Aucune annonce ne correspond à ces filtres.'
            : 'Aucune annonce ne correspond à vos critères pour l’instant.'}
        </p>
      ) : displayMode === 'map' ? (
        <>
          <StatsStrip listings={filtered} />
          <Suspense
            fallback={
              <p className="py-8 text-center text-muted-foreground">Chargement de la carte…</p>
            }
          >
            <MapView listings={ranked} onOpen={openListing} />
          </Suspense>
        </>
      ) : (
        <>
          <StatsStrip listings={filtered} />
          {hot.length > 0 && (
            <section aria-labelledby="hot-title" className="mb-6">
              <h2 id="hot-title" className="mb-2 text-lg font-bold">
                <Flame aria-hidden="true" className="size-4" /> À contacter maintenant
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {hot.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    nowMs={nowMs}
                    onOpen={openListing}
                    onView={markSeen}
                    onArchive={(archived) => void handleArchive(listing.id, archived)}
                    onFavorite={(favorite) => void handleFavorite(listing.id, favorite)}
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
              {rest.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  nowMs={nowMs}
                  onOpen={openListing}
                  onView={markSeen}
                  onArchive={(archived) => void handleArchive(listing.id, archived)}
                  onFavorite={(favorite) => void handleFavorite(listing.id, favorite)}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </Shell>
  );
}
