/**
 * Fabrique de scrapers pour les agences sur plateforme Netty (§5, §47).
 *
 * Ajouter une agence = une entrée `makeNettyScraper({...})` : sitemap →
 * filtrage des communes cibles → visite des seules fiches nouvelles →
 * confirmation des connues sans requête (§30, §32).
 *
 * DEUX DIFFÉRENCES AVEC L'ADAPTATEUR APIMO, toutes deux dictées par la
 * plateforme :
 *   - le sitemap ne porte aucun `lastmod`, donc ni tri par fraîcheur ni rejet
 *     des fiches anciennes ; il est en revanche petit et purgé ;
 *   - `robots.txt` demande `Crawl-delay: 5`, au-dessus des 4 s du gabarit
 *     `localAgency` : le budget est ralenti d'autant. Une demande de délai se
 *     respecte telle qu'elle est écrite, on ne l'arrondit pas à la baisse.
 */

import type {
  RawListing,
  Scraper,
  ScrapeContext,
  ScrapeResult,
  SourceDescriptor,
  StopReason,
} from '@rentfinder/shared';
import { budgetFor, scheduleFor } from '../../core/budgets.js';
import {
  matchesCity,
  parseDetailPage,
  parseSitemap,
  parseSitemapIndex,
  type SitemapEntry,
} from './parser.js';

export interface NettyConfig {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  /** URL du sitemap (index ou urlset direct). */
  readonly sitemapUrl: string;
  /** Communes cibles, en slug d'URL (minuscules, tirets). */
  readonly citySlugs: readonly string[];
  readonly priority?: number;
  readonly maxDetailsLive?: number;
  readonly maxDetailsBackfill?: number;
}

/** `Crawl-delay: 5`, tel que l'écrivent les `robots.txt` engendrés par Netty. */
const CRAWL_DELAY_MS = 5_000;

export function makeNettyDescriptor(config: NettyConfig): SourceDescriptor {
  const maxBackfill = config.maxDetailsBackfill ?? 20;
  return {
    id: config.id,
    name: config.name,
    domain: config.domain,
    kind: 'localAgency',
    method: 'sitemap',
    priority: config.priority ?? 2,
    schedule: scheduleFor('localAgency'),
    budget: budgetFor('localAgency', {
      delayBetweenRequestsMs: CRAWL_DELAY_MS,
      maxPagesPerRun: 2 + maxBackfill,
      maxListingsPerRun: maxBackfill,
    }),
    enabled: true,
    // Petite structure : premier contact téléphonique/formulaire (§23).
    manualOnly: true,
    allowedPaths: ['/sitemap*.xml', '/location/*'],
    notes:
      `Plateforme Netty (adaptateur générique, §47). robots.txt n'interdit que ` +
      `/*.pdf et demande Crawl-delay: 5, respecté. Sitemap déclaré, sans lastmod ` +
      `mais purgé et de petite taille ; seules les fiches nouvelles des communes ` +
      `cibles sont visitées. Fiches riches : JSON-LD (prix, surface, pièces, ` +
      `commune, photos) et mentions légales portant charges, dépôt et DPE.`,
  };
}

export function makeNettyScraper(config: NettyConfig): Scraper {
  const descriptor = makeNettyDescriptor(config);
  const maxLive = config.maxDetailsLive ?? 8;
  const maxBackfill = config.maxDetailsBackfill ?? 20;

  return {
    descriptor,

    async run(context: ScrapeContext): Promise<ScrapeResult> {
      const listings: RawListing[] = [];
      const warnings: string[] = [];
      let requestCount = 0;
      let pagesFetched = 0;
      let stopReason: StopReason = 'completed';

      // --- 1. Sitemap : découvrir toutes les fiches de location ------------
      let entries: SitemapEntry[] = [];
      try {
        const index = await context.fetch(config.sitemapUrl);
        requestCount += 1;
        pagesFetched += 1;

        if (index.notModified) {
          context.log('sitemap.not_modified', { url: config.sitemapUrl });
          return {
            sourceId: config.id,
            listings: [],
            requestCount,
            pagesFetched,
            stopReason: 'notModified',
            warnings,
          };
        }

        const children = parseSitemapIndex(index.body).slice(0, 3);
        // Les deux sites observés servent l'urlset directement ; un index reste
        // possible, la plateforme le permet.
        const bodies = children.length > 0 ? [] : [index.body];
        for (const childUrl of children) {
          const child = await context.fetch(childUrl);
          requestCount += 1;
          pagesFetched += 1;
          if (!child.notModified) bodies.push(child.body);
        }
        entries = bodies.flatMap((body) => parseSitemap(body));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec du sitemap : ${message}`);
        context.log('sitemap.failed', { error: message });
        return {
          sourceId: config.id,
          listings: [],
          requestCount,
          pagesFetched,
          stopReason: message.includes('429') ? 'rateLimited' : 'tooManyErrors',
          warnings,
        };
      }

      // --- 2. Filtrer -----------------------------------------------------
      const targeted = entries.filter((entry) => matchesCity(entry.url, config.citySlugs));
      const confirmedRefs = targeted
        .filter((entry) => context.isKnown(entry.url.reference))
        .map((entry) => entry.url.reference);
      const candidates = targeted.filter((entry) => !context.isKnown(entry.url.reference));

      const maxDetails = context.mode === 'backfill' ? maxBackfill : maxLive;

      context.log('sitemap.parsed', {
        total: entries.length,
        targeted: targeted.length,
        known: confirmedRefs.length,
        new: candidates.length,
        toFetch: Math.min(candidates.length, maxDetails),
      });

      // --- 3. Visiter uniquement les fiches nouvelles ---------------------
      for (const entry of candidates.slice(0, maxDetails)) {
        if (context.shouldStop()) {
          stopReason = 'maxPages';
          break;
        }
        try {
          const response = await context.fetch(entry.url.canonicalUrl);
          requestCount += 1;
          if (response.notModified) continue;
          pagesFetched += 1;

          const parsed = parseDetailPage(response.body, entry.url.canonicalUrl, config.name);
          warnings.push(...parsed.warnings);
          if (parsed.listing !== null) listings.push(parsed.listing);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Échec sur ${entry.url.canonicalUrl} : ${message}`);
          context.log('page.failed', { url: entry.url.canonicalUrl, error: message });
          if (message.includes('429')) {
            stopReason = 'rateLimited';
            break;
          }
          if (message.includes('refusé')) {
            stopReason = 'blocked';
            break;
          }
        }
      }

      return {
        sourceId: config.id,
        listings,
        confirmedRefs,
        requestCount,
        pagesFetched,
        stopReason,
        warnings,
      };
    },
  };
}
