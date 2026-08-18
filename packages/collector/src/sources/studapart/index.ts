/**
 * Source : Studapart — voir l'étude détaillée dans `parser.ts` et
 * `docs/sources.md`. Collecte par API JSON publique (POST), une requête par
 * commune cible : chaque requête rend tout le stock de la ville dédoublonné.
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
import { buildSearchBody, parseSearchResponse, SEARCH_API_URL } from './parser.js';

/** Communes cibles, en slug de tag Studapart (`search-<slug>`). */
const CITY_SLUGS = ['nice'] as const;

export const STUDAPART_DESCRIPTOR: SourceDescriptor = {
  id: 'studapart',
  name: 'Studapart',
  domain: 'studapart.com',
  kind: 'portal',
  method: 'officialApi',
  priority: 2,
  schedule: scheduleFor('portal'),
  budget: budgetFor('portal', {
    // Une requête POST par commune suffit à couvrir tout le stock.
    maxPagesPerRun: CITY_SLUGS.length,
    delayBetweenRequestsMs: 2_000,
  }),
  enabled: true,
  // Plateforme : le contact passe par la fiche Studapart (§23).
  manualOnly: true,
  allowedPaths: ['/property'],
  notes:
    'API de recherche publique search-api.studapart.com (proxy Elasticsearch), ' +
    'vérifiée le 2026-08-18. Hôte sans robots ; site principal autorise le ' +
    'crawler générique (Content-Signal search=yes, use=reference). Une requête ' +
    'POST par commune rend ~200 biens dédoublonnés avec adresse exacte. ' +
    'Beaucoup de colocations, signalées pour le filtre perso.',
};

export const studapartScraper: Scraper = {
  descriptor: STUDAPART_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    let requestCount = 0;
    let pagesFetched = 0;
    let stopReason: StopReason = 'completed';

    for (const citySlug of CITY_SLUGS) {
      if (context.shouldStop()) {
        stopReason = 'maxPages';
        break;
      }
      try {
        const response = await context.fetch(SEARCH_API_URL, {
          method: 'POST',
          body: buildSearchBody(citySlug),
          headers: { 'content-type': 'application/json', accept: 'application/json' },
        });
        requestCount += 1;
        if (response.notModified) continue;
        pagesFetched += 1;

        const parsed = parseSearchResponse(response.body);
        warnings.push(...parsed.warnings);
        for (const listing of parsed.listings) listings.push(listing);
        context.log('api.parsed', { city: citySlug, found: parsed.listings.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec Studapart (${citySlug}) : ${message}`);
        context.log('api.failed', { city: citySlug, error: message });
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
      sourceId: STUDAPART_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
