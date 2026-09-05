/**
 * Source : Cimiez Boulevard (cimiez-boulevard.fr) — agence niçoise.
 *
 * PREMIÈRE SOURCE HORS PLATEFORME PARTAGÉE. Les six dernières agences ajoutées
 * tenaient en dix-huit lignes chacune grâce à la fabrique Apimo ; celle-ci a
 * son propre site et demande donc un parseur. Sept annonces seulement — mais
 * les mieux renseignées de l'inventaire : charges, quartier, coordonnées GPS,
 * photos, meublé, le tout sur chaque fiche.
 *
 * LE QUARTIER EST DANS L'ADRESSE. La couverture des quartiers plafonne à 16 %
 * sur l'ensemble de l'inventaire ; ici elle est totale, et sans rien deviner :
 * c'est le site qui le nomme (§17, §20).
 *
 * Vérifié le 2026-09-05 : `robots.txt` sans aucune règle, sitemap déclaré,
 * fiches publiques. Sept locations dans les communes cibles.
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
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';
import { parseDetailPage, parseSitemap, type ParsedListingUrl } from './parser.js';

const SITEMAP_URL = 'https://cimiez-boulevard.fr/sitemap.xml';

/** Fiches visitées par passage. Le stock tient en une dizaine : rien à étaler. */
const MAX_DETAILS = 10;

const descriptor: SourceDescriptor = {
  id: 'cimiez-boulevard',
  name: 'Cimiez Boulevard',
  domain: 'cimiez-boulevard.fr',
  kind: 'localAgency',
  method: 'sitemap',
  priority: 2,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', {
    maxPagesPerRun: 1 + MAX_DETAILS,
    maxListingsPerRun: MAX_DETAILS,
  }),
  enabled: true,
  // Petite structure : premier contact téléphonique ou formulaire (§23).
  manualOnly: true,
  allowedPaths: ['/sitemap.xml', '/properties/*'],
  notes:
    'Site propre à l’agence (hors plateforme partagée). Le quartier figure ' +
    'dans l’adresse de chaque fiche, et les charges dans sa description.',
};

export const cimiezBoulevardScraper: Scraper = {
  descriptor,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    let requestCount = 0;
    let pagesFetched = 0;
    let stopReason: StopReason = 'completed';

    // --- 1. Le sitemap découvre toutes les fiches de location -------------
    let entries: ParsedListingUrl[] = [];
    try {
      const response = await context.fetch(SITEMAP_URL);
      requestCount += 1;
      pagesFetched += 1;
      if (response.notModified) {
        context.log('sitemap.not_modified', { url: SITEMAP_URL });
        return {
          sourceId: descriptor.id,
          listings: [],
          requestCount,
          pagesFetched,
          stopReason: 'notModified',
          warnings,
        };
      }
      entries = parseSitemap(response.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Échec du sitemap : ${message}`);
      context.log('sitemap.failed', { error: message });
      return {
        sourceId: descriptor.id,
        listings: [],
        requestCount,
        pagesFetched,
        stopReason: message.includes('429') ? 'rateLimited' : 'tooManyErrors',
        warnings,
      };
    }

    // --- 2. Les communes cibles, et les fiches déjà connues ---------------
    // `NICE_AREA_SLUGS` est un tuple littéral : on le compare comme un
    // ensemble de chaînes, sinon TypeScript exige un slug déjà connu de lui.
    const targetCities = new Set<string>(NICE_AREA_SLUGS);
    const targeted = entries.filter((entry) => targetCities.has(entry.citySlug));
    const confirmedRefs = targeted
      .filter((entry) => context.isKnown(entry.reference))
      .map((entry) => entry.reference);
    const candidates = targeted.filter((entry) => !context.isKnown(entry.reference));

    context.log('sitemap.parsed', {
      total: entries.length,
      targeted: targeted.length,
      known: confirmedRefs.length,
      new: candidates.length,
    });

    // --- 3. Visiter uniquement les nouvelles (§30, §32) -------------------
    for (const entry of candidates.slice(0, MAX_DETAILS)) {
      if (context.shouldStop()) {
        stopReason = 'maxPages';
        break;
      }
      try {
        const response = await context.fetch(entry.canonicalUrl);
        requestCount += 1;
        if (response.notModified) continue;
        pagesFetched += 1;

        const parsed = parseDetailPage(response.body, entry, descriptor.name);
        warnings.push(...parsed.warnings);
        if (parsed.listing !== null) listings.push(parsed.listing);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Échec sur ${entry.canonicalUrl} : ${message}`);
        context.log('page.failed', { url: entry.canonicalUrl, error: message });
        if (message.includes('429')) {
          stopReason = 'rateLimited';
          break;
        }
      }
    }

    return {
      sourceId: descriptor.id,
      listings,
      confirmedRefs,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
