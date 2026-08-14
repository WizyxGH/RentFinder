/**
 * Application (§36, §39).
 *
 * Pas de routeur, pas de gestionnaire d'état : trois vues et un `useState`
 * suffisent. §39 et §65 demandent explicitement de limiter les dépendances —
 * ajouter react-router ici coûterait 15 ko pour naviguer entre trois écrans.
 */

import { useCallback, useEffect, useState } from 'react';
import type { TenantProfile } from '@rentfinder/shared';
import type { ListingView, SortMode, SourceStateView, TrackingStatus } from './types.js';
import {
  ApiError,
  fetchListings,
  fetchSources,
  isDemoMode,
  readToken,
  recordContact,
  updateTracking,
  writeToken,
} from './api/client.js';
import { clearProfile, loadProfile, saveProfile } from './profile.js';
import { ListingCard } from './components/ListingCard.js';
import { ListingDetail } from './components/ListingDetail.js';
import { ProfileForm } from './components/ProfileForm.js';
import { SourcesPanel } from './components/SourcesPanel.js';
import { MVP_CRITERIA } from '@rentfinder/shared';

type View = 'list' | 'detail' | 'profile' | 'sources';

export function App(): React.JSX.Element {
  const [listings, setListings] = useState<readonly ListingView[]>([]);
  const [sources, setSources] = useState<readonly SourceStateView[]>([]);
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('priority');
  const [includeOutOfCriteria, setIncludeOutOfCriteria] = useState(false);
  const [profile, setProfile] = useState<TenantProfile | null>(() => loadProfile());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);

  // Instant de rendu, figé par chargement : évite que chaque carte recalcule
  // « il y a X min » à partir d'une horloge légèrement différente.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchListings({ sort, includeOutOfCriteria });
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
  }, [sort, includeOutOfCriteria]);

  useEffect(() => {
    void load();
  }, [load]);

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
    // Mise à jour optimiste : l'interface reste réactive sur mobile.
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
      <main className="app app--gate">
        <h1>RentFinder</h1>
        <form
          className="token-gate"
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
          <p className="token-gate__notice">
            Le jeton est conservé dans ce navigateur uniquement. Il n’est jamais inclus dans le code
            publié.
          </p>
          <button type="submit" className="btn btn--primary">
            Se connecter
          </button>
        </form>
      </main>
    );
  }

  if (view === 'profile') {
    return (
      <main className="app">
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
      </main>
    );
  }

  if (view === 'sources') {
    return (
      <main className="app">
        <SourcesPanel sources={sources} nowMs={nowMs} onBack={() => setView('list')} />
      </main>
    );
  }

  if (view === 'detail' && selected !== null) {
    return (
      <main className="app">
        <ListingDetail
          listing={selected}
          profile={profile}
          nowMs={nowMs}
          onBack={() => setView('list')}
          onTrackingChange={(status) => void handleTrackingChange(status)}
          onContactRecorded={(channel, message) => void handleContactRecorded(channel, message)}
          onConfigureProfile={() => setView('profile')}
        />
      </main>
    );
  }

  return (
    <main className="app">
      <header className="app__header">
        <div>
          <h1>Recherche Nice</h1>
          {/* §36 : rappeler les critères actifs, pour lever toute ambiguïté. */}
          <p className="app__criteria">
            ≤ {MVP_CRITERIA.maxPrice} € · ≥ {MVP_CRITERIA.minArea} m²
          </p>
        </div>
        <nav className="app__nav">
          <button type="button" className="btn btn--ghost" onClick={() => setView('profile')}>
            Profil
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void openSources()}>
            Sources
          </button>
        </nav>
      </header>

      {isDemoMode() && (
        <p className="app__demo" role="status">
          Mode démonstration — données fictives. Définissez <code>VITE_API_URL</code> pour vous
          connecter à vos données.
        </p>
      )}

      <div className="app__controls">
        <label htmlFor="sort-select">Trier par</label>
        <select
          id="sort-select"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortMode)}
        >
          <option value="priority">Priorité d’action</option>
          <option value="recent">Plus récentes</option>
          <option value="price">Loyer croissant</option>
        </select>

        <label className="app__toggle">
          <input
            type="checkbox"
            checked={includeOutOfCriteria}
            onChange={(event) => setIncludeOutOfCriteria(event.target.checked)}
          />
          Afficher les annonces hors critères
        </label>
      </div>

      {error !== null && (
        <p className="app__error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="app__loading">Chargement…</p>
      ) : listings.length === 0 ? (
        <p className="app__empty">Aucune annonce ne correspond à vos critères pour l’instant.</p>
      ) : (
        <section className="app__list">
          {listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              nowMs={nowMs}
              onOpen={(id) => {
                setSelectedId(id);
                setView('detail');
              }}
            />
          ))}
        </section>
      )}
    </main>
  );
}

/** Réexporté pour les tests, qui vérifient la présence d'un jeton. */
export { readToken };
