/**
 * Source : Citya Immobilier — voir l'étude dans `parser.ts`. Pages SEO par
 * commune (Nice = INSEE 06088) → fiches nouvelles uniquement (§30, §32).
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
import { parseDetailPage, parseListPage, type ParsedCityaUrl } from './parser.js';

const BASE = 'https://www.citya.com';
/** Pages de liste SEO (autorisées par robots) : location par type à Nice. */
const LIST_URLS = [
  `${BASE}/annonces/location/appartement/nice-06088`,
  `${BASE}/annonces/location/maison/nice-06088`,
];

const MAX_DETAILS_LIVE = 8;
const MAX_DETAILS_BACKFILL = 20;

export const CITYA_DESCRIPTOR: SourceDescriptor = {
  id: 'citya',
  name: 'Citya Immobilier',
  domain: 'citya.com',
  kind: 'agencyNetwork',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('agencyNetwork'),
  budget: budgetFor('agencyNetwork', {
    maxPagesPerRun: LIST_URLS.length + MAX_DETAILS_BACKFILL,
    maxListingsPerRun: MAX_DETAILS_BACKFILL,
  }),
  enabled: true,
  manualOnly: true,
  allowedPaths: ['/annonces/location/*'],
  notes:
    'robots.txt vérifié le 2026-08-19 : /annonces/* autorisé ; /recherche, ' +
    '/api, /carte et les URLs à paramètres interdits. Pages SEO par commune ' +
    '(Nice = INSEE 06088), SSR. Fiche : JSON-LD RealEstateListing (prix, nom, ' +
    'description). Seules les fiches résidentielles nouvelles sont visitées.',
};

export const cityaScraper: Scraper = {
  descriptor: CITYA_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    let requestCount = 0;
    let pagesFetched = 0;
    let stopReason: StopReason = 'completed';

    // --- 1. Listes SEO : découvrir les fiches ----------------------------
    const discovered = new Map<string, ParsedCityaUrl>();
    for (const listUrl of LIST_URLS) {
      try {
        const response = await context.fetch(listUrl);
        requestCount += 1;
        if (response.notModified) continue;
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
            sourceId: CITYA_DESCRIPTOR.id,
            listings,
            requestCount,
            pagesFetched,
            stopReason: 'rateLimited',
            warnings,
          };
        }
      }
    }

    // --- 2. Nouvelles fiches d'abord, connues confirmées sans requête ----
    const all = [...discovered.values()];
    const confirmedRefs = all
      .filter((url) => context.isKnown(url.reference))
      .map((url) => url.reference);
    const candidates = all.filter((url) => !context.isKnown(url.reference));
    const maxDetails = context.mode === 'backfill' ? MAX_DETAILS_BACKFILL : MAX_DETAILS_LIVE;

    context.log('list.parsed', {
      discovered: all.length,
      known: confirmedRefs.length,
      new: candidates.length,
      toFetch: Math.min(candidates.length, maxDetails),
    });

    // --- 3. Visite des fiches nouvelles ----------------------------------
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
        const parsed = parseDetailPage(response.body, url.canonicalUrl, CITYA_DESCRIPTOR.name);
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
      sourceId: CITYA_DESCRIPTOR.id,
      listings,
      confirmedRefs,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
