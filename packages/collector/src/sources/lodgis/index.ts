/**
 * Source : Lodgis (lodgis.com) — voir l'étude dans `parser.ts`. Page catégorie
 * du département 06 en SSR : une requête, aucune visite de fiche (§30).
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

/** Catégorie « location meublée » filtrée sur le département 06 (`france-6`). */
const LIST_URL =
  'https://www.lodgis.com/fr/france,location-meublee/location-meuble-france-6_20242.cat.html';

export const LODGIS_DESCRIPTOR: SourceDescriptor = {
  id: 'lodgis',
  name: 'Lodgis',
  domain: 'lodgis.com',
  kind: 'agencyNetwork',
  method: 'html',
  // Même priorité que les autres sources d'agences (2). En 3, elle était
  // systématiquement évincée : le planificateur trie par priorité croissante et
  // les sources de priorité 2, toujours éligibles, remplissaient les 6 places.
  priority: 2,
  schedule: scheduleFor('agencyNetwork'),
  budget: budgetFor('agencyNetwork', { maxPagesPerRun: 1, maxListingsPerRun: 30 }),
  enabled: true,
  // Premier contact via le formulaire du site, à la main de l'utilisateur (§23).
  manualOnly: true,
  allowedPaths: ['/fr/france,location-meublee/*'],
  notes:
    'Groupe Emeria, spécialiste de la location MEUBLÉE moyen/long terme. ' +
    'robots.txt vérifié le 2026-08-26 : chemins d’annonces autorisés ; on ' +
    'n’appelle jamais /ajax*, ?surf=, ?cur= ni /impression/ (interdits). Page ' +
    'catégorie SSR `france-6`, cartes div.card__appart. Stock niçois haut de ' +
    'gamme (~1 600-2 100 €) : la plupart sortiront du budget au scoring (§53).',
};

export const lodgisScraper: Scraper = {
  descriptor: LODGIS_DESCRIPTOR,

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
          sourceId: LODGIS_DESCRIPTOR.id,
          listings: [],
          requestCount,
          pagesFetched,
          stopReason: 'notModified',
          warnings,
        };
      }
      pagesFetched += 1;
      const parsed = parseListPage(response.body, LIST_URL, LODGIS_DESCRIPTOR.name);
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

    context.log('list.parsed', { listings: listings.length });
    return {
      sourceId: LODGIS_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
