/**
 * Source : Foncia (réseau d'agences / administrateur de biens).
 *
 * POURQUOI CETTE SOURCE — voir `docs/sources.md` pour l'étude complète.
 *
 *   - Premier administrateur de biens de France : gros volume de gestion
 *     locative en propre, dont une partie n'apparaît pas ailleurs (§3).
 *   - Pages `/location/{ville}/appartement` en SSR, non interdites par le
 *     robots.txt (vérifié le 2026-08-15) ; ~60 annonces par page — Nice
 *     entier en UNE requête (§6).
 *   - Le titre des cartes contient l'ADRESSE COMPLÈTE du bien : signal de
 *     dédoublonnage très fort (§14).
 *
 * La pagination à paramètres étant interdite par le robots.txt, seule la
 * première page est lue — elle suffit largement en mode live comme en
 * backfill.
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
import { parseAgencies, parseAgencyByReference, parseSearchPage } from './parser.js';

/** Une page = tout Nice (appartements). */
const ENTRY_URL = 'https://fr.foncia.com/location/nice-06000/appartement';

/**
 * Page des agences de la ville : le SEUL endroit où Foncia publie un téléphone
 * et une adresse e-mail. Les fiches, elles, n'offrent qu'un formulaire web.
 * Une requête couvre toutes les agences de Nice.
 */
const AGENCIES_URL = 'https://fr.foncia.com/agence-immobiliere/agences-immo/nice-06_location';

export const FONCIA_DESCRIPTOR: SourceDescriptor = {
  id: 'foncia',
  name: 'Foncia',
  domain: 'fr.foncia.com',
  kind: 'agencyNetwork',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('agencyNetwork'),
  budget: budgetFor('agencyNetwork', {
    maxPagesPerRun: 1,
    delayBetweenRequestsMs: 3_000,
  }),
  enabled: true,
  // Le formulaire de la fiche est le canal prévu (§23).
  manualOnly: true,
  allowedPaths: ['/location/*'],
  notes:
    'robots.txt vérifié le 2026-08-15 : URLs à paramètres interdites (sauf ' +
    '?datemaj), pages /location/{ville}/{type} autorisées. SSR Angular : ' +
    'ancrage sur les classes foncia-card-*, jamais sur les attributs générés ' +
    '_ngcontent-*. Une page ~60 annonces couvre Nice — pas de pagination.',
};

export const fonciaScraper: Scraper = {
  descriptor: FONCIA_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    let pagesFetched = 0;
    let requestCount = 0;
    let stopReason: StopReason = 'completed';

    try {
      const response = await context.fetch(ENTRY_URL);
      requestCount += 1;

      if (response.notModified) {
        context.log('page.not_modified', { url: ENTRY_URL });
        stopReason = 'notModified';
      } else {
        pagesFetched += 1;
        const parsed = parseSearchPage(response.body, ENTRY_URL);
        warnings.push(...parsed.warnings);

        // Coordonnées des agences : une requête pour toute la ville, et le
        // formulaire web devient un e-mail direct. L'échec n'est pas bloquant —
        // on retombe simplement sur le formulaire (§69).
        let agencies = new Map<string, { name: string; phone?: string; email?: string }>();
        const agencyOf = parseAgencyByReference(response.body);
        try {
          const page = await context.fetch(AGENCIES_URL);
          requestCount += 1;
          if (!page.notModified) agencies = parseAgencies(page.body);
          context.log('agencies.parsed', { agencies: agencies.size });
        } catch (error) {
          context.log('agencies.failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        let known = 0;
        for (const listing of parsed.listings) {
          if (context.isKnown(listing.sourceRef)) known += 1;
          const agency = agencies.get(agencyOf.get(listing.sourceRef) ?? '');
          listings.push(
            agency === undefined
              ? listing
              : {
                  ...listing,
                  agencyName: agency.name,
                  ...(agency.phone !== undefined ? { phoneText: agency.phone } : {}),
                  ...(agency.email !== undefined ? { emailText: agency.email } : {}),
                },
          );
        }
        context.log('page.parsed', {
          url: ENTRY_URL,
          found: parsed.listings.length,
          known,
        });
      }
    } catch (error) {
      // §69 : échec propre, les autres sources continuent.
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Échec sur ${ENTRY_URL} : ${message}`);
      context.log('page.failed', { url: ENTRY_URL, error: message });
      if (message.includes('429')) {
        stopReason = 'rateLimited';
      } else if (message.includes('refusé')) {
        stopReason = 'blocked';
      } else {
        stopReason = 'tooManyErrors';
      }
    }

    return {
      sourceId: FONCIA_DESCRIPTOR.id,
      listings,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
