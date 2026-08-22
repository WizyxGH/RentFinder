/**
 * Temps de trajet réel en TRANSPORTS EN COMMUN (§20).
 *
 * Le MVP estimait la durée à partir de la distance à vol d'oiseau (voir
 * `geo.ts`). Ce module calcule le VRAI temps de trajet porte-à-porte via
 * l'API Navitia (navitia.io) — couverture France, dont le réseau niçois
 * (Lignes d'Azur) — pour un objectif d'ARRIVÉE à une heure donnée (ex. 9 h au
 * travail).
 *
 * PRUDENCE (§6, §10, §26, §30, §69) :
 *   - accès conditionné à un jeton personnel `NAVITIA_TOKEN` (dans `.env`,
 *     jamais committé) ; sans jeton, on reste sur l'estimation vol d'oiseau ;
 *   - chaque couple origine→destination est mis en cache (y compris les
 *     « aucun itinéraire »), pour ne pas réinterroger à chaque collecte ;
 *   - ne lève jamais : toute erreur réseau/API retombe sur `null` (estimation).
 */

import type { Coordinates } from './geo.js';

const NAVITIA_API = 'https://api.navitia.io/v1';

/** Résultat mis en cache : `minutes` à `null` = aucun itinéraire trouvé. */
export interface TransitCacheEntry {
  readonly minutes: number | null;
}

/** Cache des durées de trajet (persisté en base, §30). */
export interface TransitCacheStore {
  /** `null` = absent du cache ; sinon l'entrée (dont `minutes` peut être `null`). */
  get(key: string): Promise<TransitCacheEntry | null>;
  set(key: string, entry: TransitCacheEntry): Promise<void>;
}

export interface TransitRouterOptions {
  /** Jeton Navitia personnel (§26). */
  readonly token: string;
  /** Heure d'arrivée visée, `HH:MM` (ex. `09:00`). */
  readonly arrivalTime: string;
  readonly cache: TransitCacheStore;
  /** Instant courant, pour calculer le prochain jour ouvré. */
  readonly nowMs: number;
  readonly fetchImpl?: typeof fetch;
}

export interface TransitRouter {
  /**
   * Durée du trajet en transports en commun pour ARRIVER à `arrivalTime` le
   * prochain jour ouvré. `null` si aucun itinéraire ou si l'API a échoué —
   * l'appelant retombe alors sur l'estimation vol d'oiseau.
   */
  arrivalMinutes(from: Coordinates, to: Coordinates): Promise<number | null>;
}

/** Clé de cache stable : origine, destination (5 décimales) et heure d'arrivée. */
function cacheKey(from: Coordinates, to: Coordinates, arrivalTime: string): string {
  const round = (n: number): string => n.toFixed(5);
  return `${round(from.latitude)},${round(from.longitude)}>${round(to.latitude)},${round(to.longitude)}@${arrivalTime}`;
}

/**
 * Prochain jour OUVRÉ à `HH:MM`, au format Navitia `AAAAMMJJTHHMMSS`. On vise
 * toujours un jour futur (jamais dans le passé) et on saute samedi/dimanche —
 * le trajet domicile↔travail se fait en semaine.
 */
export function nextWeekdayArrival(nowMs: number, arrivalTime: string): string {
  const [hh, mm] = arrivalTime.split(':');
  const hours = Number(hh);
  const minutes = Number(mm ?? '0');
  const target = new Date(nowMs);
  target.setHours(hours, minutes, 0, 0);
  // Si l'heure d'arrivée est déjà passée aujourd'hui, viser demain.
  if (target.getTime() <= nowMs) target.setDate(target.getDate() + 1);
  // Sauter le week-end (0 = dimanche, 6 = samedi).
  while (target.getDay() === 0 || target.getDay() === 6) {
    target.setDate(target.getDate() + 1);
  }
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${target.getFullYear()}${p(target.getMonth() + 1)}${p(target.getDate())}` +
    `T${p(target.getHours())}${p(target.getMinutes())}00`
  );
}

/** Extrait la durée (minutes) du meilleur trajet d'une réponse Navitia. */
export function parseNavitiaMinutes(body: string): number | null {
  try {
    const data = JSON.parse(body) as { journeys?: { duration?: unknown }[] };
    const durations = (data.journeys ?? [])
      .map((j) => j.duration)
      .filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0);
    if (durations.length === 0) return null;
    return Math.round(Math.min(...durations) / 60);
  } catch {
    return null;
  }
}

export function createTransitRouter(options: TransitRouterOptions): TransitRouter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const datetime = nextWeekdayArrival(options.nowMs, options.arrivalTime);

  return {
    async arrivalMinutes(from, to) {
      const key = cacheKey(from, to, options.arrivalTime);
      const cached = await options.cache.get(key);
      if (cached !== null) return cached.minutes;

      // Navitia attend les coordonnées en `lon;lat`.
      const params = new URLSearchParams({
        from: `${from.longitude};${from.latitude}`,
        to: `${to.longitude};${to.latitude}`,
        datetime,
        datetime_represents: 'arrival',
        max_nb_journeys: '1',
      });
      let minutes: number | null = null;
      try {
        const response = await fetchImpl(`${NAVITIA_API}/journeys?${params.toString()}`, {
          headers: { Authorization: options.token },
        });
        if (response.ok) minutes = parseNavitiaMinutes(await response.text());
      } catch {
        // Réseau indisponible : on ne met PAS en cache (nouvelle tentative au
        // prochain run) et on retombe sur l'estimation.
        return null;
      }
      await options.cache.set(key, { minutes });
      return minutes;
    },
  };
}
