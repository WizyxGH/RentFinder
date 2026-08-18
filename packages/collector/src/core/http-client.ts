/**
 * Client HTTP du collecteur — point de passage unique de toute requête sortante
 * (§6, §10, §30).
 *
 * Il concentre les garanties du projet :
 *   - le budget de la source est appliqué avant chaque requête ;
 *   - les en-têtes conditionnels (ETag / If-Modified-Since) évitent de
 *     retélécharger un contenu inchangé ;
 *   - un 429 arrête la source et déclenche son cooldown, sans contournement ;
 *   - un User-Agent honnête et identifiable est envoyé, jamais un faux
 *     navigateur.
 *
 * Aucun scraper n'a le droit d'appeler `fetch` directement : c'est ce qui rend
 * les garanties ci-dessus vérifiables à un seul endroit.
 */

import type { FetchResult, RateLimitBudget } from '@rentfinder/shared';
import type { Clock } from './clock.js';
import type { Logger } from './logger.js';
import { createRateLimiter, type RateLimiter } from './rate-limiter.js';

/** Entrée de cache conditionnel, persistée entre deux exécutions (§30). */
export interface CacheEntry {
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly fetchedAt: string;
}

/** Stockage des métadonnées de cache. Implémenté en mémoire ou sur Turso. */
export interface HttpCacheStore {
  get(url: string): Promise<CacheEntry | null>;
  set(url: string, entry: CacheEntry): Promise<void>;
}

/** Implémentation en mémoire — utilisée dans les tests et en secours. */
export function createMemoryCacheStore(): HttpCacheStore {
  const entries = new Map<string, CacheEntry>();
  return {
    async get(url) {
      return entries.get(url) ?? null;
    },
    async set(url, entry) {
      entries.set(url, entry);
    },
  };
}

/** Levée quand la source répond 429 : la collecte de cette source s'arrête (§10). */
export class RateLimitedError extends Error {
  constructor(public readonly url: string) {
    super(`HTTP 429 reçu sur ${url} — arrêt de la source et cooldown`);
    this.name = 'RateLimitedError';
  }
}

/**
 * Levée quand la source refuse explicitement l'accès automatisé (401/403).
 * On ne tente rien pour contourner : la source passe en `blocked` (§10).
 */
export class BlockedError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`HTTP ${status} sur ${url} — accès refusé, la source est marquée bloquée`);
    this.name = 'BlockedError';
  }
}

export interface HttpClientOptions {
  readonly budget: RateLimitBudget;
  readonly userAgent: string;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly cache: HttpCacheStore;
  /** Injection de `fetch` pour les tests : aucun accès réseau en CI (§59). */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface RequestInitLite {
  readonly headers?: Record<string, string>;
  readonly method?: 'GET' | 'POST';
  readonly body?: string;
}

export interface HttpClient {
  get(url: string, init?: RequestInitLite): Promise<FetchResult>;
  readonly limiter: RateLimiter;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** Statuts pour lesquels une nouvelle tentative a un sens. */
const RETRYABLE_STATUSES = new Set([408, 500, 502, 503, 504]);

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { budget, userAgent, clock, logger, cache } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = createRateLimiter(budget, clock);

  async function attempt(
    url: string,
    headers: Record<string, string>,
    method: 'GET' | 'POST',
    body: string | undefined,
  ): Promise<FetchResult> {
    await limiter.acquire();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
        redirect: 'follow',
      });
      const responseHeaders = headersToObject(response.headers);

      if (response.status === 429) {
        limiter.register429();
        logger.warn('http.rate_limited', { url, cooldownSeconds: budget.cooldownSecondsAfter429 });
        throw new RateLimitedError(url);
      }

      if (response.status === 401 || response.status === 403) {
        logger.warn('http.blocked', { url, status: response.status });
        throw new BlockedError(url, response.status);
      }

      // 304 : rien n'a changé, on n'a même pas téléchargé le corps (§30).
      if (response.status === 304) {
        logger.debug('http.not_modified', { url });
        return { status: 304, body: '', headers: responseHeaders, notModified: true };
      }

      if (RETRYABLE_STATUSES.has(response.status)) {
        throw new Error(`HTTP ${response.status} temporaire sur ${url}`);
      }

      const responseBody = await response.text();

      // Mémorisation des validateurs pour la prochaine exécution (GET seulement :
      // une réponse POST n'est pas revalidable par ETag, §30).
      const etag = responseHeaders['etag'] ?? null;
      const lastModified = responseHeaders['last-modified'] ?? null;
      if (method === 'GET' && (etag !== null || lastModified !== null)) {
        await cache.set(url, {
          etag,
          lastModified,
          fetchedAt: new Date(clock.now()).toISOString(),
        });
      }

      return {
        status: response.status,
        body: responseBody,
        headers: responseHeaders,
        notModified: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    limiter,

    async get(url, init) {
      const method = init?.method ?? 'GET';
      const headers: Record<string, string> = {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9',
        ...init?.headers,
      };

      // Le cache conditionnel (ETag/If-Modified-Since) ne vaut que pour GET :
      // une réponse POST n'est pas revalidable ainsi (§30).
      if (method === 'GET') {
        const cached = await cache.get(url);
        if (cached?.etag) headers['if-none-match'] = cached.etag;
        if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;
      }

      let lastError: unknown;
      for (let tryIndex = 0; tryIndex <= budget.retryLimit; tryIndex += 1) {
        try {
          return await attempt(url, headers, method, init?.body);
        } catch (error) {
          // 429 et blocage ne sont jamais réessayés : ce sont des refus, pas
          // des incidents passagers (§10).
          if (error instanceof RateLimitedError || error instanceof BlockedError) throw error;

          lastError = error;
          if (tryIndex < budget.retryLimit) {
            const delay = limiter.backoffDelayMs(tryIndex);
            logger.debug('http.retry', { url, attempt: tryIndex + 1, delayMs: delay });
            await clock.sleep(delay);
          }
        }
      }

      throw lastError instanceof Error ? lastError : new Error(`Échec de la requête ${url}`);
    },
  };
}
