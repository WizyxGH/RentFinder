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
import { parseDetailPage, parseListPage, parsePageCount, withDetail } from './parser.js';

const ORIGIN = 'https://www.dinamyimmobilier.com';
const PAGINATION_URL = `${ORIGIN}/Controleurs/MiseAJour.php`;

/**
 * Types de transaction collectés : 3 = location vide, 5 = location meublée.
 * 4 (saisonnière, tarifée à la nuitée) est volontairement exclue.
 */
const RENTAL_TRANSACTIONS = [5, 3] as const;

/** Sécurité : au-delà, on considère la pagination anormale et on s'arrête. */
const MAX_PAGES_PER_TRANSACTION = 8;

/**
 * Fiches visitées par exécution, réservées aux annonces NOUVELLES (§30, §32).
 *
 * Une fiche pèse 2 Mo — la moitié est une liste des 35 000 communes de France
 * réinjectée dans chaque page. On ne la relit donc jamais pour une annonce
 * déjà connue : ses photos et sa description sont déjà en base.
 */
const MAX_DETAILS_LIVE = 8;
const MAX_DETAILS_BACKFILL = 20;

export const DINAMY_DESCRIPTOR: SourceDescriptor = {
  id: 'dinamy',
  name: 'Dinamy Immobilier',
  domain: 'dinamyimmobilier.com',
  kind: 'localAgency',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', {
    maxPagesPerRun: 14 + MAX_DETAILS_BACKFILL,
    maxListingsPerRun: 60,
  }),
  // Contact PUBLIC, publié par l'agence sur son propre site (relevé le
  // 2026-09-02). Le scanner le signale comme donnée personnelle : c'est une
  // coordonnée professionnelle, déjà publique, et c'est ici la fonctionnalité.
  agencyContact: { phone: '04.89.92.04.50', email: 'info@dinamyimmobilier.com' }, // secret-scan-ignore
  enabled: true,
  // Petite structure : premier contact téléphonique/formulaire (§23).
  manualOnly: true,
  allowedPaths: ['/index.php*', '/Controleurs/MiseAJour.php'],
  notes:
    'Agence Nice (13 rue François Guisol, 06300). Application PHP maison, SSR, ' +
    'sans anti-bot ; pas de robots.txt (404) donc rien d’interdit. La liste ' +
    'porte déjà prix/référence dans le querystring, et la surface + le nombre ' +
    'de pièces sont encodés dans le chemin des photos. Seules les fiches ' +
    'NOUVELLES sont visitées (§30, §32) : elles seules portent la description ' +
    '— qui nomme la rue — et le diaporama complet. Pagination par POST lié à ' +
    'la session PHP. La location SAISONNIÈRE (transactions=4, prix à la ' +
    'nuitée) n’est jamais collectée. Le sitemap est périmé — ne pas s’en servir.',
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

    // --- Fiches : description (donc la RUE) et diaporama complet -----------
    //
    // Réservé aux annonces NOUVELLES : une annonce déjà connue est confirmée
    // sans requête (§32), ses photos et sa description étant déjà en base.
    const listings = [...byRef.values()];
    const confirmedRefs = listings
      .filter((listing) => context.isKnown(listing.sourceRef))
      .map((listing) => listing.sourceRef);
    const candidates = listings.filter((listing) => !context.isKnown(listing.sourceRef));
    const maxDetails = context.mode === 'backfill' ? MAX_DETAILS_BACKFILL : MAX_DETAILS_LIVE;

    context.log('list.parsed', {
      listings: listings.length,
      known: confirmedRefs.length,
      new: candidates.length,
      toFetch: Math.min(candidates.length, maxDetails),
    });

    const enriched = new Map<string, RawListing>();
    for (const listing of candidates.slice(0, maxDetails)) {
      if (context.shouldStop()) {
        stopReason = 'maxPages';
        break;
      }
      try {
        const response = await context.fetch(listing.sourceUrl);
        requestCount += 1;
        if (response.notModified) continue;
        pagesFetched += 1;
        enriched.set(
          listing.sourceRef,
          withDetail(listing, parseDetailPage(response.body, listing.sourceUrl)),
        );
      } catch (error) {
        // Fiche illisible : l'annonce reste collectée avec ce que la liste
        // en disait (§69) — mieux vaut une fiche pauvre que pas de fiche.
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec de la fiche ${listing.sourceRef} : ${message}`);
        context.log('detail.failed', { ref: listing.sourceRef, error: message });
        if (message.includes('429')) {
          stopReason = 'rateLimited';
          break;
        }
      }
    }

    return {
      sourceId: DINAMY_DESCRIPTOR.id,
      listings: listings.map((listing) => enriched.get(listing.sourceRef) ?? listing),
      confirmedRefs,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
