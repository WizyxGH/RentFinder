/**
 * Source : Lamy Immobilier — voir l'en-tête de `parser.ts` et `docs/sources.md`.
 *
 * Méthode sitemap, comme l'adaptateur Apimo (§47) : le sitemap (urlset unique,
 * ~1,9 Mo) donne toutes les fiches ; seules les NOUVELLES fiches des communes
 * cibles sont visitées, les connues sont confirmées sans requête (§30, §32).
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
import { parseDetailPage, parseSitemap } from './parser.js';

const SITEMAP_URL = 'https://www.lamy-immobilier.fr/sitemap.xml';

/** Communes cibles (slug d'URL, sans le code postal). */
const TARGET_CITIES = new Set([
  'nice',
  'saint-laurent-du-var',
  'cagnes-sur-mer',
  'villeneuve-loubet',
  'beaulieu-sur-mer',
  'cap-d-ail',
  'villefranche-sur-mer',
  'la-trinite',
  'drap',
  'carros',
  'contes',
  'antibes',
]);

const MAX_DETAILS_LIVE = 8;
const MAX_DETAILS_BACKFILL = 20;

export const LAMY_DESCRIPTOR: SourceDescriptor = {
  id: 'lamy',
  name: 'Lamy Immobilier',
  domain: 'lamy-immobilier.fr',
  kind: 'agencyNetwork',
  method: 'sitemap',
  priority: 2,
  schedule: scheduleFor('agencyNetwork'),
  budget: budgetFor('agencyNetwork', {
    maxPagesPerRun: 1 + MAX_DETAILS_BACKFILL,
    maxListingsPerRun: MAX_DETAILS_BACKFILL,
  }),
  enabled: true,
  // Réseau d'agences : premier contact via le formulaire de la fiche (§23).
  manualOnly: true,
  allowedPaths: ['/sitemap.xml', '/louer/*'],
  notes:
    'robots.txt vérifié le 2026-08-17 : tout autorisé sauf /is_admin/ et ' +
    '/login/, sitemap déclaré. CMS Ibexa, fiches server-rendered ancrées sur ' +
    'les classes estate__*. Sitemap urlset unique (~1,9 Mo, ~3 200 locations).',
};

export const lamyScraper: Scraper = {
  descriptor: LAMY_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    let requestCount = 0;
    let pagesFetched = 0;
    let stopReason: StopReason = 'completed';

    // --- 1. Sitemap : découvrir toutes les fiches de location ---------------
    let entries: ReturnType<typeof parseSitemap> = [];
    try {
      const response = await context.fetch(SITEMAP_URL);
      requestCount += 1;
      pagesFetched += 1;
      if (response.notModified) {
        context.log('sitemap.not_modified', { url: SITEMAP_URL });
        return {
          sourceId: LAMY_DESCRIPTOR.id,
          listings: [],
          requestCount,
          pagesFetched,
          stopReason: 'notModified',
          warnings,
        };
      }
      entries = parseSitemap(response.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Échec du sitemap : ${message}`);
      context.log('sitemap.failed', { error: message });
      return {
        sourceId: LAMY_DESCRIPTOR.id,
        listings: [],
        requestCount,
        pagesFetched,
        stopReason: message.includes('429') ? 'rateLimited' : 'tooManyErrors',
        warnings,
      };
    }

    // --- 2. Filtrer les communes cibles et prioriser les nouveautés ---------
    const targeted = entries.filter((entry) => TARGET_CITIES.has(entry.url.citySlug));
    const confirmedRefs = targeted
      .filter((entry) => context.isKnown(entry.url.reference))
      .map((entry) => entry.url.reference);
    const candidates = targeted
      .filter((entry) => !context.isKnown(entry.url.reference))
      .sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? ''));

    const maxDetails = context.mode === 'backfill' ? MAX_DETAILS_BACKFILL : MAX_DETAILS_LIVE;
    context.log('sitemap.parsed', {
      total: entries.length,
      targeted: targeted.length,
      known: confirmedRefs.length,
      new: candidates.length,
      toFetch: Math.min(candidates.length, maxDetails),
    });

    // --- 3. Visiter uniquement les fiches nouvelles -------------------------
    for (const entry of candidates.slice(0, maxDetails)) {
      if (context.shouldStop()) {
        stopReason = 'maxPages';
        break;
      }
      try {
        const response = await context.fetch(entry.url.canonicalUrl);
        requestCount += 1;
        if (response.notModified) continue;
        pagesFetched += 1;

        const parsed = parseDetailPage(response.body, entry.url.canonicalUrl);
        warnings.push(...parsed.warnings);
        if (parsed.listing !== null) listings.push(parsed.listing);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec sur ${entry.url.canonicalUrl} : ${message}`);
        context.log('page.failed', { url: entry.url.canonicalUrl, error: message });
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
      sourceId: LAMY_DESCRIPTOR.id,
      listings,
      confirmedRefs,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
