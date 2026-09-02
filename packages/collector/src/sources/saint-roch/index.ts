/**
 * Source : Saint Roch Immobilier — voir l'étude dans `parser.ts` et
 * `docs/sources.md`. Liste SSR → seules les fiches RÉSIDENTIELLES des communes
 * cibles et nouvelles sont visitées (§30) ; les connues sont confirmées sans
 * requête (§32).
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
import { isTargetListing, parseDetailPage, parseListPage } from './parser.js';

const LIST_URL = 'https://www.saintrochimmobilier.com/location-immobilier-nice.asp';

/** Communes cibles, en slug d'URL du site. */
const CITY_SLUGS = ['nice', 'st-laurent-du-var', 'cagnes-sur-mer', 'la-trinite', 'drap'] as const;

const MAX_DETAILS_LIVE = 8;
const MAX_DETAILS_BACKFILL = 20;

export const SAINT_ROCH_DESCRIPTOR: SourceDescriptor = {
  id: 'saint-roch',
  name: 'Saint Roch Immobilier',
  domain: 'saintrochimmobilier.com',
  kind: 'localAgency',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', {
    maxPagesPerRun: 1 + MAX_DETAILS_BACKFILL,
    maxListingsPerRun: MAX_DETAILS_BACKFILL,
  }),
  // Contact PUBLIC, publié par l'agence sur son propre site (relevé le
  // 2026-09-02). Le scanner le signale comme donnée personnelle : c'est une
  // coordonnée professionnelle, déjà publique, et c'est ici la fonctionnalité.
  agencyContact: { email: 'contact@saintroch-immobilier.com' }, // secret-scan-ignore
  enabled: true,
  // Petite agence : premier contact téléphone/formulaire (§23).
  manualOnly: true,
  allowedPaths: ['/location-immobilier-nice.asp', '/annonce/*'],
  notes:
    'Site ASP maison, SSR. robots.txt vérifié le 2026-08-18 : seuls l’admin et ' +
    'les endpoints de formulaires sont interdits (dont /moteur_recherche.asp, ' +
    'non utilisé) — la liste et les fiches /annonce/ sont libres. DPE/GES en ' +
    'toutes lettres. Publie aussi St-Dié-des-Vosges : filtré par commune.',
};

export const saintRochScraper: Scraper = {
  descriptor: SAINT_ROCH_DESCRIPTOR,

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
          sourceId: SAINT_ROCH_DESCRIPTOR.id,
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
        sourceId: SAINT_ROCH_DESCRIPTOR.id,
        listings: [],
        requestCount,
        pagesFetched,
        stopReason: message.includes('429') ? 'rateLimited' : 'tooManyErrors',
        warnings,
      };
    }

    // --- 2. Filtrage : résidentiel des communes cibles seulement (§30) ----
    const targeted = discovered.filter((url) => isTargetListing(url, CITY_SLUGS));
    const confirmedRefs = targeted
      .filter((url) => context.isKnown(url.reference))
      .map((url) => url.reference);
    const candidates = targeted.filter((url) => !context.isKnown(url.reference));
    const maxDetails = context.mode === 'backfill' ? MAX_DETAILS_BACKFILL : MAX_DETAILS_LIVE;

    context.log('list.parsed', {
      discovered: discovered.length,
      targeted: targeted.length,
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

        const parsed = parseDetailPage(response.body, url.canonicalUrl, SAINT_ROCH_DESCRIPTOR.name);
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
      sourceId: SAINT_ROCH_DESCRIPTOR.id,
      listings,
      confirmedRefs,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
