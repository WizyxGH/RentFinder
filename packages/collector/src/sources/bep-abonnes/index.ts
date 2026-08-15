/**
 * Source : BEP Logement — ESPACE ABONNÉ (accès PAYÉ par l'utilisateur, §6).
 *
 * Contrairement aux sources publiques, celle-ci s'authentifie : elle se connecte
 * avec les identifiants privés de l'utilisateur (`.env`, jamais committés — §26),
 * puis lit le bulletin « Classeurs » qui liste toutes les annonces de l'agence.
 *
 * POURQUOI UN FETCH PROPRE. Le `context.fetch` fourni au scraper est en GET et
 * sans cookies ; la connexion exige un POST puis une session. Ce scraper émet
 * donc lui-même deux requêtes par run (connexion + bulletin), vers le compte
 * PAYÉ de l'utilisateur — ce n'est pas du scraping agressif (§10), et ça reste
 * borné et poli.
 *
 * SÉCURITÉ. Sans identifiants, la source est simplement inactive (aucune
 * requête). Les identifiants ne sont jamais journalisés (§26, §62).
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
import { collectorUserAgent, loadBepCredentials } from '../../config.js';
import { parseBulletin } from './parser.js';

const BASE = 'http://abonnes.beplogement.com';
const LOGIN_URL = `${BASE}/w_login_abonnes.php`;
const INDEX_URL = `${BASE}/w_index_abonnes.php`;

export const BEP_ABONNES_DESCRIPTOR: SourceDescriptor = {
  id: 'bep-abonnes',
  name: 'BEP Logement (abonné)',
  domain: 'abonnes.beplogement.com',
  kind: 'agencyNetwork',
  method: 'html',
  // Priorité haute : source payée, riche et exclusive.
  priority: 1,
  schedule: scheduleFor('agencyNetwork', { baseIntervalMinutes: 60 }),
  budget: budgetFor('agencyNetwork', { maxPagesPerRun: 2, maxListingsPerRun: 1000 }),
  enabled: true,
  // Premier contact via l'agence BEP : automatiser n'est pas approprié (§23).
  manualOnly: true,
  allowedPaths: ['/w_login_abonnes.php', '/w_index_abonnes.php'],
  notes:
    'Espace abonné PAYÉ (§6). Connexion (POST abonlogin1/abonpassword) puis ' +
    'lecture du bulletin « Classeurs ». Identifiants privés dans .env ' +
    '(BEP_SUBSCRIBER_*), jamais committés. Inactive si non configurés.',
};

/** Assemble les cookies d'un en-tête Set-Cookie dans un pot. */
function collectCookies(headers: Headers, jar: Map<string, string>): void {
  for (const raw of headers.getSetCookie?.() ?? []) {
    const pair = raw.split(';')[0]?.trim();
    if (pair !== undefined && pair.includes('=')) {
      jar.set(pair.slice(0, pair.indexOf('=')), pair);
    }
  }
}

export const bepAbonnesScraper: Scraper = {
  descriptor: BEP_ABONNES_DESCRIPTOR,

  async run(context: ScrapeContext): Promise<ScrapeResult> {
    const empty = (stopReason: StopReason, warnings: string[]): ScrapeResult => ({
      sourceId: BEP_ABONNES_DESCRIPTOR.id,
      listings: [],
      requestCount: 0,
      pagesFetched: 0,
      stopReason,
      warnings,
    });

    const credentials = loadBepCredentials();
    if (credentials === null) {
      context.log('bep_abonnes.no_credentials');
      return empty('completed', ['Identifiants BEP absents (.env) — source inactive']);
    }

    const userAgent = collectorUserAgent();
    const jar = new Map<string, string>();
    let requestCount = 0;

    try {
      // 1. Session initiale + connexion.
      const first = await fetch(INDEX_URL, { headers: { 'User-Agent': userAgent } });
      collectCookies(first.headers, jar);

      const body = new URLSearchParams({
        abonlogin1: credentials.user,
        abonpassword: credentials.password,
        'Envoyer.x': '10',
        'Envoyer.y': '10',
      });
      const login = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: [...jar.values()].join('; '),
        },
        body,
      });
      requestCount += 2;
      collectCookies(login.headers, jar);

      // Le POST de connexion renvoie DIRECTEMENT le bulletin (pas de redirection).
      const html = await login.text();

      // Échec d'authentification : le formulaire de connexion réapparaît.
      if (/name="abonpassword"/i.test(html)) {
        context.log('bep_abonnes.auth_failed');
        return {
          ...empty('blocked', ['Connexion BEP refusée — vérifier les identifiants (.env)']),
          requestCount,
        };
      }

      const parsed = parseBulletin(html);
      const listings: RawListing[] = [...parsed.listings];

      context.log('bulletin.parsed', { found: listings.length });

      return {
        sourceId: BEP_ABONNES_DESCRIPTOR.id,
        listings,
        requestCount,
        pagesFetched: 1,
        stopReason: 'completed',
        warnings: [...parsed.warnings],
      };
    } catch (error) {
      // §69 : une panne réseau ne fait pas échouer la collecte entière.
      const message = error instanceof Error ? error.message : String(error);
      context.log('bep_abonnes.failed', { error: message });
      return { ...empty('tooManyErrors', [`Échec BEP abonné : ${message}`]), requestCount };
    }
  },
};
