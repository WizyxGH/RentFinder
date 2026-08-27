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
  // Une requête par annonce NOUVELLE, pour résoudre son lien de tracking en URL
  // canonique (voir `resolveCanonicalUrls`). Ce sont des résolutions de
  // redirection — l'en-tête `location` seul, jamais la page — étalées par le
  // limiteur à 20/min. Au-delà du plafond, les annonces restantes gardent leur
  // lien d'origine plutôt que d'insister (§10, §69).
  budget: budgetFor('portal', { maxPagesPerRun: 40, maxListingsPerRun: 200 }),
  enabled: true,
  // Premier contact via le lien du portail, à la main de l'utilisateur (§23).
  manualOnly: true,
  allowedPaths: [],
  notes:
    'Lit les e-mails d’alerte des portails dans la boîte de l’utilisateur (IMAP, ' +
    'lecture seule) — AUCUN scraping, aucune connexion au portail (§6, §10). ' +
    'Activée si IMAP_USER/IMAP_APP_PASSWORD sont configurés (Gmail par défaut).',
};

/** Hôtes de redirection des portails : leur lien expire, pas l'annonce. */
const TRACKING_HOSTS = /(^|\.)(click|link|clic|url\d*|email|mail|t)\./i;

/**
 * Remplace un lien de TRACKING par l'URL canonique de l'annonce.
 *
 * Les digests SeLoger ne contiennent que des liens `click.by.seloger.com/?qs=…`
 * (vérifié : zéro URL directe sur 99 e-mails). Ces liens PÉRIMENT alors que
 * l'annonce, elle, reste en ligne — d'où des « l'URL ne mène à rien » (§17).
 *
 * On résout donc la redirection UNE FOIS, à la collecte, et on stocke la cible.
 * `redirect: 'manual'` : on lit l'en-tête `location` sans jamais télécharger la
 * page du portail — aucun accès automatisé à SeLoger (§10). Une seule requête
 * par annonce NOUVELLE ; en cas d'échec on garde le lien d'origine (§69).
 */
async function resolveCanonicalUrls(
  listings: readonly RawListing[],
  context: ScrapeContext,
): Promise<{ listings: RawListing[]; requests: number }> {
  const resolved: RawListing[] = [];
  let requests = 0;

  for (const listing of listings) {
    let host: string;
    try {
      host = new URL(listing.sourceUrl).hostname;
    } catch {
      resolved.push(listing);
      continue;
    }
    if (!TRACKING_HOSTS.test(host) || context.shouldStop()) {
      resolved.push(listing);
      continue;
    }

    try {
      const response = await context.fetch(listing.sourceUrl, { redirect: 'manual' });
      requests += 1;
      const target = response.headers['location'];
      if (target !== undefined && /^https?:/i.test(target)) {
        // On retire les paramètres de campagne : l'URL doit rester celle qu'un
        // humain partagerait.
        const url = new URL(target);
        url.search = '';
        resolved.push({ ...listing, sourceUrl: url.toString(), contactFormUrl: url.toString() });
        continue;
      }
    } catch (error) {
      context.log('email.resolve_failed', {
        ref: listing.sourceRef,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    resolved.push(listing);
  }

  return { listings: resolved, requests };
}

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

    // Fenêtre courte (4 j) : les annonces des portails expirent vite. Au-delà,
    // le lien renvoie souvent vers une annonce « plus disponible » et rouvrir
    // beaucoup de ces liens fait rate-limiter l'utilisateur par le portail. On
    // privilégie donc le frais au volume (§17, §29).
    const bodies = await fetchAlertEmails({ config, log: context.log, sinceDays: 4 });

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
    const fresh = all.filter((listing) => !context.isKnown(listing.sourceRef));
    // Les liens de tracking sont résolus en URL canonique AVANT d'enregistrer :
    // c'est cette URL que l'utilisateur ouvrira, parfois des jours plus tard.
    const { listings, requests } = await resolveCanonicalUrls(fresh, context);

    context.log('email.parsed', {
      emails: bodies.length,
      listings: all.length,
      new: listings.length,
      resolved: requests,
    });

    return {
      sourceId: EMAIL_ALERTS_DESCRIPTOR.id,
      listings,
      confirmedRefs,
      requestCount: bodies.length + requests,
      pagesFetched: bodies.length,
      stopReason: 'completed',
      warnings: [],
    };
  },
};
