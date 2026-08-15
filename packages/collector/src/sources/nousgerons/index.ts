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
import { parseDetailPage, parseSearchPage } from './parser.js';

const ENTRY_URL = 'https://www.nousgerons.com/location/nice';

/** Fiches détail visitées au maximum par run (§6, §30). */
const MAX_DETAILS = 12;

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

        // Enrichissement : la fiche détail contient l'adresse exacte, le
        // détail des charges et une description complète, absents de la liste.
        // On ne visite QUE les annonces nouvelles, dans la limite du budget
        // (§6, §30) ; les connues gardent leurs données déjà en base.
        let known = 0;
        let enriched = 0;
        for (const listing of parsed.listings) {
          if (context.isKnown(listing.sourceRef)) {
            known += 1;
            listings.push(listing);
            continue;
          }

          if (enriched >= MAX_DETAILS || context.shouldStop()) {
            listings.push(listing);
            continue;
          }

          try {
            const detail = await context.fetch(listing.sourceUrl);
            requestCount += 1;
            if (!detail.notModified) {
              pagesFetched += 1;
              const parsedDetail = parseDetailPage(detail.body, listing.sourceUrl);
              warnings.push(...parsedDetail.warnings);
              // La fiche prime ; à défaut, on garde la donnée de liste.
              listings.push(parsedDetail.listing ?? listing);
              if (parsedDetail.listing !== null) enriched += 1;
            } else {
              listings.push(listing);
            }
          } catch (error) {
            // §69 : une fiche en échec n'empêche pas de garder la donnée liste.
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Détail échoué ${listing.sourceUrl} : ${message}`);
            listings.push(listing);
            if (message.includes('429')) {
              stopReason = 'rateLimited';
              break;
            }
          }
        }

        context.log('page.parsed', {
          url: ENTRY_URL,
          found: parsed.listings.length,
          known,
          enriched,
        });
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
