/**
 * Source : Orpi (réseau d'agences).
 *
 * POURQUOI CETTE SOURCE EN DEUXIÈME — voir `docs/sources.md` pour l'étude.
 *
 *   - `robots.txt` (revérifié le 2026-08-15) : `/recherche/*` est interdit,
 *     mais la page ville `/location-immobiliere-nice/` ne l'est pas, et sa
 *     pagination `?page=N` n'apparaît dans aucun Disallow (seuls `agency=`,
 *     `sujet=`, `contact=`, `orderBy=` sont bloqués).
 *   - Les cartes embarquent prix, surface, pièces, agence, quartier et — fait
 *     rare — les COORDONNÉES GPS : le signal de dédoublonnage le plus fort
 *     après le téléphone (§14). Une requête = ~15 annonces très riches (§6).
 *   - Premier réseau d'agences de France : forte couverture niçoise, biens
 *     parfois absents des grands portails (§3).
 *
 * CONFORMITÉ. Aucune requête vers `/recherche/*` ni vers un chemin à
 * paramètre interdit (`?contact=true` n'est jamais visité : l'URL est
 * canonisée avant toute chose). Arrêt au premier 429.
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
 * Point d'entrée unique : la page ville agrège tous les codes postaux de Nice
 * (06000 à 06300 observés sur la même page), contrairement à Laforêt qui
 * demande une page par code postal.
 */
const BASE_URL = 'https://www.orpi.com/location-immobiliere-nice/';

export const ORPI_DESCRIPTOR: SourceDescriptor = {
  id: 'orpi',
  name: 'Orpi',
  domain: 'orpi.com',
  kind: 'agencyNetwork',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('agencyNetwork', { baseIntervalMinutes: 45 }),
  budget: budgetFor('agencyNetwork', {
    // Une page couvre ~15 annonces triées nouveautés en tête : en mode live,
    // deux pages absorbent largement le flux de nouveautés entre deux runs.
    maxPagesPerRun: 4,
    delayBetweenRequestsMs: 3_000,
  }),
  enabled: true,
  // Le premier contact passe par le formulaire d'agence (§23).
  manualOnly: true,
  allowedPaths: ['/location-immobiliere-*'],
  notes:
    'robots.txt vérifié le 2026-08-15 : /recherche/* interdit, page ville et ' +
    'pagination ?page=N autorisées ; les paramètres agency/sujet/contact/orderBy ' +
    'sont interdits et ne sont jamais utilisés. Cartes riches (GPS, quartier, ' +
    'agence, date de création) via attribut data-eulerian-action — traité comme ' +
    'enrichissement fragile, le HTML visible fait foi.',
};

/** §9 : au-delà de ce ratio de déjà-vu sur une page, on cesse de paginer. */
const KNOWN_RATIO_STOP = 0.8;

export const orpiScraper: Scraper = {
  descriptor: ORPI_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    // Une même annonce peut apparaître sur deux pages consécutives (le tri
    // bouge entre deux requêtes) : on ne la compte qu'une fois par run.
    const seenRefs = new Set<string>();
    let pagesFetched = 0;
    let requestCount = 0;
    let stopReason: StopReason = 'completed';

    // Mode live : 2 pages maximum ; backfill : le budget de la source (§8).
    const maxPages = context.mode === 'backfill' ? ORPI_DESCRIPTOR.budget.maxPagesPerRun : 2;

    for (let page = 1; page <= maxPages; page += 1) {
      if (context.shouldStop()) {
        stopReason = 'maxPages';
        break;
      }

      const url = page === 1 ? BASE_URL : `${BASE_URL}?page=${page}`;

      let html: string;
      try {
        const response = await context.fetch(url);
        requestCount += 1;

        if (response.notModified) {
          // §30 : page inchangée depuis la dernière visite — rien à analyser,
          // et les pages suivantes n'ont pas bougé non plus.
          context.log('page.not_modified', { url });
          break;
        }
        html = response.body;
      } catch (error) {
        // §69 : un échec de page n'abat pas la source ; un refus ou une
        // limitation arrête le run proprement.
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec sur ${url} : ${message}`);
        context.log('page.failed', { url, error: message });
        if (message.includes('429')) {
          stopReason = 'rateLimited';
        } else if (message.includes('refusé')) {
          stopReason = 'blocked';
        }
        break;
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

      if (listings.length >= ORPI_DESCRIPTOR.budget.maxListingsPerRun) {
        stopReason = 'maxListings';
        break;
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

    return {
      sourceId: ORPI_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
