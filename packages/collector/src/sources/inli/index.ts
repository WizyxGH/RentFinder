/**
 * Source : In'li — voir l'étude dans `parser.ts` et `docs/sources.md`. Catalogue
 * paginé national : on parcourt les pages, on ne RETIENT que Nice, on ne VISITE
 * que les fiches nouvelles (§30, §32).
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
import { isTargetListing, parseDetailPage, parseListPage } from './parser.js';

const LIST_URL = 'https://www.inli.fr/locations/offres/';
const listPageUrl = (page: number): string => `${LIST_URL}?page=${page}`;

/** Garde-fou : le catalogue fait ~22 pages ; on borne largement au-dessus. */
const MAX_LIST_PAGES = 30;
const MAX_DETAILS_LIVE = 6;
const MAX_DETAILS_BACKFILL = 15;

export const INLI_DESCRIPTOR: SourceDescriptor = {
  id: 'inli',
  name: "In'li",
  domain: 'inli.fr',
  kind: 'localAgency',
  method: 'html',
  priority: 3,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', {
    // Pagination du catalogue + fiches nouvelles. Les pages liste sont mises en
    // cache conditionnel : en régime établi, la plupart répondent 304 (§30).
    maxPagesPerRun: MAX_LIST_PAGES + MAX_DETAILS_BACKFILL,
    maxListingsPerRun: MAX_DETAILS_BACKFILL,
  }),
  enabled: true,
  // Bailleur institutionnel : candidature en ligne, premier contact via la
  // fiche (§23).
  manualOnly: true,
  allowedPaths: ['/locations/offres/', '/location-*'],
  notes:
    'Logement intermédiaire (Action Logement), loyers à prix maîtrisé sous ' +
    'conditions. robots.txt vérifié le 2026-08-21 : seul /espace-membre/ ' +
    'interdit. Pas de filtre serveur par ville → pagination puis filtre Nice. ' +
    'Fiche SSR (og:title/og:description + corps), sans adresse de rue.',
};

export const inliScraper: Scraper = {
  descriptor: INLI_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    let requestCount = 0;
    let pagesFetched = 0;
    let stopReason: StopReason = 'completed';

    // --- 1. Pagination : on collecte les fiches de Nice sur toutes les pages --
    const targeted = new Map<string, ReturnType<typeof parseListPage>['urls'][number]>();
    let lastPage = 1;
    for (let page = 1; page <= Math.min(lastPage, MAX_LIST_PAGES); page += 1) {
      if (context.shouldStop()) {
        stopReason = 'maxPages';
        break;
      }
      const url = listPageUrl(page);
      try {
        const response = await context.fetch(url);
        requestCount += 1;
        if (response.notModified) continue;
        pagesFetched += 1;

        const parsed = parseListPage(response.body, url);
        if (page === 1) lastPage = parsed.lastPage;
        // Un warning « aucune fiche » n'est pertinent que sur la 1re page (les
        // pages au-delà de la fin renverraient logiquement du vide).
        if (page === 1) warnings.push(...parsed.warnings);
        for (const listingUrl of parsed.urls) {
          if (isTargetListing(listingUrl)) targeted.set(listingUrl.reference, listingUrl);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec de la page ${page} : ${message}`);
        context.log('list.failed', { url, error: message });
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

    // --- 2. Nouveau vs connu : on ne visite que l'inédit (§32) ----------------
    const all = [...targeted.values()];
    const confirmedRefs = all
      .filter((url) => context.isKnown(url.reference))
      .map((url) => url.reference);
    const candidates = all.filter((url) => !context.isKnown(url.reference));
    const maxDetails = context.mode === 'backfill' ? MAX_DETAILS_BACKFILL : MAX_DETAILS_LIVE;

    context.log('list.parsed', {
      pages: pagesFetched,
      nice: all.length,
      known: confirmedRefs.length,
      new: candidates.length,
      toFetch: Math.min(candidates.length, maxDetails),
    });

    // --- 3. Visite des fiches nouvelles ---------------------------------------
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

        const parsed = parseDetailPage(response.body, url.canonicalUrl, INLI_DESCRIPTOR.name);
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
      sourceId: INLI_DESCRIPTOR.id,
      listings,
      confirmedRefs,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
