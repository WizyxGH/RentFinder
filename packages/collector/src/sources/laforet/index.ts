/**
 * Source : Laforêt (réseau d'agences).
 *
 * POURQUOI CETTE SOURCE EN PREMIER — voir `docs/sources.md` pour l'étude complète.
 *
 *   - Son `robots.txt` n'interdit que `/louer/rechercher?*` ; les pages
 *     `/ville/location-appartement-{ville}-{cp}` utilisées ici sont autorisées.
 *   - Il déclare explicitement `Allow: /` pour les agents d'IA identifiés, ce
 *     qui traduit une tolérance ouverte à l'accès automatisé identifié (§10).
 *   - Les pages listent aussi les agences voisines, donc une seule requête
 *     couvre Nice et sa périphérie — excellent rapport information/requête (§6).
 *   - Étant un réseau d'agences, il publie des biens parfois absents des grands
 *     portails, ce qui est précisément l'objectif du projet (§3).
 *
 * CONFORMITÉ. Le scraper n'émet aucune requête vers une page interdite, ne
 * cherche pas à récupérer les coordonnées masquées, et s'arrête au premier 429.
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

/**
 * Codes postaux couverts. Nice s'étend sur quatre codes ; les interroger tous
 * coûte quatre requêtes mais garantit de ne rater aucun quartier.
 */
const NICE_POSTAL_CODES = ['06000', '06100', '06200', '06300'] as const;

const BASE_URL = 'https://www.laforet.com/ville/location-appartement-nice';

export const LAFORET_DESCRIPTOR: SourceDescriptor = {
  id: 'laforet',
  name: 'Laforêt',
  domain: 'laforet.com',
  kind: 'agencyNetwork',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('agencyNetwork', { baseIntervalMinutes: 45 }),
  budget: budgetFor('agencyNetwork', {
    // Une page par code postal, plus une éventuelle page 2 : six requêtes
    // suffisent à couvrir Nice entièrement.
    maxPagesPerRun: 6,
    delayBetweenRequestsMs: 3_000,
  }),
  enabled: true,
  // Le premier contact passe par le formulaire de l'agence : l'automatiser
  // sans supervision n'est pas approprié (§23).
  manualOnly: true,
  allowedPaths: ['/ville/location-appartement-*'],
  notes:
    'robots.txt vérifié le 2026-08-14 : seul /louer/rechercher?* est interdit, ' +
    "les pages /ville/* sont autorisées et la pagination ?page=N l'est également. " +
    'Les pages incluent les agences voisines (Cagnes, Beausoleil, Cannes) : le ' +
    'filtrage sur la ville est assuré par le scoring, pas par le scraper.',
};

/**
 * Nombre d'annonces déjà connues, au-delà duquel on cesse de paginer.
 *
 * §9 : quand une page ne contient presque que du déjà-vu, on est descendu assez
 * loin dans l'historique. Continuer coûterait des requêtes pour rien.
 */
const KNOWN_RATIO_STOP = 0.8;

export const laforetScraper: Scraper = {
  descriptor: LAFORET_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    const seenRefs = new Set<string>();
    let pagesFetched = 0;
    let requestCount = 0;
    let stopReason: StopReason = 'completed';

    // En mode `live`, une seule page par code postal suffit : les annonces
    // récentes remontent en tête. Le backfill seul justifie d'aller plus loin (§8).
    const maxPagesPerCode = context.mode === 'backfill' ? 3 : 1;

    outer: for (const postalCode of NICE_POSTAL_CODES) {
      for (let page = 1; page <= maxPagesPerCode; page += 1) {
        if (context.shouldStop()) {
          stopReason = 'maxPages';
          break outer;
        }

        const url =
          page === 1 ? `${BASE_URL}-${postalCode}` : `${BASE_URL}-${postalCode}?page=${page}`;

        let html: string;
        try {
          const response = await context.fetch(url);
          requestCount += 1;

          if (response.notModified) {
            // §30 : rien n'a changé depuis la dernière visite, on passe au
            // code postal suivant sans même analyser la page.
            context.log('page.not_modified', { url });
            break;
          }
          html = response.body;
        } catch (error) {
          // §69 : l'échec d'une page ne fait pas échouer la source entière.
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Échec sur ${url} : ${message}`);
          context.log('page.failed', { url, error: message });
          // Un refus ou une limitation concerne tout le domaine : inutile
          // d'insister sur les autres codes postaux.
          if (message.includes('429') || message.includes('refusé')) {
            stopReason = message.includes('429') ? 'rateLimited' : 'blocked';
            break outer;
          }
          continue;
        }

        pagesFetched += 1;
        const parsed = parseSearchPage(html, url);
        warnings.push(...parsed.warnings);

        let knownOnPage = 0;
        for (const listing of parsed.listings) {
          if (seenRefs.has(listing.sourceRef)) continue;
          seenRefs.add(listing.sourceRef);

          if (context.isKnown(listing.sourceRef)) knownOnPage += 1;
          listings.push(listing);
        }

        context.log('page.parsed', {
          url,
          found: parsed.listings.length,
          known: knownOnPage,
          total: listings.length,
        });

        if (listings.length >= LAFORET_DESCRIPTOR.budget.maxListingsPerRun) {
          stopReason = 'maxListings';
          break outer;
        }

        // §9 : arrêt anticipé en terrain connu.
        const ratio = parsed.listings.length === 0 ? 1 : knownOnPage / parsed.listings.length;
        if (ratio >= KNOWN_RATIO_STOP) {
          context.log('page.known_territory', { url, ratio: Math.round(ratio * 100) });
          stopReason = 'knownTerritory';
          break;
        }

        if (!parsed.hasNextPage) break;
      }
    }

    return {
      sourceId: LAFORET_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
