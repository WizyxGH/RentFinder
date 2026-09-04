/**
 * Source : ERA Immobilier — voir l'étude dans `parser.ts` et la fiche de
 * `docs/sources.md`.
 *
 * L'utilisateur a demandé « ERA Mac Immobilier », une franchise niçoise. On
 * prend le réseau plutôt que cette agence-là : la page ville d'ERA rassemble
 * les annonces de TOUTES ses franchises sur Nice — au relevé du 2026-09-04,
 * six agences différentes, dont ERA Mac — pour le même nombre de requêtes
 * (§30). Le nom de la franchise reste porté par chaque annonce.
 *
 * Deux pages suffisent : le stock niçois est de douze annonces, dix par page.
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

const ORIGIN = 'https://www.eraimmobilier.com';

/**
 * Page ville, tous types de location confondus. Elle figure telle quelle dans
 * `sitemap_silo_location.xml` — le site l'offre donc explicitement au
 * référencement. Sa variante `/location-appartement/...` ne verrait pas les
 * maisons ; celle-ci porte tout, et le parseur écarte ce qui n'est pas un
 * logement.
 */
const LIST_URL = `${ORIGIN}/location/provence-alpes-cote-dazur-17/alpes-maritimes-10/nice-13662`;

/** Dix annonces par page ; le stock niçois en compte douze. */
const PER_PAGE = 10;
const MAX_PAGES = 3;

export const ERA_DESCRIPTOR: SourceDescriptor = {
  id: 'era',
  name: 'ERA Immobilier',
  domain: 'eraimmobilier.com',
  kind: 'agencyNetwork',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('agencyNetwork'),
  budget: budgetFor('agencyNetwork', { maxPagesPerRun: MAX_PAGES, maxListingsPerRun: 60 }),
  enabled: true,
  // Franchises indépendantes : le premier contact se fait au téléphone,
  // publié en clair sur chaque annonce (§23).
  manualOnly: true,
  allowedPaths: ['/location/*', '/annonces/*'],
  notes:
    'robots.txt de www vérifié le 2026-09-04 : /louer, /acheter, /estimer et ' +
    'les URLs à paramètres *agence_id=*, *groupe_id=*, *display=*, *agent=*, ' +
    '*language=* sont interdits ; /location/... et /annonces/<id> ne le sont ' +
    'pas, et la page ville figure dans sitemap_silo_location.xml. ' +
    'Angular rendu côté serveur : la page embarque son état de transfert ' +
    '(<script id="ng-state">), qui porte les annonces structurées — ' +
    'descriptif entier, photos, franchise et son téléphone en clair. ' +
    'IMPORTANT : cet état nomme l’API interne api.eraimmobilier.com, dont le ' +
    'robots.txt est Disallow: / — elle n’est JAMAIS appelée (§10). ' +
    'La géolocalisation fournie est celle de l’agence ou le centroïde de la ' +
    'ville, jamais celle du bien : elle est ignorée (§17, §20).',
};

export const eraScraper: Scraper = {
  descriptor: ERA_DESCRIPTOR,

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
        for (const listing of parsed.listings) byRef.set(listing.sourceRef, listing);

        // Le total annoncé par la recherche dit s'il reste une page ; sans
        // lui, on s'arrête plutôt que de tirer une requête à l'aveugle (§30).
        if (parsed.total === null || page * PER_PAGE >= parsed.total) break;
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
    context.log('list.parsed', { listings: listings.length, pages: pagesFetched });

    return {
      sourceId: ERA_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
