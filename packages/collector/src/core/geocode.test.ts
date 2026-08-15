/**
 * Géocodage via la Base Adresse Nationale (§20, §6, §30).
 *
 * On vérifie surtout l'économie de requêtes : une adresse déjà connue (succès
 * OU échec) ne redéclenche jamais d'appel réseau.
 */

import { describe, expect, it, vi } from 'vitest';
import { createGeocoder, createMemoryGeocodeCache } from './geocode.js';

const NOW = Date.parse('2026-08-15T12:00:00.000Z');

/** Réponse BAN simulée : coordonnées en [lon, lat] (ordre GeoJSON). */
function banResponse(lon: number, lat: number, score = 0.9): Response {
  return new Response(
    JSON.stringify({
      features: [{ geometry: { coordinates: [lon, lat] }, properties: { score } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('createGeocoder', () => {
  it('géocode une adresse et convertit [lon, lat] → {latitude, longitude}', async () => {
    const fetchImpl = vi.fn(async () => banResponse(7.2662, 43.7024));
    const geocoder = createGeocoder({
      cache: createMemoryGeocodeCache(),
      nowMs: NOW,
      userAgent: 'test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const coords = await geocoder.geocode('42 Bd Fictif 06000 Nice');
    expect(coords).toEqual({ latitude: 43.7024, longitude: 7.2662 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('ne rappelle pas le réseau pour une adresse déjà en cache (§30)', async () => {
    const fetchImpl = vi.fn(async () => banResponse(7.2662, 43.7024));
    const cache = createMemoryGeocodeCache();
    const geocoder = createGeocoder({
      cache,
      nowMs: NOW,
      userAgent: 'test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await geocoder.geocode('42 Bd Fictif 06000 Nice');
    await geocoder.geocode('42 Bd Fictif 06000 Nice');
    await geocoder.geocode('42  BD  FICTIF  06000  nice'); // même clé normalisée
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('mémorise un échec pour ne pas réessayer en boucle', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ features: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const geocoder = createGeocoder({
      cache: createMemoryGeocodeCache(),
      nowMs: NOW,
      userAgent: 'test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await geocoder.geocode('adresse introuvable')).toBeNull();
    expect(await geocoder.geocode('adresse introuvable')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejette un résultat BAN peu fiable (score bas)', async () => {
    const geocoder = createGeocoder({
      cache: createMemoryGeocodeCache(),
      nowMs: NOW,
      userAgent: 'test',
      fetchImpl: (async () => banResponse(7.2, 43.7, 0.2)) as unknown as typeof fetch,
    });
    expect(await geocoder.geocode('quelque part vague')).toBeNull();
  });
});
