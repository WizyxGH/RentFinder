/**
 * Source : NousGérons (gestion locative en ligne) — demandée par l'utilisateur.
 *
 * robots.txt explicitement ouvert (`Allow: /`, `Crawl-delay: 1`, accueil des
 * bots identifiés) ; les pages `/location/{ville}` embarquent un JSON-LD
 * ItemList complet. Volume niçois modeste mais annonces de gestion propre —
 * dont des colocations, distinguées par le champ `flatShare` (§17).
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

const ENTRY_URL = 'https://www.nousgerons.com/location/nice';

export const NOUSGERONS_DESCRIPTOR: SourceDescriptor = {
  id: 'nousgerons',
  name: 'NousGérons',
  domain: 'nousgerons.com',
  kind: 'localAgency',
  method: 'html',
  priority: 3,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', { maxPagesPerRun: 1, delayBetweenRequestsMs: 2_000 }),
  enabled: true,
  manualOnly: true,
  allowedPaths: ['/location/*'],
  notes:
    'robots.txt vérifié le 2026-08-15 : Allow: / pour tous, Crawl-delay: 1, ' +
    'sitemaps déclarés. Données lues dans le JSON-LD ItemList de ' +
    '/location/nice (le rendu visuel est côté client). Source demandée par ' +
    "l'utilisateur ; beaucoup d'offres en colocation (flatShare).",
};

export const nousgeronsScraper: Scraper = {
  descriptor: NOUSGERONS_DESCRIPTOR,

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
      sourceId: NOUSGERONS_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
