/**
 * Source : FNAIM — voir l'étude dans `parser.ts` et la fiche de
 * `docs/sources.md`.
 *
 * C'est la réponse à « réduire la dépendance aux alertes e-mail de SeLoger » :
 * 193 agences niçoises publient sur ce portail, dont beaucoup n'ont pas de
 * site scrapable, et chaque carte donne le nom de l'agence ET son téléphone.
 *
 * LE TRI PAR PRIX CROISSANT EST LA CLÉ DU BUDGET DE REQUÊTES. La FNAIM classe
 * les résultats du moins cher au plus cher : les premières pages portent donc
 * exactement la tranche recherchée. Trois pages — soixante-quinze annonces —
 * couvraient tout le stock sous 900 € au relevé du 2026-09-04, là où le stock
 * entier en demanderait sept (§30).
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
import { listUrl, parseListPage } from './parser.js';

/** Vingt-cinq annonces par page, du moins cher au plus cher. */
const MAX_PAGES = 3;

export const FNAIM_DESCRIPTOR: SourceDescriptor = {
  id: 'fnaim',
  name: 'FNAIM',
  domain: 'fnaim.fr',
  kind: 'portal',
  method: 'html',
  // Le portail d'une fédération, pas un agrégateur commercial : l'annonce
  // identifie l'agence qui la publie et donne de quoi l'appeler.
  priority: 2,
  schedule: scheduleFor('portal'),
  budget: budgetFor('portal', { maxPagesPerRun: MAX_PAGES, maxListingsPerRun: 100 }),
  enabled: true,
  // Petites agences : premier contact par téléphone (§23).
  manualOnly: true,
  allowedPaths: ['/liste-annonces-immobilieres/*', '/annonce-immobiliere/*'],
  notes:
    'robots.txt vérifié le 2026-09-04 : seuls /include/, /cms/, l’espace ' +
    'adhérent et quelques paramètres d’affichage sont interdits — les listes ' +
    'et les fiches sont autorisées. Pages entièrement rendues côté serveur, ' +
    '25 annonces par page, pagination SEO `…-nice-06000-page-N.htm` SANS ' +
    'querystring (celle du gabarit en porte une, on ne l’utilise pas). ' +
    'La recherche par 06000 remonte aussi les 06100/06200/06300 : une seule ' +
    'URL couvre Nice. Résultats triés par loyer croissant, ce qui met la ' +
    'tranche recherchée sur les premières pages. Les cartes portent le nom de ' +
    'l’agence, son téléphone en clair, et une description qui contient ' +
    'souvent l’adresse en toutes lettres (§14, §20).',
};

export const fnaimScraper: Scraper = {
  descriptor: FNAIM_DESCRIPTOR,

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
      const url = listUrl(page);
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
      pages: pagesFetched,
      known: listings.filter((listing) => context.isKnown(listing.sourceRef)).length,
    });

    return {
      sourceId: FNAIM_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
