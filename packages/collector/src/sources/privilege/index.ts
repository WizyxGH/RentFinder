/**
 * Source : Agence Privilège (agenceprivilege.com) — voir l'étude dans
 * `parser.ts`. Apimo ancien schéma : on découvre les fiches de location via la
 * page `/fr/locations` (liens HTML), puis on visite chaque fiche (JSON-LD Apimo
 * standard). robots.txt permissif (signature Apimo, seul /app_dev.php interdit).
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
import { parseApimoDetail } from '../apimo/parser.js';
import { parseLocationLinks } from './parser.js';

const LIST_URL = 'https://www.agenceprivilege.com/fr/locations';
const MAX_DETAILS_LIVE = 8;
const MAX_DETAILS_BACKFILL = 20;

export const PRIVILEGE_DESCRIPTOR: SourceDescriptor = {
  id: 'privilege',
  name: 'Agence Privilège',
  domain: 'agenceprivilege.com',
  kind: 'localAgency',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', {
    maxPagesPerRun: 2 + MAX_DETAILS_BACKFILL,
    maxListingsPerRun: MAX_DETAILS_BACKFILL,
  }),
  enabled: true,
  // Petite agence : premier contact à la main de l'utilisateur (§23).
  manualOnly: true,
  allowedPaths: ['/fr/locations', '/fr/propri*'],
  notes:
    'Agence Nice, Apimo ANCIEN schéma (/fr/propriété/{id}, sitemap non ' +
    'filtrable). robots.txt vérifié le 2026-08-25 : permissif. On liste les ' +
    'locations via /fr/locations (liens SSR) puis on visite les fiches (JSON-LD ' +
    'Apimo). Communes voisines écartées au scoring.',
};

export const privilegeScraper: Scraper = {
  descriptor: PRIVILEGE_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const rentedRefs: string[] = [];
    const warnings: string[] = [];
    let requestCount = 0;
    let pagesFetched = 0;
    let stopReason: StopReason = 'completed';

    // --- 1. Liste des fiches de location -----------------------------------
    let links;
    try {
      const response = await context.fetch(LIST_URL);
      requestCount += 1;
      if (response.notModified) {
        return {
          sourceId: PRIVILEGE_DESCRIPTOR.id,
          listings: [],
          requestCount,
          pagesFetched,
          stopReason: 'notModified',
          warnings,
        };
      }
      pagesFetched += 1;
      links = parseLocationLinks(response.body, LIST_URL);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Échec de la liste : ${message}`);
      context.log('list.failed', { url: LIST_URL, error: message });
      return {
        sourceId: PRIVILEGE_DESCRIPTOR.id,
        listings: [],
        requestCount,
        pagesFetched,
        stopReason: message.includes('429') ? 'rateLimited' : 'tooManyErrors',
        warnings,
      };
    }

    // --- 2. Nouvelles fiches uniquement (§32) ------------------------------
    const confirmedRefs = links.filter((l) => context.isKnown(l.reference)).map((l) => l.reference);
    const candidates = links.filter((l) => !context.isKnown(l.reference));
    const maxDetails = context.mode === 'backfill' ? MAX_DETAILS_BACKFILL : MAX_DETAILS_LIVE;

    context.log('list.parsed', {
      total: links.length,
      known: confirmedRefs.length,
      new: candidates.length,
      toFetch: Math.min(candidates.length, maxDetails),
    });

    // --- 3. Visite des fiches ----------------------------------------------
    for (const link of candidates.slice(0, maxDetails)) {
      if (context.shouldStop()) {
        stopReason = 'maxPages';
        break;
      }
      try {
        const response = await context.fetch(link.canonicalUrl);
        requestCount += 1;
        if (response.notModified) continue;
        pagesFetched += 1;

        const parsed = parseApimoDetail(
          response.body,
          // URL non standard : on fournit une analyse minimale (ville/type
          // viendront du JSON-LD). La transaction est « location » par nature
          // de la page source.
          {
            transaction: 'location',
            typeSlug: '',
            citySlug: '',
            reference: link.reference,
            canonicalUrl: link.canonicalUrl,
          },
          PRIVILEGE_DESCRIPTOR.name,
        );
        warnings.push(...parsed.warnings);
        if (parsed.listing !== null) listings.push(parsed.listing);
        else if (parsed.rented === true) rentedRefs.push(link.reference);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec sur ${link.canonicalUrl} : ${message}`);
        context.log('page.failed', { url: link.canonicalUrl, error: message });
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
      sourceId: PRIVILEGE_DESCRIPTOR.id,
      listings,
      confirmedRefs,
      rentedRefs,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
