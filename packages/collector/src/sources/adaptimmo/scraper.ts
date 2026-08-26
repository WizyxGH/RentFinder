/**
 * Fabrique de scrapers pour les agences sur plateforme AdaptImmo/Ubiflow
 * (§5, §47). Ajouter une agence = une entrée `makeAdaptImmoScraper({...})`.
 *
 * Méthode : une page de liste filtrée sur la location (`liste.htm?tdp=5`), puis
 * la visite des seules fiches NOUVELLES — la liste ne porte ni surface ni
 * nombre de pièces (§30). Les annonces déjà connues sont confirmées sans aucune
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
import { parseDetailPage, parseListPage, toRawListing } from './parser.js';

export interface AdaptImmoConfig {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  /** Page de résultats filtrée sur la location (`tdp=5`). */
  readonly listUrl: string;
  readonly priority?: number;
  /** Nombre maximum de fiches visitées par exécution. */
  readonly maxDetailsLive?: number;
  readonly maxDetailsBackfill?: number;
}

export function makeAdaptImmoDescriptor(config: AdaptImmoConfig): SourceDescriptor {
  const maxBackfill = config.maxDetailsBackfill ?? 20;
  return {
    id: config.id,
    name: config.name,
    domain: config.domain,
    kind: 'localAgency',
    method: 'html',
    priority: config.priority ?? 2,
    schedule: scheduleFor('localAgency'),
    budget: budgetFor('localAgency', {
      maxPagesPerRun: 1 + maxBackfill,
      maxListingsPerRun: maxBackfill,
    }),
    enabled: true,
    // Petite structure : premier contact téléphonique/formulaire (§23).
    manualOnly: true,
    allowedPaths: ['/fr/liste.htm*', '/fr/detail.htm*'],
    notes:
      `Plateforme AdaptImmo/Ubiflow (adaptateur générique, §47). Pages en ` +
      `windows-1252 déclaré en <meta> seulement — le client HTTP le gère. Les ` +
      `rubans « Vendu/Loué » sont pré-rendus en dur : le statut réel vient de ` +
      `data-ribbon-prop="Vendu" et l'opération de costpermonth[data-ope]=2. ` +
      `Surface et pièces ne sont que sur la fiche, d'où une visite par annonce ` +
      `nouvelle.`,
  };
}

export function makeAdaptImmoScraper(config: AdaptImmoConfig): Scraper {
  const descriptor = makeAdaptImmoDescriptor(config);
  const maxLive = config.maxDetailsLive ?? 10;
  const maxBackfill = config.maxDetailsBackfill ?? 20;

  return {
    descriptor,

    async run(context: ScrapeContext): Promise<ScrapeResult> {
      const listings: RawListing[] = [];
      const warnings: string[] = [];
      let requestCount = 0;
      let pagesFetched = 0;
      let stopReason: StopReason = 'completed';

      // --- 1. Liste des locations disponibles ------------------------------
      let cards;
      try {
        const response = await context.fetch(config.listUrl);
        requestCount += 1;
        if (response.notModified) {
          return {
            sourceId: config.id,
            listings: [],
            requestCount,
            pagesFetched,
            stopReason: 'notModified',
            warnings,
          };
        }
        pagesFetched += 1;
        cards = parseListPage(response.body, config.listUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec de la liste : ${message}`);
        context.log('list.failed', { url: config.listUrl, error: message });
        return {
          sourceId: config.id,
          listings: [],
          requestCount,
          pagesFetched,
          stopReason: message.includes('429') ? 'rateLimited' : 'tooManyErrors',
          warnings,
        };
      }

      // --- 2. Connues confirmées sans requête, nouvelles à visiter (§32) ----
      const confirmedRefs = cards
        .filter((card) => context.isKnown(card.reference))
        .map((card) => card.reference);
      const candidates = cards.filter((card) => !context.isKnown(card.reference));
      const maxDetails = context.mode === 'backfill' ? maxBackfill : maxLive;

      context.log('list.parsed', {
        total: cards.length,
        known: confirmedRefs.length,
        new: candidates.length,
        toFetch: Math.min(candidates.length, maxDetails),
      });

      // --- 3. Fiches : surface, pièces, code postal ------------------------
      for (const card of candidates.slice(0, maxDetails)) {
        if (context.shouldStop()) {
          stopReason = 'maxPages';
          break;
        }
        try {
          const response = await context.fetch(card.sourceUrl);
          requestCount += 1;
          if (response.notModified) continue;
          pagesFetched += 1;
          listings.push(toRawListing(card, parseDetailPage(response.body), config.name));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Échec sur ${card.sourceUrl} : ${message}`);
          context.log('page.failed', { url: card.sourceUrl, error: message });
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
        sourceId: config.id,
        listings,
        confirmedRefs,
        requestCount,
        pagesFetched,
        stopReason,
        warnings,
      };
    },
  };
}
