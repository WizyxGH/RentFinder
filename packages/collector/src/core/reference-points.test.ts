/**
 * Ce qui compte ici est l'ARBITRAGE entre le réglage du site et `.env`.
 *
 * Se tromper de priorité produit exactement la panne qu'on veut éviter : une
 * adresse saisie sur le téléphone qui paraît sans effet, écrasée en silence par
 * un fichier posé sur la machine de collecte.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { referencePointsDeclared, resolveReferencePoints } from './reference-points.js';
import type { GeocodeCacheStore, GeocodeEntry } from './geocode.js';
import type { Logger } from './logger.js';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

/**
 * Un cache qui répond à tout : le géocodeur ne touche donc jamais au réseau.
 * L'adresse est renvoyée telle quelle par les coordonnées, ce qui permet de
 * vérifier LAQUELLE a été géocodée.
 */
function answeringCache(): GeocodeCacheStore {
  const entries = new Map<string, GeocodeEntry>();
  return {
    get: (query) =>
      Promise.resolve(
        entries.get(query) ?? {
          lat: 43.7 + query.length / 1000,
          lon: 7.26,
          geocodedAt: '2026-09-04T00:00:00.000Z',
        },
      ),
    set: (query, entry) => {
      entries.set(query, entry);
      return Promise.resolve();
    },
  };
}

const resolve = (stored?: string | null): ReturnType<typeof resolveReferencePoints> =>
  resolveReferencePoints({
    cache: answeringCache(),
    nowMs: Date.parse('2026-09-04T10:00:00.000Z'),
    logger: silentLogger,
    ...(stored === undefined ? {} : { stored }),
  });

const ENV_KEYS = [
  'REFERENCE_WORK_LAT',
  'REFERENCE_WORK_LON',
  'REFERENCE_WORK_ADDRESS',
  'REFERENCE_WORK_LABEL',
  'REFERENCE_STATION_LAT',
  'REFERENCE_STATION_LON',
  'REFERENCE_STATION_ADDRESS',
];
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('resolveReferencePoints', () => {
  it("prend ceux de l'environnement quand le site n'a rien réglé", async () => {
    process.env['REFERENCE_WORK_LAT'] = '43.70';
    process.env['REFERENCE_WORK_LON'] = '7.26';

    const points = await resolve(null);

    expect(points).toEqual([
      { label: 'Travail', latitude: 43.7, longitude: 7.26, mode: 'transit' },
    ]);
  });

  it('laisse le réglage du site primer sur les coordonnées de .env', async () => {
    process.env['REFERENCE_WORK_LAT'] = '43.70';
    process.env['REFERENCE_WORK_LON'] = '7.26';
    const stored = JSON.stringify([
      { label: 'Bureau', address: 'avenue Jean Médecin, Nice', mode: 'walking' },
    ]);

    const points = await resolve(stored);

    expect(points).toHaveLength(1);
    expect(points[0]?.label).toBe('Bureau');
    expect(points[0]?.mode).toBe('walking');
  });

  it('respecte une liste vidée depuis le site, sans rallumer .env', async () => {
    process.env['REFERENCE_WORK_LAT'] = '43.70';
    process.env['REFERENCE_WORK_LON'] = '7.26';

    expect(await resolve('[]')).toEqual([]);
  });

  it('retombe sur .env quand la valeur stockée est illisible', async () => {
    process.env['REFERENCE_WORK_LAT'] = '43.70';
    process.env['REFERENCE_WORK_LON'] = '7.26';

    expect(await resolve('{ pas du json')).toHaveLength(1);
  });
});

describe('referencePointsDeclared', () => {
  it('distingue « rien de déclaré » de « déclaré mais non résolu »', () => {
    expect(referencePointsDeclared(null)).toBe(false);

    process.env['REFERENCE_WORK_ADDRESS'] = 'Nice';
    expect(referencePointsDeclared(null)).toBe(true);

    // Vidé depuis le site : plus rien n'est déclaré, malgré `.env`. Sans quoi
    // un rescoring s'interromprait en croyant à un géocodage raté.
    expect(referencePointsDeclared('[]')).toBe(false);
  });
});
