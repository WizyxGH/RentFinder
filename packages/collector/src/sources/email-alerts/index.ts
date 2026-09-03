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
import { locationFromUrl, parseAlertEmail, referenceFromUrl } from './parser.js';

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
  // Le plafond doit couvrir TOUTES les annonces nouvelles d'un passage : une
  // annonce non résolue est enregistrée avec son lien de tracking, devient
  // « connue », et n'est alors plus jamais résolue.
  budget: budgetFor('portal', { maxPagesPerRun: 120, maxListingsPerRun: 200 }),
  // Le portail envoie chaque annonce une fois : son absence des digests
  // suivants ne prouve rien (voir `oneShotListings`).
  oneShotListings: true,
  // Relais de portails : une photo partagée désigne le même bien (§14).
  relaysListings: true,
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
 * Remplace un lien de tracking par l'URL canonique de l'annonce.
 *
 * Ces liens périment alors que l'annonce reste en ligne, d'où des « l'URL ne
 * mène à rien ». `redirect: 'manual'` lit le seul en-tête `location` : la page
 * du portail n'est jamais téléchargée (§10). En cas d'échec, on garde le lien
 * d'origine (§69).
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
        const canonical = url.toString();
        // L'URL dénouée porte le VRAI identifiant de l'annonce : on l'adopte à
        // la place de la référence fabriquée depuis le contenu de l'e-mail,
        // qui variait d'un envoi à l'autre et créait des doublons.
        const reference = referenceFromUrl(canonical);
        // L'URL porte aussi la LOCALISATION, absente de la moitié des digests :
        // sans elle, l'annonce n'était comparable à aucune autre au
        // dédoublonnage (les clés sont préfixées par la commune). On ne
        // remplace jamais ce que l'e-mail a publié, on complète (§17).
        const place = locationFromUrl(canonical);
        const quartier = place.districtText;
        resolved.push({
          ...listing,
          ...(reference !== null ? { sourceRef: reference } : {}),
          ...(listing.cityText === undefined && place.cityText !== undefined
            ? { cityText: place.cityText }
            : {}),
          ...(listing.postalCodeText === undefined && place.postalCodeText !== undefined
            ? { postalCodeText: place.postalCodeText }
            : {}),
          ...(quartier !== undefined ? { extra: { ...(listing.extra ?? {}), quartier } } : {}),
          sourceUrl: canonical,
          contactFormUrl: canonical,
        });
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
