/**
 * Fabrique de scrapers pour les agences sur plateforme La Boîte Immo/Hektor
 * (§5, §47). Ajouter une agence = une entrée `makeHektorScraper({...})`.
 *
 * Méthode : pages de LISTE (server-rendered) → liens de fiches → visite des
 * seules fiches nouvelles ; les connues sont confirmées sans requête (§30,
 * §32). Le sitemap n'est pas utilisé : sur plusieurs sites de la plateforme il
 * ne référence pas les fiches.
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
import { parseDetailPage, parseListPage, type ParsedHektorUrl } from './parser.js';

export interface HektorConfig {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  /** Pages de liste des locations, absolues (la 1re page suffit souvent). */
  readonly listUrls: readonly string[];
  readonly priority?: number;
  readonly maxDetailsLive?: number;
  readonly maxDetailsBackfill?: number;
}

export function makeHektorDescriptor(config: HektorConfig): SourceDescriptor {
  const maxBackfill = config.maxDetailsBackfill ?? 20;
  return {
    id: config.id,
    name: config.name,
    domain: config.domain,
    kind: 'localAgency',
    method: 'html',
    priority: config.priority ?? 2,
    schedule: scheduleFor('localAgency'),
    budget: budgetFor('localAgency', {
      maxPagesPerRun: config.listUrls.length + maxBackfill,
      maxListingsPerRun: maxBackfill,
    }),
    enabled: true,
    // Petite structure : premier contact téléphone/formulaire (§23).
    manualOnly: true,
    allowedPaths: ['/location*', '/a-louer*', '/*.html'],
    notes:
      'Plateforme La Boîte Immo/Hektor (adaptateur générique, §47). robots.txt ' +
      'permissif (interdits : /stats, /phpmv2, /fonctions, /templates, /admin). ' +
      'Listes SSR → fiches nouvelles uniquement. DPE non extrait (image sous ' +
      '/admin, interdit par robots) — laissé inconnu (§17).',
  };
}

export function makeHektorScraper(config: HektorConfig): Scraper {
  const descriptor = makeHektorDescriptor(config);
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

      // --- 1. Listes : découvrir les fiches ---------------------------------
      const discovered = new Map<string, ParsedHektorUrl>();
      for (const listUrl of config.listUrls) {
        try {
          const response = await context.fetch(listUrl);
          requestCount += 1;
          if (response.notModified) {
            context.log('list.not_modified', { url: listUrl });
            continue;
          }
          pagesFetched += 1;
          const parsed = parseListPage(response.body, listUrl);
          warnings.push(...parsed.warnings);
          for (const url of parsed.urls) {
            if (!discovered.has(url.reference)) discovered.set(url.reference, url);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Échec de la liste ${listUrl} : ${message}`);
          context.log('list.failed', { url: listUrl, error: message });
          if (message.includes('429')) {
            return {
              sourceId: config.id,
              listings,
              requestCount,
              pagesFetched,
              stopReason: 'rateLimited',
              warnings,
            };
          }
        }
      }

      // --- 2. Nouvelles fiches d'abord, connues confirmées sans requête -----
      const all = [...discovered.values()];
      const confirmedRefs = all
        .filter((url) => context.isKnown(url.reference))
        .map((url) => url.reference);
      const candidates = all.filter((url) => !context.isKnown(url.reference));
      const maxDetails = context.mode === 'backfill' ? maxBackfill : maxLive;

      context.log('list.parsed', {
        discovered: all.length,
        known: confirmedRefs.length,
        new: candidates.length,
        toFetch: Math.min(candidates.length, maxDetails),
      });

      // --- 3. Visite des fiches nouvelles -----------------------------------
      for (const url of candidates.slice(0, maxDetails)) {
        if (context.shouldStop()) {
          stopReason = 'maxPages';
          break;
        }
        try {
          const response = await context.fetch(url.canonicalUrl);
          requestCount += 1;
          if (response.notModified) continue;
          pagesFetched += 1;

          const parsed = parseDetailPage(response.body, url.canonicalUrl, config.name);
          warnings.push(...parsed.warnings);
          if (parsed.listing !== null) listings.push(parsed.listing);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Échec sur ${url.canonicalUrl} : ${message}`);
          context.log('page.failed', { url: url.canonicalUrl, error: message });
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
