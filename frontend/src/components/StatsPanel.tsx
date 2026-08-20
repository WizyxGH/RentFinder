/**
 * Page statistiques (§33).
 *
 * Volontairement simple : des compteurs qui aident à piloter la recherche —
 * couverture par source, répartition des statuts de suivi, taux de réponse et
 * de visite. Les taux ne s'affichent qu'à partir de contacts réels : on ne
 * prétend à aucune précision statistique tant qu'il n'y a pas de données (§18).
 */

import { useEffect, useState } from 'react';
import type { StatsData } from '../types.js';
import { fetchStats } from '../api/client.js';
import { formatSourceName, formatTracking } from '../format.js';
import type { TrackingStatus } from '../types.js';

/** Tuile compteur. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3 text-center">
      <div className={`text-2xl font-bold ${tone ?? ''}`}>{value}</div>
      <div className="text-[0.75rem] text-muted-foreground">{label}</div>
    </div>
  );
}

/** Barre horizontale d'une répartition. */
function BarRow({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}): React.JSX.Element {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className="w-32 shrink-0 truncate text-muted-foreground">{label}</span>
      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-border">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-8 shrink-0 text-right tabular-nums">{value}</span>
    </div>
  );
}

export function StatsPanel(): React.JSX.Element {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    void fetchStats()
      .then(setStats)
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="text-bad">Impossible de charger les statistiques.</p>;
  if (stats === null) return <p className="text-muted-foreground">Chargement…</p>;

  const { listings, byTracking, bySource, contacts } = stats;
  const sources = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  const maxSource = sources.length > 0 ? (sources[0]?.[1] ?? 0) : 0;
  const trackings = Object.entries(byTracking).sort((a, b) => b[1] - a[1]);
  const maxTracking = trackings.reduce((m, [, n]) => Math.max(m, n), 0);

  // §33 : taux calculés uniquement s'il y a des contacts.
  const responses =
    (contacts.byOutcome['replied'] ?? 0) +
    (contacts.byOutcome['visitOffered'] ?? 0) +
    (contacts.byOutcome['visitScheduled'] ?? 0) +
    (contacts.byOutcome['visited'] ?? 0);
  const visits = contacts.byOutcome['visited'] ?? 0;
  const rate = (n: number): string =>
    contacts.total > 0 ? `${Math.round((n / contacts.total) * 100)} %` : '—';

  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">Statistiques</h2>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Annonces</h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat label="pertinentes" value={listings.matching} />
          <Stat label="louées" value={listings.rented ?? 0} />
          <Stat label="actives" value={listings.active} />
          <Stat label="consultées" value={listings.viewed} />
          <Stat label="archivées" value={listings.archived} />
          <Stat label="collectées" value={listings.total} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Contacts et résultats</h3>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="contactées" value={contacts.total} />
          <Stat label="réponses" value={responses} tone="text-good" />
          <Stat label="visites" value={visits} tone="text-good" />
        </div>
        <p className="mt-2 text-[0.82rem] text-muted-foreground">
          Taux de réponse : <strong>{rate(responses)}</strong> · Taux de visite :{' '}
          <strong>{rate(visits)}</strong>
          {contacts.total === 0 && ' — disponibles dès vos premiers contacts.'}
        </p>
      </div>

      {trackings.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Suivi</h3>
          {trackings.map(([status, n]) => (
            <BarRow
              key={status}
              label={formatTracking(status as TrackingStatus)}
              value={n}
              max={maxTracking}
            />
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            Couverture par source
          </h3>
          {sources.map(([source, n]) => (
            <BarRow key={source} label={formatSourceName(source)} value={n} max={maxSource} />
          ))}
        </div>
      )}
    </section>
  );
}
