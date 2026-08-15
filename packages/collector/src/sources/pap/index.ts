/**
 * Source : PAP — De Particulier À Particulier (portail).
 *
 * POURQUOI CETTE SOURCE — voir `docs/sources.md` pour l'étude complète.
 *
 *   - Bailleurs PARTICULIERS : contact direct, sans agence ni frais d'agence.
 *     Complément exact des réseaux déjà couverts (Laforêt, Orpi).
 *   - Chemin d'accès CONFORME (§6, §10) : les pages de liste par ville sont
 *     déclarées dans le sitemap officiel `liste_annonces.xml` et ne figurent
 *     pas dans les Disallow — c'est la méthode prévue par le site. La
 *     recherche interne (`/recherche/…`), elle, est interdite et jamais
 *     utilisée.
 *   - Les cartes de liste contiennent tout (prix, pièces, chambres, surface,
 *     CP, description, DPE) : AUCUNE fiche n'est visitée (§6, §30).
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
 * Points d'entrée, tous déclarés dans le sitemap officiel :
 *   - toutes les locations à Nice (studios et maisons comprises) ;
 *   - la déclinaison studios, cœur de cible du budget ≤ 700 €.
 * La pagination suffixe le chemin : `…-g8979-2`.
 */
const ENTRY_POINTS = [
  'https://www.pap.fr/annonce/locations-nice-06-g8979',
  'https://www.pap.fr/annonce/locations-nice-06-g8979-studio',
] as const;

export const PAP_DESCRIPTOR: SourceDescriptor = {
  id: 'pap',
  name: 'PAP',
  domain: 'pap.fr',
  kind: 'portal',
  method: 'html',
  priority: 1,
  schedule: scheduleFor('portal', { baseIntervalMinutes: 30 }),
  budget: budgetFor('portal', {
    maxPagesPerRun: 4,
    delayBetweenRequestsMs: 3_000,
  }),
  /**
   * DÉSACTIVÉE le 2026-08-15 — voir docs/sources.md.
   *
   * Le robots.txt autorise ces pages et le sitemap les déclare, MAIS le WAF
   * du site répond 403 aux clients HTTP non-navigateurs, y compris identifiés
   * honnêtement (vérifié : même UA, même IP → curl 200, fetch Node 403 :
   * filtrage sur l'empreinte du client). Imiter l'empreinte d'un navigateur
   * serait un contournement (§10) : on n'insiste pas. Le scraper et ses tests
   * restent prêts si la politique du site évolue.
   */
  enabled: false,
  // La messagerie PAP est le canal prévu ; l'automatiser sans supervision
  // n'est pas approprié (§23).
  manualOnly: true,
  allowedPaths: ['/annonce/locations-*'],
  notes:
    'robots.txt vérifié le 2026-08-15 : /*?* et /recherche/* interdits, pages ' +
    '/annonce/locations-{ville}-g{id} autorisées ET déclarées dans le sitemap ' +
    'liste_annonces.xml — mais le WAF refuse les clients non-navigateurs ' +
    '(403 sur fetch Node, 200 sur curl, même UA/IP). Source désactivée sans ' +
    'contournement (§10).',
};

/** §9 : au-delà de ce ratio de déjà-vu sur une page, on cesse de paginer. */
const KNOWN_RATIO_STOP = 0.8;

export const papScraper: Scraper = {
  descriptor: PAP_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    const seenRefs = new Set<string>();
    let pagesFetched = 0;
    let requestCount = 0;
    let stopReason: StopReason = 'completed';

    // Live : première page de chaque point d'entrée (les nouveautés remontent
    // en tête) ; backfill : une page de plus (§8).
    const maxPagesPerEntry = context.mode === 'backfill' ? 2 : 1;

    outer: for (const entryUrl of ENTRY_POINTS) {
      for (let page = 1; page <= maxPagesPerEntry; page += 1) {
        if (context.shouldStop()) {
          stopReason = 'maxPages';
          break outer;
        }

        const url = page === 1 ? entryUrl : `${entryUrl}-${page}`;

        let html: string;
        try {
          const response = await context.fetch(url);
          requestCount += 1;

          if (response.notModified) {
            context.log('page.not_modified', { url });
            break;
          }
          html = response.body;
        } catch (error) {
          // §69 : l'échec d'une page n'abat pas la source ; un refus global si.
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Échec sur ${url} : ${message}`);
          context.log('page.failed', { url, error: message });
          if (message.includes('429')) {
            stopReason = 'rateLimited';
            break outer;
          }
          if (message.includes('refusé')) {
            stopReason = 'blocked';
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

        if (listings.length >= PAP_DESCRIPTOR.budget.maxListingsPerRun) {
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
      sourceId: PAP_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
