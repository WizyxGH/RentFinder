/**
 * Source : Mirabello Immobilier — voir l'étude dans `parser.ts` et
 * `docs/sources.md`. Liste unique server-rendered → seules les fiches NOUVELLES
 * sont visitées (§30) ; les connues sont confirmées sans requête (§32).
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
import { parseDetailPage, parseListPage } from './parser.js';

const LIST_URL = 'https://mirabello-immobilier.com/fr/locations';

const MAX_DETAILS_LIVE = 8;
const MAX_DETAILS_BACKFILL = 20;

export const MIRABELLO_DESCRIPTOR: SourceDescriptor = {
  id: 'mirabello',
  name: 'Mirabello Immobilier',
  domain: 'mirabello-immobilier.com',
  kind: 'localAgency',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', {
    maxPagesPerRun: 1 + MAX_DETAILS_BACKFILL,
    maxListingsPerRun: MAX_DETAILS_BACKFILL,
  }),
  enabled: true,
  // Petite agence : premier contact téléphone/formulaire (§23).
  manualOnly: true,
  allowedPaths: ['/fr/locations', '/fr/propriété/*'],
  notes:
    'Backend Apimo, frontend Symfony maison (« Design by Apimo ») : chaque fiche ' +
    'porte un JSON-LD schema.org complet, parsé directement. robots.txt vérifié ' +
    'le 2026-08-21 : n’interdit que /app_dev.php. Prix retenu = loyer charges ' +
    'comprises (span .price). Publie aussi Cagnes-sur-Mer : filtré par commune.',
};

export const mirabelloScraper: Scraper = {
  descriptor: MIRABELLO_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    let requestCount = 0;
    let pagesFetched = 0;
    let stopReason: StopReason = 'completed';

    // --- 1. Liste unique : tout le stock locatif de l'agence --------------
    let discovered: ReturnType<typeof parseListPage>['urls'] = [];
    try {
      const response = await context.fetch(LIST_URL);
      requestCount += 1;
      if (response.notModified) {
        return {
          sourceId: MIRABELLO_DESCRIPTOR.id,
          listings: [],
          requestCount,
          pagesFetched,
          stopReason: 'notModified',
          warnings,
        };
      }
      pagesFetched += 1;
      const parsed = parseListPage(response.body, LIST_URL);
      warnings.push(...parsed.warnings);
      discovered = parsed.urls;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Échec de la liste : ${message}`);
      context.log('list.failed', { url: LIST_URL, error: message });
      return {
        sourceId: MIRABELLO_DESCRIPTOR.id,
        listings: [],
        requestCount,
        pagesFetched,
        stopReason: message.includes('429') ? 'rateLimited' : 'tooManyErrors',
        warnings,
      };
    }

    // --- 2. Nouveau vs connu : on ne visite que les fiches inédites (§32) --
    const confirmedRefs = discovered
      .filter((url) => context.isKnown(url.reference))
      .map((url) => url.reference);
    const candidates = discovered.filter((url) => !context.isKnown(url.reference));
    const maxDetails = context.mode === 'backfill' ? MAX_DETAILS_BACKFILL : MAX_DETAILS_LIVE;

    context.log('list.parsed', {
      discovered: discovered.length,
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

        const parsed = parseDetailPage(response.body, url.canonicalUrl, MIRABELLO_DESCRIPTOR.name);
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
      sourceId: MIRABELLO_DESCRIPTOR.id,
      listings,
      confirmedRefs,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
