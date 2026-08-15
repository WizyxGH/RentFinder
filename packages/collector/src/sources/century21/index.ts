/**
 * Source : Century 21 (réseau d'agences).
 *
 * Le verdict initial « écartée » reposait sur une lecture trop rapide du
 * robots.txt : seules les recherches par CODE POSTAL (`cp-…`) et par agence
 * sont interdites — le format par ville `/annonces/location-appartement/v-nice/`
 * ne l'est pas, s'affiche en SSR et se déclare lui-même indexable. Corrigé le
 * 2026-08-15, voir docs/sources.md.
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
import { parseSearchPage } from './parser.js';

/** Une page = tout le stock locatif C21 à Nice (19 annonces observées). */
const ENTRY_URL = 'https://www.century21.fr/annonces/location-appartement/v-nice/';

export const CENTURY21_DESCRIPTOR: SourceDescriptor = {
  id: 'century21',
  name: 'Century 21',
  domain: 'century21.fr',
  kind: 'agencyNetwork',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('agencyNetwork'),
  budget: budgetFor('agencyNetwork', { maxPagesPerRun: 1, delayBetweenRequestsMs: 3_000 }),
  enabled: true,
  manualOnly: true,
  allowedPaths: ['/annonces/location-appartement/v-*'],
  notes:
    'robots.txt vérifié le 2026-08-15 : cp-* et /a/*/annonces/ interdits, le ' +
    'format par ville v-nice ne l’est pas (SSR, meta robots index). Une page ' +
    'couvre tout le stock — pas de pagination. Réf. agence dans le h3.',
};

export const century21Scraper: Scraper = {
  descriptor: CENTURY21_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    let pagesFetched = 0;
    let requestCount = 0;
    let stopReason: StopReason = 'completed';

    try {
      const response = await context.fetch(ENTRY_URL);
      requestCount += 1;

      if (response.notModified) {
        context.log('page.not_modified', { url: ENTRY_URL });
        stopReason = 'notModified';
      } else {
        pagesFetched += 1;
        const parsed = parseSearchPage(response.body, ENTRY_URL);
        warnings.push(...parsed.warnings);

        let known = 0;
        for (const listing of parsed.listings) {
          if (context.isKnown(listing.sourceRef)) known += 1;
          listings.push(listing);
        }
        context.log('page.parsed', { url: ENTRY_URL, found: parsed.listings.length, known });
      }
    } catch (error) {
      // §69 : échec propre, les autres sources continuent.
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Échec sur ${ENTRY_URL} : ${message}`);
      context.log('page.failed', { url: ENTRY_URL, error: message });
      stopReason = message.includes('429')
        ? 'rateLimited'
        : message.includes('refusé')
          ? 'blocked'
          : 'tooManyErrors';
    }

    return {
      sourceId: CENTURY21_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
