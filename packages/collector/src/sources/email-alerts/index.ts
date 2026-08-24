/**
 * Source : ALERTES E-MAIL des portails (§6, §10) — voir `parser.ts`.
 *
 * Voie conforme pour Leboncoin/SeLoger & co. : l'utilisateur crée des alertes,
 * le portail lui envoie les nouvelles annonces par e-mail, RentFinder les lit
 * dans SA boîte (IMAP, lecture seule). Aucune connexion au portail.
 *
 * Désactivée tant qu'`IMAP_USER`/`IMAP_APP_PASSWORD` ne sont pas dans `.env`.
 */

import type {
  RawListing,
  Scraper,
  ScrapeContext,
  ScrapeResult,
  SourceDescriptor,
} from '@rentfinder/shared';
import { budgetFor, scheduleFor } from '../../core/budgets.js';
import { loadImapConfig } from '../../config.js';
import { fetchAlertEmails } from '../../core/email-import.js';
import { parseAlertEmail } from './parser.js';

export const EMAIL_ALERTS_DESCRIPTOR: SourceDescriptor = {
  id: 'email-alerts',
  name: 'Alertes e-mail',
  domain: 'imap',
  kind: 'portal',
  method: 'html',
  priority: 1,
  schedule: scheduleFor('portal'),
  budget: budgetFor('portal', { maxPagesPerRun: 1, maxListingsPerRun: 200 }),
  enabled: true,
  // Premier contact via le lien du portail, à la main de l'utilisateur (§23).
  manualOnly: true,
  allowedPaths: [],
  notes:
    'Lit les e-mails d’alerte des portails dans la boîte de l’utilisateur (IMAP, ' +
    'lecture seule) — AUCUN scraping, aucune connexion au portail (§6, §10). ' +
    'Activée si IMAP_USER/IMAP_APP_PASSWORD sont configurés (Gmail par défaut).',
};

export const emailAlertsScraper: Scraper = {
  descriptor: EMAIL_ALERTS_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const config = loadImapConfig();
    if (config === null) {
      // Non configuré : rien à faire (l'import est simplement inactif).
      return {
        sourceId: EMAIL_ALERTS_DESCRIPTOR.id,
        listings: [],
        requestCount: 0,
        pagesFetched: 0,
        stopReason: 'completed',
        warnings: [],
      };
    }

    const bodies = await fetchAlertEmails({ config, log: context.log });

    // Toutes les annonces des e-mails, dédoublonnées sur la référence.
    const bySourceRef = new Map<string, RawListing>();
    for (const body of bodies) {
      for (const listing of parseAlertEmail(body)) {
        if (!bySourceRef.has(listing.sourceRef)) bySourceRef.set(listing.sourceRef, listing);
      }
    }
    const all = [...bySourceRef.values()];

    // Déjà connues → confirmées sans réécriture ; nouvelles → à normaliser (§32).
    const confirmedRefs = all
      .filter((listing) => context.isKnown(listing.sourceRef))
      .map((listing) => listing.sourceRef);
    const listings = all.filter((listing) => !context.isKnown(listing.sourceRef));

    context.log('email.parsed', {
      emails: bodies.length,
      listings: all.length,
      new: listings.length,
    });

    return {
      sourceId: EMAIL_ALERTS_DESCRIPTOR.id,
      listings,
      confirmedRefs,
      requestCount: bodies.length,
      pagesFetched: bodies.length,
      stopReason: 'completed',
      warnings: [],
    };
  },
};
