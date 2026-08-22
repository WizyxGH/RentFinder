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

/** Résultat de l'enrichissement d'UNE annonce par sa fiche détail. */
interface EnrichResult {
  /** Annonce à conserver : la fiche si elle a pu être lue, sinon celle de liste. */
  readonly listing: RawListing;
  readonly enriched: boolean;
  readonly pagesFetched: number;
  readonly warnings: readonly string[];
  /** `true` si un 429 impose d'arrêter la source (§30). */
  readonly rateLimited: boolean;
}

/**
 * Visite la fiche détail d'une annonce pour l'enrichir (adresse exacte, charges,
 * description). Ne lève jamais : en cas d'échec, on garde la donnée de liste
 * (§69). Extraite pour garder la boucle principale peu imbriquée.
 */
async function enrichListing(context: ScrapeContext, listing: RawListing): Promise<EnrichResult> {
  try {
    const detail = await context.fetch(listing.sourceUrl);
    if (detail.notModified) {
      return { listing, enriched: false, pagesFetched: 0, warnings: [], rateLimited: false };
    }
    const parsed = parseDetailPage(detail.body, listing.sourceUrl);
    // La fiche prime ; à défaut, on garde la donnée de liste.
    return {
      listing: parsed.listing ?? listing,
      enriched: parsed.listing !== null,
      pagesFetched: 1,
      warnings: parsed.warnings,
      rateLimited: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      listing,
      enriched: false,
      pagesFetched: 0,
      warnings: [`Détail échoué ${listing.sourceUrl} : ${message}`],
      rateLimited: message.includes('429'),
    };
  }
}

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

          const result = await enrichListing(context, listing);
          requestCount += 1;
          pagesFetched += result.pagesFetched;
          warnings.push(...result.warnings);
          listings.push(result.listing);
          if (result.enriched) enriched += 1;
          if (result.rateLimited) {
            stopReason = 'rateLimited';
            break;
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
