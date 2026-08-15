/**
 * Source : BEP Logement — première AGENCE LOCALE du projet (§3).
 *
 * POURQUOI CETTE SOURCE — voir `docs/sources.md` pour l'étude complète.
 *
 *   - Agence des Alpes-Maritimes (Antibes/Nice) demandée explicitement ;
 *     annonces de particuliers et de gestion propre, dont une partie n'apparaît
 *     sur aucun grand portail — exactement la valeur visée au §3.
 *   - `robots.txt` (vérifié le 2026-08-15) : totalement permissif (seul
 *     `/app_dev.php` est interdit) et déclare un sitemap — méthode d'accès
 *     prévue pour l'automatisation, donc adoptée (§6).
 *   - Les fiches embarquent un JSON-LD schema.org complet : téléphone et
 *     e-mail d'agence publiés volontairement (§21), date de publication,
 *     surface, pièces, adresse.
 *
 * FONCTIONNEMENT (mode sitemap, voir `parser.ts`) :
 *   1. lire le sitemap (2 requêtes, mises en cache ETag) ;
 *   2. en extraire les fiches de location des communes cibles + `lastmod` ;
 *   3. ne visiter QUE les fiches inconnues, les plus récentes d'abord ;
 *   4. confirmer les fiches connues encore listées via `confirmedRefs`,
 *      sans les re-télécharger (§30, §32).
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
import { parseDetailPage, parseSitemap, parseSitemapIndex, type SitemapEntry } from './parser.js';

const SITEMAP_INDEX_URL = 'https://bep-logement.com/sitemap.xml';

/**
 * Communes retenues : Nice et sa continuité urbaine directe. L'agence couvre
 * aussi Antibes/Biot, trop excentrées pour les critères actuels (§2) — les
 * collecter coûterait une requête par fiche pour des annonces hors critères.
 * Étendre cette liste suffit à élargir la couverture.
 */
const TARGET_CITY_SLUGS = new Set([
  'nice',
  'saint-laurent-du-var',
  'cagnes-sur-mer',
  'villefranche-sur-mer',
  'beaulieu-sur-mer',
  'la-trinite',
  'saint-andre-de-la-roche',
  'drap',
  'falicon',
]);

/** Fiches visitées au maximum par run : le sitemap bouge peu, inutile de plus. */
const MAX_DETAILS_LIVE = 8;
const MAX_DETAILS_BACKFILL = 20;

export const BEP_DESCRIPTOR: SourceDescriptor = {
  id: 'bep',
  name: 'BEP Logement',
  domain: 'bep-logement.com',
  kind: 'localAgency',
  method: 'sitemap',
  priority: 2,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', {
    // 2 requêtes de sitemap + les fiches nouvelles. « Page » = requête ici.
    maxPagesPerRun: 2 + MAX_DETAILS_BACKFILL,
    maxListingsPerRun: MAX_DETAILS_BACKFILL,
  }),
  enabled: true,
  // Petite structure : premier contact téléphonique ou par formulaire,
  // l'automatisation n'est pas appropriée (§23).
  manualOnly: true,
  allowedPaths: ['/sitemap*.xml', '/fr/propriete/location*'],
  notes:
    'robots.txt vérifié le 2026-08-15 : permissif (seul /app_dev.php interdit), ' +
    'sitemap déclaré. Méthode sitemap : la liste HTML est en lazy-load JS, le ' +
    'sitemap donne toutes les fiches + lastmod. Plateforme Cello/Apimo : si une ' +
    "autre agence sur cette plateforme est ajoutée, extraire l'adaptateur (§47).",
};

export const bepScraper: Scraper = {
  descriptor: BEP_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    let requestCount = 0;
    let pagesFetched = 0;
    let stopReason: StopReason = 'completed';

    // --- 1. Sitemap : découvrir toutes les fiches de location ---------------
    let entries: SitemapEntry[] = [];
    try {
      const index = await context.fetch(SITEMAP_INDEX_URL);
      requestCount += 1;
      pagesFetched += 1;

      // Un index inchangé (304) signifie qu'aucune fiche n'a bougé : les
      // annonces connues restent confirmées, rien d'autre à faire.
      if (index.notModified) {
        context.log('sitemap.not_modified', { url: SITEMAP_INDEX_URL });
        return {
          sourceId: BEP_DESCRIPTOR.id,
          listings: [],
          requestCount,
          pagesFetched,
          stopReason: 'notModified',
          warnings,
        };
      }

      // L'index liste les sous-sitemaps ; le site n'en a qu'un, mais on en
      // accepte jusqu'à 3 par prudence.
      const children = parseSitemapIndex(index.body).slice(0, 3);
      const sitemapBodies = children.length > 0 ? [] : [index.body]; // certains sites servent l'urlset directement
      for (const childUrl of children) {
        const child = await context.fetch(childUrl);
        requestCount += 1;
        pagesFetched += 1;
        if (!child.notModified) sitemapBodies.push(child.body);
      }

      entries = sitemapBodies.flatMap((body) => parseSitemap(body));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Échec du sitemap : ${message}`);
      context.log('sitemap.failed', { error: message });
      return {
        sourceId: BEP_DESCRIPTOR.id,
        listings: [],
        requestCount,
        pagesFetched,
        stopReason: message.includes('429') ? 'rateLimited' : 'tooManyErrors',
        warnings,
      };
    }

    // --- 2. Filtrer et prioriser -------------------------------------------
    const targeted = entries.filter((entry) => TARGET_CITY_SLUGS.has(entry.url.citySlug));

    // Les fiches connues encore listées sont confirmées sans requête (§32).
    const confirmedRefs = targeted
      .filter((entry) => context.isKnown(entry.url.reference))
      .map((entry) => entry.url.reference);

    // Les inconnues, les plus récentes d'abord (lastmod absent = en dernier).
    const candidates = targeted
      .filter((entry) => !context.isKnown(entry.url.reference))
      .sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? ''));

    const maxDetails = context.mode === 'backfill' ? MAX_DETAILS_BACKFILL : MAX_DETAILS_LIVE;

    context.log('sitemap.parsed', {
      total: entries.length,
      targeted: targeted.length,
      known: confirmedRefs.length,
      new: candidates.length,
      toFetch: Math.min(candidates.length, maxDetails),
    });

    // --- 3. Visiter uniquement les fiches nouvelles -------------------------
    for (const entry of candidates.slice(0, maxDetails)) {
      if (context.shouldStop()) {
        stopReason = 'maxPages';
        break;
      }

      try {
        const response = await context.fetch(entry.url.canonicalUrl);
        requestCount += 1;
        if (response.notModified) continue;
        pagesFetched += 1;

        const parsed = parseDetailPage(response.body, entry.url.canonicalUrl);
        warnings.push(...parsed.warnings);
        if (parsed.listing !== null) listings.push(parsed.listing);
      } catch (error) {
        // §69 : une fiche en échec n'abat pas la source ; un refus global oui.
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec sur ${entry.url.canonicalUrl} : ${message}`);
        context.log('page.failed', { url: entry.url.canonicalUrl, error: message });
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
      sourceId: BEP_DESCRIPTOR.id,
      listings,
      confirmedRefs,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
