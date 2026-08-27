/**
 * Source : Dinamy Immobilier — voir l'étude dans `parser.ts`.
 *
 * La pagination n'est PAS accessible en GET (`&page=2` rend la même page) :
 * le site la sert par un POST sur `Controleurs/MiseAJour.php`, lié à la SESSION
 * PHP. On pose donc d'abord le cookie avec la page de liste, puis on redemande
 * les pages suivantes en le renvoyant. Tout passe par `context.fetch`, donc par
 * le client HTTP du projet : quotas, backoff et arrêt sur 429 restent appliqués
 * (§10, §30).
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
import { parseListPage, parsePageCount } from './parser.js';

const ORIGIN = 'https://www.dinamyimmobilier.com';
const PAGINATION_URL = `${ORIGIN}/Controleurs/MiseAJour.php`;

/**
 * Types de transaction collectés : 3 = location vide, 5 = location meublée.
 * 4 (saisonnière, tarifée à la nuitée) est volontairement exclue.
 */
const RENTAL_TRANSACTIONS = [5, 3] as const;

/** Sécurité : au-delà, on considère la pagination anormale et on s'arrête. */
const MAX_PAGES_PER_TRANSACTION = 8;

export const DINAMY_DESCRIPTOR: SourceDescriptor = {
  id: 'dinamy',
  name: 'Dinamy Immobilier',
  domain: 'dinamyimmobilier.com',
  kind: 'localAgency',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', { maxPagesPerRun: 14, maxListingsPerRun: 60 }),
  enabled: true,
  // Petite structure : premier contact téléphonique/formulaire (§23).
  manualOnly: true,
  allowedPaths: ['/index.php*', '/Controleurs/MiseAJour.php'],
  notes:
    'Agence Nice (13 rue François Guisol, 06300). Application PHP maison, SSR, ' +
    'sans anti-bot ; pas de robots.txt (404) donc rien d’interdit. La liste ' +
    'porte déjà prix/référence dans le querystring, et la surface + le nombre ' +
    'de pièces sont encodés dans le chemin des photos : aucune visite de fiche ' +
    '(§30). Pagination par POST lié à la session PHP. La location SAISONNIÈRE ' +
    '(transactions=4, prix à la nuitée) n’est jamais collectée. Le sitemap est ' +
    'périmé — ne pas s’en servir.',
};

/** Valeur du cookie de session à renvoyer, extraite d'un en-tête Set-Cookie. */
function sessionCookie(headers: Record<string, string>): string | null {
  const raw = headers['set-cookie'];
  if (raw === undefined) return null;
  return /PHPSESSID=[^;,\s]+/i.exec(raw)?.[0] ?? null;
}

export const dinamyScraper: Scraper = {
  descriptor: DINAMY_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const byRef = new Map<string, RawListing>();
    const warnings: string[] = [];
    let requestCount = 0;
    let pagesFetched = 0;
    let stopReason: StopReason = 'completed';

    for (const transaction of RENTAL_TRANSACTIONS) {
      if (context.shouldStop()) {
        stopReason = 'maxPages';
        break;
      }
      const listUrl = `${ORIGIN}/index.php?transactions=${transaction}`;

      let cookie: string | null;
      let pageCount: number;
      try {
        const first = await context.fetch(listUrl);
        requestCount += 1;
        if (first.notModified) continue;
        pagesFetched += 1;

        for (const listing of parseListPage(first.body, listUrl, DINAMY_DESCRIPTOR.name)) {
          byRef.set(listing.sourceRef, listing);
        }
        cookie = sessionCookie(first.headers);
        pageCount = Math.min(parsePageCount(first.body), MAX_PAGES_PER_TRANSACTION);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec de la liste (transactions=${transaction}) : ${message}`);
        context.log('list.failed', { url: listUrl, error: message });
        if (message.includes('429')) {
          stopReason = 'rateLimited';
          break;
        }
        continue;
      }

      // Sans cookie de session, la pagination renverrait la première page en
      // boucle : on s'arrête à ce qui est déjà lu plutôt que de tourner à vide.
      if (cookie === null) {
        if (pageCount > 1) {
          warnings.push(`Pas de session : seules les 6 premières annonces (t=${transaction})`);
        }
        continue;
      }

      for (let page = 2; page <= pageCount; page += 1) {
        if (context.shouldStop()) {
          stopReason = 'maxPages';
          break;
        }
        try {
          const response = await context.fetch(PAGINATION_URL, {
            method: 'POST',
            headers: {
              cookie,
              'content-type': 'application/x-www-form-urlencoded',
              referer: listUrl,
            },
            body: `liste=pageCourante&page=${page}`,
          });
          requestCount += 1;
          pagesFetched += 1;
          const found = parseListPage(response.body, listUrl, DINAMY_DESCRIPTOR.name);
          if (found.length === 0) break;
          for (const listing of found) byRef.set(listing.sourceRef, listing);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Échec page ${page} (t=${transaction}) : ${message}`);
          context.log('page.failed', { page, transaction, error: message });
          if (message.includes('429')) {
            stopReason = 'rateLimited';
            break;
          }
          break;
        }
      }
    }

    const listings = [...byRef.values()];
    context.log('list.parsed', { listings: listings.length });
    return {
      sourceId: DINAMY_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
