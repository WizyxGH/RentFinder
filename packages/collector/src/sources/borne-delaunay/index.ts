/**
 * Source : Borne & Delaunay — voir l'étude dans `parser.ts`.
 *
 * Agence niçoise (gestion locative, syndic), demandée explicitement. Petit
 * stock — trois locations au relevé du 2026-09-04 — mais c'est le propos :
 * réduire la dépendance aux alertes e-mail des portails, dont proviennent
 * aujourd'hui trois quarts de l'inventaire et qui ne publient aucune adresse.
 *
 * Une seule requête : la page de locations porte tout (§30).
 */

import type {
  Scraper,
  ScrapeContext,
  ScrapeResult,
  SourceDescriptor,
  StopReason,
} from '@rentfinder/shared';
import { budgetFor, scheduleFor } from '../../core/budgets.js';
import { parseListPage } from './parser.js';

const LIST_URL = 'https://www.borne-delaunay.com/immobilier/louer-13';

export const BORNE_DELAUNAY_DESCRIPTOR: SourceDescriptor = {
  id: 'borne-delaunay',
  name: 'Borne & Delaunay',
  domain: 'borne-delaunay.com',
  kind: 'localAgency',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', { maxPagesPerRun: 1, maxListingsPerRun: 40 }),
  enabled: true,
  // Petite structure : premier contact par téléphone ou formulaire (§23).
  manualOnly: true,
  allowedPaths: ['/immobilier/louer-*', '/location-*'],
  notes:
    'Agence Nice (gestion locative, syndic). robots.txt vérifié le 2026-09-04 : ' +
    'seul /contacts/success_landing est interdit. Site Rails maison, rendu côté ' +
    'serveur, sans anti-bot. La page /immobilier/louer-13 porte toutes les ' +
    'locations, cartes complètes (titre, ville, CP, type, pièces, surface, ' +
    'loyer, photo) : une requête, aucune visite de fiche (§30).',
};

export const borneDelaunayScraper: Scraper = {
  descriptor: BORNE_DELAUNAY_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    let requestCount = 0;
    let pagesFetched = 0;

    try {
      const response = await context.fetch(LIST_URL);
      requestCount += 1;
      if (response.notModified) {
        return {
          sourceId: BORNE_DELAUNAY_DESCRIPTOR.id,
          listings: [],
          requestCount,
          pagesFetched,
          stopReason: 'notModified',
          warnings: [],
        };
      }
      pagesFetched += 1;

      const parsed = parseListPage(response.body, LIST_URL, BORNE_DELAUNAY_DESCRIPTOR.name);
      context.log('list.parsed', { listings: parsed.listings.length });
      return {
        sourceId: BORNE_DELAUNAY_DESCRIPTOR.id,
        listings: parsed.listings,
        requestCount,
        pagesFetched,
        stopReason: 'completed',
        warnings: [...parsed.warnings],
      };
    } catch (error) {
      // §69 : échec propre, les autres sources continuent.
      const message = error instanceof Error ? error.message : String(error);
      context.log('list.failed', { url: LIST_URL, error: message });
      const stopReason: StopReason = message.includes('429')
        ? 'rateLimited'
        : message.includes('refusé')
          ? 'blocked'
          : 'tooManyErrors';
      return {
        sourceId: BORNE_DELAUNAY_DESCRIPTOR.id,
        listings: [],
        requestCount,
        pagesFetched,
        stopReason,
        warnings: [`Échec de la liste : ${message}`],
      };
    }
  },
};
