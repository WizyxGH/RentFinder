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
import { enrichNewListings } from '../shared/enrich.js';
import {
  parseAgencies,
  parseAgencyByReference,
  parseDetail,
  parseSearchPage,
  parseWithdrawn,
} from './parser.js';

/** Une page = tout Nice (appartements). */
const ENTRY_URL = 'https://fr.foncia.com/location/nice-06000/appartement';

/**
 * Page des agences de la ville : le SEUL endroit où Foncia publie un téléphone
 * et une adresse e-mail. Les fiches, elles, n'offrent qu'un formulaire web.
 * Une requête couvre toutes les agences de Nice.
 */
const AGENCIES_URL = 'https://fr.foncia.com/agence-immobiliere/agences-immo/nice-06_location';

/**
 * Fiches vérifiées par exécution parmi les annonces disparues de la liste.
 *
 * Une disparition ne dit rien à elle seule : l'annonce peut être louée comme
 * simplement sortie de la première page. La fiche, elle, tranche — Foncia y
 * remplace le bien par « Cette annonce n'est plus disponible » et bascule son
 * `status` à `deleted`. Cinq vérifications par exécution suffisent à résorber
 * le doute sans faire exploser le budget de requêtes (§30, §32).
 */
const MAX_WITHDRAWN_CHECKS = 5;

/**
 * Fiches visitées par exécution, pour les annonces NOUVELLES seulement.
 *
 * La carte ne donne qu'un fragment de description — 99 caractères de moyenne
 * sur les dix-huit annonces relevées le 2026-09-04, soit une demi-phrase. La
 * fiche porte le texte complet. Dix visites par cycle : le stock niçois de
 * Foncia tourne autour de quinze annonces, une première collecte est donc
 * couverte en deux passages (§30).
 */
const MAX_DETAILS = 10;

/** Les annonces collectées sont toutes des appartements niçois. */
const listingUrl = (reference: string): string =>
  `https://fr.foncia.com/location/nice-06/appartement/${reference}.htm`;

export const FONCIA_DESCRIPTOR: SourceDescriptor = {
  id: 'foncia',
  name: 'Foncia',
  domain: 'fr.foncia.com',
  kind: 'agencyNetwork',
  method: 'html',
  priority: 2,
  schedule: scheduleFor('agencyNetwork'),
  budget: budgetFor('agencyNetwork', {
    maxPagesPerRun: 1 + MAX_WITHDRAWN_CHECKS + MAX_DETAILS,
    delayBetweenRequestsMs: 3_000,
  }),
  enabled: true,
  // Le formulaire de la fiche est le canal prévu (§23).
  manualOnly: true,
  allowedPaths: ['/location/*', '/agence-immobiliere/*'],
  notes:
    'robots.txt vérifié le 2026-08-15 : URLs à paramètres interdites (sauf ' +
    '?datemaj), pages /location/{ville}/{type} autorisées. SSR Angular : ' +
    'ancrage sur les classes foncia-card-*, jamais sur les attributs générés ' +
    '_ngcontent-*. Une page ~60 annonces couvre Nice — pas de pagination. ' +
    'Les annonces DISPARUES de la liste voient leur fiche vérifiée (5 par ' +
    'run) : Foncia y affiche « Cette annonce n’est plus disponible » et passe ' +
    'le statut de l’annonce à `deleted`, ce qui lève le doute du cycle de ' +
    'vie (§32). La carte ne donne qu’un fragment de description : les fiches ' +
    'des annonces nouvelles sont visitées (10 par exécution) pour la ' +
    'récupérer entière depuis l’état de transfert.',
};

/**
 * Demande aux fiches disparues si elles sont retirées.
 *
 * Séparée de `run` parce qu'elle est une question complète en soi — « ces
 * annonces sont-elles encore là ? » — et parce qu'imbriquée dans la collecte
 * elle enterrait sa propre logique sous quatre niveaux d'indentation.
 */
async function checkWithdrawn(
  context: ScrapeContext,
  vanished: readonly string[],
): Promise<{ rentedRefs: string[]; requestCount: number; pagesFetched: number }> {
  const rentedRefs: string[] = [];
  let requestCount = 0;
  let pagesFetched = 0;

  for (const reference of vanished.slice(0, MAX_WITHDRAWN_CHECKS)) {
    if (context.shouldStop()) break;
    const url = listingUrl(reference);
    try {
      const page = await context.fetch(url);
      requestCount += 1;
      if (page.notModified) continue;
      pagesFetched += 1;
      if (parseWithdrawn(page.body, reference)) rentedRefs.push(reference);
    } catch (error) {
      // Une fiche injoignable ne prouve rien : l'annonce garde son doute (§17).
      const message = error instanceof Error ? error.message : String(error);
      context.log('withdrawn.check_failed', { reference, error: message });
      if (message.includes('429')) break;
    }
  }

  return { rentedRefs, requestCount, pagesFetched };
}

export const fonciaScraper: Scraper = {
  descriptor: FONCIA_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const listings: RawListing[] = [];
    const warnings: string[] = [];
    const rentedRefs: string[] = [];
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
        // Ce qu'on connaissait et qui n'est plus listé : on va le demander à
        // la fiche plutôt que de le laisser en « peut-être retirée » (§32).
        const seen = new Set(parsed.listings.map((listing) => listing.sourceRef));
        const vanished = [...context.knownRefs].filter((reference) => !seen.has(reference));
        const checked = await checkWithdrawn(context, vanished);
        requestCount += checked.requestCount;
        pagesFetched += checked.pagesFetched;
        rentedRefs.push(...checked.rentedRefs);

        // La fiche des annonces NOUVELLES porte la description entière ; la
        // carte n'en donnait qu'une demi-phrase.
        const enriched = await enrichNewListings(context, listings.splice(0), {
          max: MAX_DETAILS,
          detailUrl: (listing) => listing.sourceUrl,
          parse: (html, listing) => parseDetail(html, listing.sourceRef),
        });
        listings.push(...enriched.listings);
        requestCount += enriched.requestCount;
        pagesFetched += enriched.pagesFetched;
        warnings.push(...enriched.warnings);

        context.log('page.parsed', {
          url: ENTRY_URL,
          found: parsed.listings.length,
          known,
          vanished: vanished.length,
          withdrawn: checked.rentedRefs.length,
          details: enriched.pagesFetched,
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
      rentedRefs,
      requestCount,
      pagesFetched,
      stopReason,
      warnings,
    };
  },
};
