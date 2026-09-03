/**
 * Source : Rentumo — voir l'étude dans `parser.ts` et la fiche de
 * `docs/sources.md`.
 *
 * AGRÉGATEUR, et collecté en connaissance de cause (décision utilisateur du
 * 2026-09-03) : il republie des annonces sans jamais lier l'annonce d'origine
 * ni publier de coordonnées — celles-ci sont floutées derrière un abonnement
 * payant. Ce qu'il apporte, ce sont des biens venus de portails auxquels le
 * projet n'a aucun accès conforme (§10), avec assez de faits pour décider s'il
 * vaut la peine de les chercher ailleurs.
 *
 * SEULES LES PAGES DE RÉSULTATS sont lues : la fiche n'ajoute rien qu'on
 * puisse exploiter, et la visiter coûterait une requête par annonce (§30).
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
import { parseListPage } from './parser.js';

const ORIGIN = 'https://rentumo.com';

/** Page de résultats par commune. 21 annonces par page. */
const LIST_URL = `${ORIGIN}/rent-apartment/nice`;

/**
 * Pages parcourues par exécution. Le stock niçois tourne autour de 500
 * annonces toutes gammes confondues, mais elles sont triées par fraîcheur :
 * les premières pages portent l'essentiel de ce qui est nouveau (§30).
 */
const MAX_PAGES = 4;

export const RENTUMO_DESCRIPTOR: SourceDescriptor = {
  id: 'rentumo',
  name: 'Rentumo',
  domain: 'rentumo.com',
  kind: 'aggregator',
  method: 'html',
  // Priorité basse : donnée de seconde main, sans lien vers l'annonce
  // d'origine. Une source directe qui publie le même bien doit primer (§13).
  priority: 4,
  schedule: scheduleFor('aggregator'),
  budget: budgetFor('aggregator', { maxPagesPerRun: MAX_PAGES, maxListingsPerRun: 100 }),
  enabled: true,
  manualOnly: true,
  // Agrégateur : les photos décodées portent l'URL d'origine, propre à UNE
  // annonce — deux fiches qui la partagent sont le même bien (§14).
  relaysListings: true,
  allowedPaths: ['/rent-apartment/*', '/listings/*'],
  notes:
    'robots.txt vérifié le 2026-09-03 : Allow: / ; seuls *?sort_by=*, ' +
    '/users/sign_in et /search-agents/new sont interdits — les listes et les ' +
    'fiches sont autorisées. Pages entièrement rendues côté serveur, 21 ' +
    'annonces par page, pagination `?page=N` déclarée en <link rel="next">. ' +
    'AGRÉGATEUR : aucun lien vers l’annonce d’origine, coordonnées floutées ' +
    'derrière un abonnement payant, et champs annoncés comme « extraits par ' +
    'IA » — on ne retient donc que ce que la carte affiche tel quel. Les ' +
    'photos passent par un proxy dont l’URL encode en base64 l’adresse ' +
    'D’ORIGINE : on la décode, ce qui donne la photo en pleine qualité et ' +
    'révèle l’hébergeur du site source (FNAIM, La Boîte Immo, Orpi…).',
};

export const rentumoScraper: Scraper = {
  descriptor: RENTUMO_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const byRef = new Map<string, RawListing>();
    const warnings: string[] = [];
    let requestCount = 0;
    let pagesFetched = 0;
    let stopReason: StopReason = 'completed';

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      if (context.shouldStop()) {
        stopReason = 'maxPages';
        break;
      }
      const url = page === 1 ? LIST_URL : `${LIST_URL}?page=${page}`;
      try {
        const response = await context.fetch(url);
        requestCount += 1;
        if (response.notModified) {
          stopReason = 'notModified';
          break;
        }
        pagesFetched += 1;

        const parsed = parseListPage(response.body, url);
        warnings.push(...parsed.warnings);
        if (parsed.listings.length === 0) break;
        for (const listing of parsed.listings) byRef.set(listing.sourceRef, listing);

        // Arrêt anticipé : la liste est classée par fraîcheur, donc une page
        // entièrement déjà connue signifie qu'on est sorti des nouveautés (§9).
        if (parsed.listings.every((listing) => context.isKnown(listing.sourceRef))) {
          stopReason = 'knownTerritory';
          break;
        }
        if (!parsed.hasNext) break;
      } catch (error) {
        // §69 : échec propre, les autres sources continuent.
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec sur ${url} : ${message}`);
        context.log('page.failed', { url, error: message });
        stopReason = message.includes('429')
          ? 'rateLimited'
          : message.includes('refusé')
            ? 'blocked'
            : 'tooManyErrors';
        break;
      }
    }

    const listings = [...byRef.values()];
    context.log('list.parsed', {
      listings: listings.length,
      known: listings.filter((listing) => context.isKnown(listing.sourceRef)).length,
    });

    return {
      sourceId: RENTUMO_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
