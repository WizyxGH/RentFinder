/**
 * Tests du limiteur de débit et du client HTTP (§10, §30, §53 scénario 6).
 *
 * Aucun accès réseau : `fetch` est injecté et l'horloge est contrôlée (§59).
 */

import { describe, expect, it, vi } from 'vitest';
import { createTestClock } from './clock.js';
import { createRateLimiter } from './rate-limiter.js';
import {
  BlockedError,
  RateLimitedError,
  createHttpClient,
  createMemoryCacheStore,
} from './http-client.js';
import { silentLogger } from './logger.js';
import { DEFAULT_BUDGET } from './budgets.js';

const budget = {
  ...DEFAULT_BUDGET,
  delayBetweenRequestsMs: 1_000,
  requestsPerMinute: 3,
  retryLimit: 2,
};

/** Construit une réponse minimale exploitable par le client. */
function response(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(status === 304 ? null : body, { status, headers });
}

describe('createRateLimiter', () => {
  it('n’attend pas avant la première requête', async () => {
    const clock = createTestClock();
    const limiter = createRateLimiter(budget, clock);
    await limiter.acquire();
    expect(clock.sleptMs).toEqual([]);
  });

  it('respecte le délai minimal entre deux requêtes', async () => {
    const clock = createTestClock({ random: 0 });
    const limiter = createRateLimiter(budget, clock);

    await limiter.acquire();
    await limiter.acquire();

    expect(clock.sleptMs).toEqual([1_000]);
  });

  it('ajoute un jitter proportionnel au délai', async () => {
    const clock = createTestClock({ random: 1 });
    const limiter = createRateLimiter(budget, clock);

    await limiter.acquire();
    await limiter.acquire();

    // 1000 ms de base + 25 % de jitter.
    expect(clock.sleptMs[0]).toBe(1_250);
  });

  it('respecte le plafond de requêtes par minute', async () => {
    const clock = createTestClock({ random: 0 });
    const limiter = createRateLimiter({ ...budget, delayBetweenRequestsMs: 0 }, clock);

    // Trois requêtes autorisées, la quatrième attend la fenêtre glissante.
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(clock.sleptMs.at(-1)).toBe(60_000);
  });

  it('applique un cooldown après un 429', async () => {
    const clock = createTestClock({ random: 0 });
    const limiter = createRateLimiter({ ...budget, cooldownSecondsAfter429: 60 }, clock);

    await limiter.acquire();
    limiter.register429();

    expect(limiter.cooldownUntil()).toBe(60_000);
    await limiter.acquire();
    expect(clock.sleptMs).toContain(60_000);
  });

  it('calcule un backoff exponentiel plafonné', () => {
    const clock = createTestClock({ random: 0 });
    const limiter = createRateLimiter({ ...budget, backoffFactor: 3 }, clock);

    expect(limiter.backoffDelayMs(0)).toBe(1_000);
    expect(limiter.backoffDelayMs(1)).toBe(3_000);
    expect(limiter.backoffDelayMs(2)).toBe(9_000);
    // Plafond de sécurité à deux minutes.
    expect(limiter.backoffDelayMs(20)).toBe(120_000);
  });
});

describe('createHttpClient', () => {
  const baseOptions = () => ({
    budget,
    userAgent: 'RentFinderBot/0.1 (test)',
    clock: createTestClock({ random: 0 }),
    logger: silentLogger,
    cache: createMemoryCacheStore(),
  });

  it('envoie un User-Agent identifiable, jamais un faux navigateur (§10)', async () => {
    // La signature est explicite pour que `mock.calls[0][1]` reste typé.
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => response(200, 'ok'));
    const client = createHttpClient({ ...baseOptions(), fetchImpl: fetchImpl as never });

    await client.get('https://example.invalid/a');

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['user-agent']).toBe('RentFinderBot/0.1 (test)');
    expect(headers['user-agent']).not.toMatch(/Mozilla|Chrome|Safari/);
  });

  it('lève RateLimitedError sur un 429 sans jamais réessayer (§10)', async () => {
    const fetchImpl = vi.fn(async () => response(429));
    const client = createHttpClient({ ...baseOptions(), fetchImpl: fetchImpl as never });

    await expect(client.get('https://example.invalid/a')).rejects.toBeInstanceOf(RateLimitedError);
    // Une seule tentative : réessayer serait précisément le contournement
    // que le projet s'interdit.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(client.limiter.cooldownUntil()).not.toBeNull();
  });

  it('lève BlockedError sur un 403 sans réessayer', async () => {
    const fetchImpl = vi.fn(async () => response(403));
    const client = createHttpClient({ ...baseOptions(), fetchImpl: fetchImpl as never });

    await expect(client.get('https://example.invalid/a')).rejects.toBeInstanceOf(BlockedError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('réessaie sur une erreur serveur temporaire, puis abandonne', async () => {
    const fetchImpl = vi.fn(async () => response(503));
    const client = createHttpClient({ ...baseOptions(), fetchImpl: fetchImpl as never });

    await expect(client.get('https://example.invalid/a')).rejects.toThrow();
    // 1 tentative initiale + 2 reprises autorisées par le budget.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('mémorise l’ETag et l’envoie à la requête suivante (§30)', async () => {
    const cache = createMemoryCacheStore();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(200, 'contenu', { etag: 'W/"abc123"' }))
      .mockResolvedValueOnce(response(304));

    const client = createHttpClient({ ...baseOptions(), cache, fetchImpl: fetchImpl as never });

    const first = await client.get('https://example.invalid/page');
    expect(first.notModified).toBe(false);
    expect(first.body).toBe('contenu');

    const second = await client.get('https://example.invalid/page');
    expect(second.notModified).toBe(true);
    expect(second.body).toBe('');

    const headers = fetchImpl.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers['if-none-match']).toBe('W/"abc123"');
  });

  it('mémorise Last-Modified et l’envoie en If-Modified-Since', async () => {
    const cache = createMemoryCacheStore();
    const lastModified = 'Thu, 14 Aug 2026 07:00:00 GMT';
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(200, 'contenu', { 'last-modified': lastModified }))
      .mockResolvedValueOnce(response(304));

    const client = createHttpClient({ ...baseOptions(), cache, fetchImpl: fetchImpl as never });
    await client.get('https://example.invalid/page');
    await client.get('https://example.invalid/page');

    const headers = fetchImpl.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers['if-modified-since']).toBe(lastModified);
  });
});
