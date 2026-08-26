/**
 * Fabrique de scrapers pour les agences sur plateforme Apimo/Cello (§5, §47).
 *
 * Ajouter une agence = une entrée `makeApimoScraper({...})`, sans dupliquer la
 * logique de collecte : sitemap → filtrage des communes cibles → visite des
 * seules fiches nouvelles → confirmation des connues sans requête (§30, §32).
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
import { parseDetailPage, parseSitemap, parseSitemapIndex, type SitemapEntry } from './parser.js';

export interface ApimoConfig {
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
  /**
   * Âge maximum d'une entrée de sitemap, en jours. Au-delà, on ne visite pas :
   * certains sites Apimo ne purgent jamais leur sitemap et y laissent des
   * annonces supprimées depuis plus d'un an (personalimmo : 23 entrées de
   * mars 2025 encore listées en août 2026, toutes en 404/301). Les visiter
   * gaspille le budget de pages au détriment des annonces vivantes.
   * Une entrée SANS `lastmod` n'est jamais écartée (§17). Défaut : 365 jours.
   */
  readonly maxEntryAgeDays?: number;
}

export function makeApimoDescriptor(config: ApimoConfig): SourceDescriptor {
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
      maxPagesPerRun: 2 + maxBackfill,
      maxListingsPerRun: maxBackfill,
    }),
    enabled: true,
    // Petite structure : premier contact téléphonique/formulaire (§23).
    manualOnly: true,
    allowedPaths: ['/sitemap*.xml', '/fr/propriete/location*'],
    notes:
      `Plateforme Apimo/Cello (adaptateur générique, §47). robots.txt permissif ` +
      `(seul /app_dev.php interdit), sitemap déclaré. Méthode sitemap : la liste ` +
      `HTML est en lazy-load JS, le sitemap donne toutes les fiches + lastmod ; ` +
      `seules les nouvelles des communes cibles sont visitées.`,
  };
}

export function makeApimoScraper(config: ApimoConfig): Scraper {
  const descriptor = makeApimoDescriptor(config);
  const targetCities = new Set(config.citySlugs);
  const maxLive = config.maxDetailsLive ?? 8;
  const maxBackfill = config.maxDetailsBackfill ?? 20;
  const maxEntryAgeDays = config.maxEntryAgeDays ?? 365;

  return {
    descriptor,

    async run(context: ScrapeContext): Promise<ScrapeResult> {
      const listings: RawListing[] = [];
      const rentedRefs: string[] = [];
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
        // Certains sites servent l'urlset directement (pas d'index).
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

      // --- 2. Filtrer et prioriser ----------------------------------------
      // Les entrées trop anciennes sont écartées AVANT tout : un sitemap non
      // purgé y garde des annonces supprimées, qui consommeraient le budget de
      // pages pour rien. Sans `lastmod`, on ne juge pas (§17).
      const staleBefore = Date.now() - maxEntryAgeDays * 86_400_000;
      const fresh = entries.filter((entry) => {
        if (entry.lastmod === undefined || entry.lastmod === null) return true;
        const stamp = Date.parse(entry.lastmod);
        return !Number.isFinite(stamp) || stamp >= staleBefore;
      });
      const skippedStale = entries.length - fresh.length;
      if (skippedStale > 0) {
        context.log('sitemap.stale_skipped', { skipped: skippedStale, maxEntryAgeDays });
      }

      const targeted = fresh.filter((entry) => targetCities.has(entry.url.citySlug));
      const confirmedRefs = targeted
        .filter((entry) => context.isKnown(entry.url.reference))
        .map((entry) => entry.url.reference);
      const candidates = targeted
        .filter((entry) => !context.isKnown(entry.url.reference))
        .sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? ''));

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
          else if (parsed.rented === true) rentedRefs.push(entry.url.reference);
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
        rentedRefs,
        requestCount,
        pagesFetched,
        stopReason,
        warnings,
      };
    },
  };
}
