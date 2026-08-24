/**
 * Source : Winter Immobilier (agence-winter.com) — voir l'étude dans `parser.ts`.
 * Page `/louer` en SSR : une requête, aucune visite de fiche (§30).
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
import { parseListPage } from './parser.js';

const LIST_URL = 'https://www.agence-winter.com/louer';

export const WINTER_DESCRIPTOR: SourceDescriptor = {
  id: 'winter',
  name: 'Winter Immobilier',
  domain: 'agence-winter.com',
  kind: 'localAgency',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', { maxPagesPerRun: 1, maxListingsPerRun: 40 }),
  enabled: true,
  // Premier contact via le lien du site, à la main de l'utilisateur (§23).
  manualOnly: true,
  allowedPaths: ['/louer', '/biens/a-louer-*'],
  notes:
    'Agence Nice, site custom (Rails). robots.txt vérifié le 2026-08-24 : ' +
    'permissif (interdit /admin/, tris, PDF). Page `/louer` SSR : cartes ' +
    'div.anim-fade-up avec ville, titre (pièces/meublé), prix « … €/mois », ' +
    'lien /biens/a-louer-…-{id}. Une requête, pas de visite de fiche.',
};

export const winterScraper: Scraper = {
  descriptor: WINTER_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    let requestCount = 0;
    let pagesFetched = 0;
    let stopReason: StopReason = 'completed';

    try {
      const response = await context.fetch(LIST_URL);
      requestCount += 1;
      if (response.notModified) {
        return {
          sourceId: WINTER_DESCRIPTOR.id,
          listings: [],
          requestCount,
          pagesFetched,
          stopReason: 'notModified',
          warnings,
        };
      }
      pagesFetched += 1;
      const parsed = parseListPage(response.body, LIST_URL, WINTER_DESCRIPTOR.name);
      listings.push(...parsed.listings);
      warnings.push(...parsed.warnings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Échec de la liste : ${message}`);
      context.log('list.failed', { url: LIST_URL, error: message });
      stopReason = message.includes('429')
        ? 'rateLimited'
        : message.includes('refusé')
          ? 'blocked'
          : 'tooManyErrors';
    }

    context.log('list.parsed', { listings: listings.length });
    return {
      sourceId: WINTER_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
