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

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TenantProfile } from '@rentfinder/shared';
import { MVP_CRITERIA } from '@rentfinder/shared';
import type { ListingView, SortMode, SourceStateView, TrackingStatus } from './types.js';
import {
  ApiError,
  fetchListings,
  fetchSources,
  isDemoMode,
  markViewed,
  readToken,
  recordContact,
  setArchived,
  updateTracking,
  writeToken,
} from './api/client.js';
import { clearProfile, loadProfile, saveProfile } from './profile.js';
import { AFFINITY_BOOST, computeAffinity } from './affinity.js';
import { Button } from '@/components/ui/button.js';
import { ListingCard } from './components/ListingCard.js';
import { ListingDetail } from './components/ListingDetail.js';
import { ProfileForm } from './components/ProfileForm.js';
import { SourcesPanel } from './components/SourcesPanel.js';
import { FiltersPanel } from './components/FiltersPanel.js';
import { StatsPanel } from './components/StatsPanel.js';

type View = 'list' | 'detail' | 'filters' | 'stats' | 'profile' | 'sources';

/** Seuil de mise en avant : au-delà, l'annonce mérite un contact immédiat. */
const HOT_PRIORITY = 85;

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
    { key: 'filters', label: 'Filtres' },
    { key: 'stats', label: 'Stats' },
    { key: 'profile', label: 'Profil' },
    { key: 'sources', label: 'Sources' },
  ];
  // La fiche appartient à l'univers « Annonces ».
  const active = view === 'detail' ? 'list' : view;

  return (
    <main className="mx-auto max-w-[720px] px-3 py-4 pb-12 sm:px-4 sm:py-6 sm:pb-16">
      <header className="mb-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Recherche Nice</h1>
          <p className="text-sm font-medium text-muted-foreground">
            ≤ {MVP_CRITERIA.maxPrice} € · ≥ {MVP_CRITERIA.minArea} m²
          </p>
        </div>
        <nav className="mt-3 flex gap-1 border-b border-border" aria-label="Navigation principale">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onNavigate(tab.key)}
              aria-current={active === tab.key ? 'page' : undefined}
              className={`-mb-px min-h-11 cursor-pointer border-b-2 px-4 text-[0.95rem] transition-colors ${
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
  const [includeOutOfCriteria, setIncludeOutOfCriteria] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [profile, setProfile] = useState<TenantProfile | null>(() => loadProfile());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);

  // Instant de rendu, figé par chargement : évite que chaque carte recalcule
  // « il y a X min » à partir d'une horloge légèrement différente.
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Affinité : apprend de vos consultations/suivis/archivages pour remonter les
  // annonces qui vous ressemblent (§33). Hook placé AVANT tout return
  // conditionnel (règle des hooks). Recalculée quand la liste change.
  const affinity = useMemo(() => computeAffinity(listings), [listings]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchListings({
        sort,
        includeOutOfCriteria,
        includeArchived: showArchived,
      });
      setListings(response.listings);
      setNowMs(Date.now());
      setNeedsToken(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setNeedsToken(true);
      } else {
        setError(caught instanceof Error ? caught.message : 'Erreur inconnue');
      }
    } finally {
      setLoading(false);
    }
  }, [sort, includeOutOfCriteria, showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const handleContactRecorded = async (channel: string, message: string): Promise<void> => {
    if (selected === null) return;
    const sourceId = selected.occurrences[0]?.sourceId ?? 'unknown';
    setListings((current) =>
      current.map((listing) =>
        listing.id === selected.id ? { ...listing, tracking: 'contacted' as const } : listing,
      ),
    );
    try {
      await recordContact(selected.id, { channel, message, sourceId });
    } catch {
      setError('Le contact n’a pas pu être enregistré');
    }
  };

  // --- Saisie du jeton d'accès (§26) ----------------------------------------
  if (needsToken) {
    return (
      <main className="mx-auto max-w-[720px] px-3 py-4 pb-12 sm:px-4 sm:py-6 sm:pb-16">
        <h1 className="mb-3 text-2xl font-bold tracking-tight">RentFinder</h1>
        <form
          className="flex max-w-[380px] flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const input = new FormData(event.currentTarget).get('token');
            if (typeof input === 'string' && input.trim() !== '') {
              writeToken(input.trim());
              void load();
            }
          }}
        >
          <label htmlFor="token-input">Jeton d’accès à l’API</label>
          <input id="token-input" name="token" type="password" autoComplete="off" required />
          <p className="border-l-3 border-primary pl-2.5 text-[0.85rem] text-muted-foreground">
            Le jeton est conservé dans ce navigateur uniquement. Il n’est jamais inclus dans le code
            publié.
          </p>
          <Button type="submit">Se connecter</Button>
        </form>
      </main>
    );
  }

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
          onContactRecorded={(channel, message) => void handleContactRecorded(channel, message)}
          onConfigureProfile={() => setView('profile')}
        />
      </Shell>
    );
  }

  // §36 : en tri par priorité, on classe par priorité d'action AJUSTÉE de
  // l'affinité — les annonces proches de vos préférences remontent.
  const ranked =
    sort === 'priority'
      ? [...listings].sort(
          (a, b) =>
            b.actionPriority +
            (affinity.scores.get(b.id) ?? 0) * AFFINITY_BOOST -
            (a.actionPriority + (affinity.scores.get(a.id) ?? 0) * AFFINITY_BOOST),
        )
      : listings;

  // La section « à contacter maintenant » reste fondée sur l'urgence réelle.
  const hot = sort === 'priority' ? ranked.filter((l) => l.actionPriority >= HOT_PRIORITY) : [];
  const rest = sort === 'priority' ? ranked.filter((l) => l.actionPriority < HOT_PRIORITY) : ranked;

  const openListing = (id: string): void => {
    setSelectedId(id);
    setView('detail');
    // §37 : marque « consultée » automatiquement à l'ouverture. Optimiste :
    // on met à jour l'affichage tout de suite, l'API suit.
    setListings((current) =>
      current.map((listing) => (listing.id === id ? { ...listing, viewed: true } : listing)),
    );
    void markViewed(id).catch(() => {
      /* l'échec réseau n'empêche pas de consulter la fiche */
    });
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

      <div className="my-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <label htmlFor="sort-select" className="text-muted-foreground">
            Trier par
          </label>
          <select
            id="sort-select"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortMode)}
          >
            <option value="priority">Priorité d’action</option>
            <option value="recent">Plus récentes</option>
            <option value="price">Loyer croissant</option>
          </select>
        </span>

        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={includeOutOfCriteria}
            onChange={(event) => setIncludeOutOfCriteria(event.target.checked)}
          />
          Afficher les annonces hors critères
        </label>

        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Afficher les archivées
        </label>
      </div>

      {error !== null && (
        <p className="rounded-xl border border-bad px-3 py-2 text-bad" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-muted-foreground">Chargement…</p>
      ) : listings.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          Aucune annonce ne correspond à vos critères pour l’instant.
        </p>
      ) : (
        <>
          <StatsStrip listings={listings} />
          {hot.length > 0 && (
            <section aria-labelledby="hot-title" className="mb-6">
              <h2 id="hot-title" className="mb-2 text-lg font-bold">
                🔥 À contacter maintenant
              </h2>
              <div className="flex flex-col gap-3">
                {hot.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    nowMs={nowMs}
                    onOpen={openListing}
                    onArchive={(archived) => void handleArchive(listing.id, archived)}
                    affinity={affinity.active ? affinity.scores.get(listing.id) : undefined}
                  />
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="all-title">
            {hot.length > 0 && (
              <h2 id="all-title" className="mb-2 text-lg font-bold text-muted-foreground">
                Toutes les annonces <span className="text-sm font-normal">({listings.length})</span>
              </h2>
            )}
            <div className="flex flex-col gap-3">
              {rest.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  nowMs={nowMs}
                  onOpen={openListing}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </Shell>
  );
}

/** Réexporté pour les tests, qui vérifient la présence d'un jeton. */
export { readToken };
