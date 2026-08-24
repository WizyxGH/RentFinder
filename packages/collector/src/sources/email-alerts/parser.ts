/**
 * Source : ALERTES E-MAIL des portails (Leboncoin, SeLoger, …) — §6, §10.
 *
 * Voie 100 % conforme pour les portails qui interdisent l'accès automatisé
 * (DataDome) : ce n'est PAS du scraping. L'utilisateur crée une alerte de
 * recherche sur le portail ; le portail LUI envoie par e-mail les nouvelles
 * annonces ; RentFinder lit ces e-mails dans SA boîte (IMAP, lecture seule) et
 * en extrait les annonces. Aucune connexion au portail, aucun contournement.
 *
 * Ce module ne fait QUE le parsing du HTML d'un e-mail (pur, testable). Le
 * transport IMAP vit dans `core/email-import.ts`.
 *
 * On extrait le strict fiable : le LIEN de l'annonce (dépiée des redirections
 * de tracking), sa référence, et — quand l'e-mail les présente — prix, surface,
 * titre et ville. Le détail complet reste sur le portail, ouvert par
 * l'utilisateur (§17 : on n'invente rien d'absent).
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/** Portail reconnu et comment en tirer une référence stable. */
interface Portal {
  readonly id: string;
  readonly host: RegExp;
  /** Extrait l'identifiant de l'annonce depuis l'URL. */
  readonly reference: (url: URL) => string | null;
}

const PORTALS: readonly Portal[] = [
  {
    id: 'leboncoin',
    host: /(^|\.)leboncoin\.fr$/i,
    reference: (url) => /(\d{8,})/.exec(url.pathname)?.[1] ?? null,
  },
  {
    id: 'seloger',
    host: /(^|\.)seloger\.com$/i,
    reference: (url) => /(\d{6,})/.exec(url.pathname + url.search)?.[1] ?? null,
  },
  {
    id: 'bienici',
    host: /(^|\.)bienici\.com$/i,
    reference: (url) => /([a-z0-9_-]{6,})\/?$/i.exec(url.pathname)?.[1] ?? null,
  },
];

/**
 * Dénoue une URL de lien d'e-mail : les portails enveloppent leurs liens dans
 * un domaine de tracking (`clic.­…`, `url=…`, `redirect?...`). On cherche une
 * URL de portail dans l'href lui-même PUIS dans ses paramètres décodés.
 * `null` si aucun portail reconnu.
 */
export function resolvePortalUrl(href: string): { portal: Portal; url: URL } | null {
  const candidates: string[] = [href];
  try {
    const outer = new URL(href);
    for (const value of outer.searchParams.values()) {
      if (/^https?%3a|^https?:\/\//i.test(value)) candidates.push(decodeURIComponent(value));
    }
  } catch {
    /* href non absolu : on tentera tel quel */
  }

  for (const candidate of candidates) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    const portal = PORTALS.find((p) => p.host.test(url.hostname));
    if (portal !== undefined) return { portal, url };
  }
  return null;
}

/** Premier montant « … € » trouvé dans un texte (loyer). */
function findPrice(text: string): string | undefined {
  return /(\d[\d\s.,]*)\s*€/.exec(text)?.[0];
}

/** Première surface « … m² » trouvée dans un texte. */
function findArea(text: string): string | undefined {
  return /(\d[\d.,]*)\s*m²/i.exec(text)?.[0];
}

/**
 * Extrait les annonces d'un e-mail d'alerte (HTML). Retourne une occurrence par
 * annonce distincte (dédoublonnée sur la référence). Le `sourceId` de collecte
 * reste `email-alerts` ; le portail d'origine est porté par `sourceUrl` et
 * `extra.portal` (§13, §38).
 */
export function parseAlertEmail(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const bySourceRef = new Map<string, RawListing>();

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const resolved = resolvePortalUrl(href);
    if (resolved === null) return;
    const { portal, url } = resolved;
    const reference = portal.reference(url);
    if (reference === null) return;
    const sourceRef = `${portal.id}:${reference}`;
    if (bySourceRef.has(sourceRef)) return;

    // Contexte texte : le bloc de l'annonce (le lien, sinon sa cellule/rangée).
    const container = $(el).closest('td, tr, table, div');
    const anchorText = cleanText($(el).text().replace(/\s+/g, ' '));
    const blockText = cleanText(
      (container.length > 0 ? container : $(el)).text().replace(/\s+/g, ' '),
    );
    const title = anchorText !== '' ? anchorText : undefined;
    const priceText = findPrice(anchorText) ?? findPrice(blockText);
    const areaText = findArea(anchorText) ?? findArea(blockText);
    const image = $(el).find('img[src]').attr('src') ?? container.find('img[src]').attr('src');

    const listing: RawListing = {
      sourceRef,
      // URL canonique du portail (sans les paramètres de tracking).
      sourceUrl: `${url.origin}${url.pathname}`,
      ...(title !== undefined ? { title } : {}),
      ...(priceText !== undefined ? { priceText } : {}),
      ...(areaText !== undefined ? { areaText } : {}),
      contactFormUrl: `${url.origin}${url.pathname}`,
      ...(image !== undefined && /^https?:/i.test(image) ? { imageUrls: [image] } : {}),
      extra: { reference, portal: portal.id },
    };
    bySourceRef.set(sourceRef, listing);
  });

  return [...bySourceRef.values()];
}
