import { describe, expect, it, vi } from 'vitest';
import {
  createTransitRouter,
  nextWeekdayArrival,
  parseNavitiaMinutes,
  type TransitCacheStore,
} from './transit.js';

/** Cache mémoire pour les tests (§59). */
function memoryCache(): TransitCacheStore & { size: () => number } {
  const map = new Map<string, { minutes: number | null }>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, entry) {
      map.set(key, entry);
    },
    size: () => map.size,
  };
}

const NICE = { latitude: 43.7009, longitude: 7.2683 };
const WORK = { latitude: 43.7031, longitude: 7.2661 };

describe('parseNavitiaMinutes', () => {
  it('rend la durée du meilleur trajet, en minutes', () => {
    const body = JSON.stringify({ journeys: [{ duration: 1500 }, { duration: 1200 }] });
    expect(parseNavitiaMinutes(body)).toBe(20); // 1200 s = 20 min
  });

  it('rend null sans trajet, ou sur JSON invalide', () => {
    expect(parseNavitiaMinutes(JSON.stringify({ journeys: [] }))).toBeNull();
    expect(parseNavitiaMinutes(JSON.stringify({ error: { id: 'no-solution' } }))).toBeNull();
    expect(parseNavitiaMinutes('pas du json')).toBeNull();
  });
});

describe('nextWeekdayArrival', () => {
  it('vise un jour ouvré futur à l’heure demandée (format Navitia)', () => {
    // Vendredi 2026-08-21 12:00 → l'arrivée 09:00 passée aujourd'hui, et le
    // week-end est sauté → lundi 2026-08-24.
    const friday = Date.parse('2026-08-21T12:00:00');
    const result = nextWeekdayArrival(friday, '09:00');
    expect(result).toMatch(/^\d{8}T090000$/);
    const day = new Date(
      Number(result.slice(0, 4)),
      Number(result.slice(4, 6)) - 1,
      Number(result.slice(6, 8)),
    ).getDay();
    expect(day).toBeGreaterThanOrEqual(1); // lundi..vendredi
    expect(day).toBeLessThanOrEqual(5);
  });
});

describe('createTransitRouter.arrivalMinutes', () => {
  const base = { token: 'tok', arrivalTime: '09:00', nowMs: Date.parse('2026-08-24T08:00:00') };

  it('interroge Navitia, rend les minutes et met en cache', async () => {
    const cache = memoryCache();
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ journeys: [{ duration: 1800 }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const router = createTransitRouter({ ...base, cache, fetchImpl });

    expect(await router.arrivalMinutes(NICE, WORK)).toBe(30);
    // Coordonnées en lon;lat et arrivée demandée.
    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(url).toContain('datetime_represents=arrival');
    // Coordonnées Navitia en lon;lat : longitude de l'origine avant sa latitude.
    expect(url).toContain(encodeURIComponent('7.2683;43.7009'));
    expect(cache.size()).toBe(1);

    // Deuxième appel : servi par le cache, aucun nouvel appel réseau.
    expect(await router.arrivalMinutes(NICE, WORK)).toBe(30);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('met en cache aussi les « aucun trajet » (null) pour ne pas réinterroger', async () => {
    const cache = memoryCache();
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ journeys: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const router = createTransitRouter({ ...base, cache, fetchImpl });
    expect(await router.arrivalMinutes(NICE, WORK)).toBeNull();
    expect(await router.arrivalMinutes(NICE, WORK)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sur erreur réseau, rend null et NE met PAS en cache (retry au prochain run)', async () => {
    const cache = memoryCache();
    const fetchImpl = vi.fn(async () => {
      throw new Error('réseau coupé');
    }) as unknown as typeof fetch;
    const router = createTransitRouter({ ...base, cache, fetchImpl });
    expect(await router.arrivalMinutes(NICE, WORK)).toBeNull();
    expect(cache.size()).toBe(0);
  });
});
