/**
 * Source : L'Adresse — voir l'étude dans `parser.ts`. Page de résultats unique
 * en SSR : tout est sur la carte, une seule requête, aucune visite de fiche (§30).
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

const LIST_URL = 'https://www.ladresse.com/recherche/location/appartement/nice-06000';

export const LADRESSE_DESCRIPTOR: SourceDescriptor = {
  id: 'ladresse',
  name: "L'Adresse",
  domain: 'ladresse.com',
  kind: 'localAgency',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', { maxPagesPerRun: 1, maxListingsPerRun: 40 }),
  enabled: true,
  // Premier contact via le lien du portail, à la main de l'utilisateur (§23).
  manualOnly: true,
  allowedPaths: ['/recherche/location/*', '/annonce/location/*'],
  notes:
    'Réseau coopératif, agence Nice. robots.txt vérifié le 2026-08-22 : permissif. ' +
    'Page de résultats SSR `/recherche/location/appartement/nice-06000` : cartes ' +
    'a.bien avec prix CC, type, pièces, surface, ville/CP (alt), photo, lien. ' +
    'Une requête, pas de visite de fiche. Communes voisines écartées au scoring.',
};

export const ladresseScraper: Scraper = {
  descriptor: LADRESSE_DESCRIPTOR,

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
          sourceId: LADRESSE_DESCRIPTOR.id,
          listings: [],
          requestCount,
          pagesFetched,
          stopReason: 'notModified',
          warnings,
        };
      }
      pagesFetched += 1;
      const parsed = parseListPage(response.body, LIST_URL, LADRESSE_DESCRIPTOR.name);
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
      sourceId: LADRESSE_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
