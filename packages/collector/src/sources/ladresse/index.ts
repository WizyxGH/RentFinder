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
import { parseListPage, parseWithdrawn } from './parser.js';

const LIST_URL = 'https://www.ladresse.com/recherche/location/appartement/nice-06000';

/**
 * Fiches DISPARUES vérifiées par exécution.
 *
 * L'agence laisse la page en ligne avec un bandeau « CE BIEN N'EST PLUS
 * DISPONIBLE A LA LOCATION » : une requête suffit à transformer un « peut-être
 * retirée » en certitude. Le plafond garde la collecte économe (§30) ; les
 * suivantes passeront au run d'après.
 */
const MAX_WITHDRAWN_CHECKS = 5;

export const LADRESSE_DESCRIPTOR: SourceDescriptor = {
  id: 'ladresse',
  name: "L'Adresse",
  domain: 'ladresse.com',
  kind: 'localAgency',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', {
    maxPagesPerRun: 1 + MAX_WITHDRAWN_CHECKS,
    maxListingsPerRun: 40,
  }),
  enabled: true,
  // Premier contact via le lien du portail, à la main de l'utilisateur (§23).
  manualOnly: true,
  allowedPaths: ['/recherche/location/*', '/annonce/location/*'],
  notes:
    'Réseau coopératif, agence Nice. robots.txt vérifié le 2026-08-22 : permissif. ' +
    'Page de résultats SSR `/recherche/location/appartement/nice-06000` : cartes ' +
    'a.bien avec prix CC, type, pièces, surface, ville/CP (alt), photo, lien. ' +
    'Une requête pour la liste. Les annonces DISPARUES de la liste voient leur ' +
    'fiche vérifiée (5 par run) : l’agence y pose « CE BIEN N’EST PLUS ' +
    'DISPONIBLE A LA LOCATION », ce qui lève le doute du cycle de vie (§32). ' +
    'Communes voisines écartées au scoring.',
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

    // --- Annonces disparues de la liste : la fiche tranche -----------------
    //
    // Sans cette vérification elles restaient « peut-être retirée » pendant des
    // jours, alors que l'agence, elle, ne doute pas.
    const seen = new Set(listings.map((listing) => listing.sourceRef));
    const vanished = [...context.knownRefs].filter((ref) => !seen.has(ref));
    const rentedRefs: string[] = [];

    if (stopReason === 'completed') {
      for (const reference of vanished.slice(0, MAX_WITHDRAWN_CHECKS)) {
        if (context.shouldStop()) break;
        const url = `https://www.ladresse.com/annonce/location/appartement/nice-06000/${reference}`;
        try {
          const page = await context.fetch(url);
          requestCount += 1;
          if (page.notModified) continue;
          pagesFetched += 1;
          if (parseWithdrawn(page.body)) rentedRefs.push(reference);
        } catch (error) {
          // Une fiche injoignable ne prouve rien : l'annonce garde son doute.
          const message = error instanceof Error ? error.message : String(error);
          context.log('withdrawn.check_failed', { reference, error: message });
          if (message.includes('429')) break;
        }
      }
    }

    context.log('list.parsed', {
      listings: listings.length,
      vanished: vanished.length,
      withdrawn: rentedRefs.length,
    });
    return {
      sourceId: LADRESSE_DESCRIPTOR.id,
      listings,
      rentedRefs,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
