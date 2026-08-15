/**
 * Parser des pages de liste de pap.fr (De Particulier À Particulier).
 *
 * VALEUR DE LA SOURCE : des bailleurs PARTICULIERS — contact direct sans
 * agence, précisément ce que les grands portails d'agences ne donnent pas.
 *
 * CONFORMITÉ (§6, §10) — revérifiée le 2026-08-15 :
 *   - `robots.txt` (`User-agent: *`) interdit les URLs à paramètres (`/*?*`),
 *     `/annonce/liste/` et des listes SEO filtrées précises ; il n'interdit
 *     PAS les pages `/annonce/locations-{ville}-g{id}` — qui sont au
 *     contraire déclarées dans le sitemap officiel `liste_annonces.xml`.
 *     C'est ce chemin, prévu et publié par PAP, qui est utilisé — jamais la
 *     recherche interne.
 *   - Les fiches `/annonces/…` (pluriel) ne sont pas interdites ; seule leur
 *     URL est conservée, aucune n'est visitée par le scraper (les cartes de
 *     liste contiennent déjà tout : §6, maximum d'informations par requête).
 *
 * ANCRAGE : classes sémantiques stables du site (`item-title`, `item-price`,
 * `item-tags`, `item-description`) et forme des URLs `/annonces/…-r{réf}`.
 * Le DPE est porté par une classe CSS `item-thumb-dpe-{a-g}` — extrait tel
 * quel dans `extra` (§17 : seulement si présent).
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/** Forme d'une URL de fiche : `/annonces/{slug}-r{référence numérique}`. */
const LISTING_URL_PATTERN =
  /^https?:\/\/(?:www\.)?pap\.fr\/annonces\/([a-z0-9-]+?)-r(\d{6,})\/?(?:[?#].*)?$/i;

export interface ParsedListingUrl {
  readonly slug: string;
  readonly reference: string;
  readonly canonicalUrl: string;
}

/** Analyse une URL de fiche. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string): ParsedListingUrl | null {
  const match = LISTING_URL_PATTERN.exec(href.trim());
  if (match === null) return null;
  const [, slug, reference] = match;
  if (slug === undefined || reference === undefined) return null;
  return {
    slug,
    reference,
    canonicalUrl: `https://www.pap.fr/annonces/${slug}-r${reference}`,
  };
}

/** Extrait la classe DPE d'une carte (`item-thumb-dpe-c` → `C`). */
export function extractDpe(classAttr: string | undefined): string | undefined {
  const match = classAttr?.match(/item-thumb-dpe-([a-g])\b/i);
  return match?.[1]?.toUpperCase();
}

/** Résultat du parsing d'une page de liste. */
export interface ParsedPage {
  readonly listings: readonly RawListing[];
  readonly hasNextPage: boolean;
  readonly warnings: readonly string[];
}

/**
 * Analyse une page `/annonce/locations-{ville}-g{id}` et en extrait les
 * annonces.
 *
 * @param html contenu HTML brut de la page
 * @param pageUrl URL de la page, pour résoudre les liens relatifs
 */
export function parseSearchPage(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const byReference = new Map<string, RawListing>();

  $('a.item-title[href*="/annonces/"]').each((_index, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    if (href === undefined) return;

    const absolute = href.startsWith('http') ? href : new URL(href, pageUrl).toString();
    const parsed = parseListingUrl(absolute);
    if (parsed === null) return;
    if (byReference.has(parsed.reference)) return;

    // La carte englobante porte la description et le DPE.
    const card = anchor.closest('div.item-body').parent();

    const priceText = cleanText(anchor.find('.item-price').first().text());
    const locationText = cleanText(anchor.find('.h1').first().text());
    const tags = anchor
      .find('.item-tags li')
      .map((_i, tag) => cleanText($(tag).text()))
      .get();
    const description = cleanText(card.find('.item-description').first().text());
    const dpe = extractDpe(card.find('[class*="item-thumb-dpe"]').first().attr('class'));

    // « Nice (06000) » → ville + code postal.
    const locationMatch = locationText.match(/^(.+?)\s*\((\d{5})\)/);
    const city = locationMatch?.[1] !== undefined ? cleanText(locationMatch[1]) : locationText;
    const postalCode = locationMatch?.[2];

    const tagsText = tags.join(' ');
    const areaText = tagsText.match(/[\d][\d\s.,]*\s*m\s*(?:²|2)(?!\d)/i)?.[0];
    const roomsText = tagsText !== '' ? tagsText : undefined;

    // Un prix illisible (« Nous consulter ») est simplement omis (§17) : la
    // normalisation le traitera comme inconnu, jamais comme zéro.
    const hasNumericPrice = /\d/.test(priceText);

    const extra: Record<string, string> = { reference: parsed.reference };
    if (dpe !== undefined) extra['dpe'] = dpe;

    const listing: RawListing = {
      sourceRef: parsed.reference,
      sourceUrl: parsed.canonicalUrl,
      ...(description !== ''
        ? { title: description.slice(0, 120), description }
        : { title: locationText }),
      ...(hasNumericPrice ? { priceText } : {}),
      ...(areaText !== undefined ? { areaText } : {}),
      ...(roomsText !== undefined ? { roomsText } : {}),
      // Les listes PAP mélangent studios et appartements ; le slug de la
      // fiche commence par le type réel.
      propertyTypeText: parsed.slug.split('-')[0] ?? '',
      furnishedText: cleanText(`${tagsText} ${description}`),
      cityText: city,
      ...(postalCode !== undefined ? { postalCodeText: postalCode } : {}),
      // §21 : PAP ne publie pas de coordonnées en liste. Le canal prévu est
      // la messagerie de la fiche — on n'invente rien et on ne visite pas
      // chaque fiche juste pour tenter d'en extraire plus.
      contactFormUrl: parsed.canonicalUrl,
      extra,
    };

    byReference.set(parsed.reference, listing);
  });

  const listings = [...byReference.values()];

  // §61 : détection d'anomalie structurelle.
  if (listings.length > 0) {
    const withPrice = listings.filter((listing) => listing.priceText !== undefined).length;
    if (withPrice === 0) {
      warnings.push('Aucune annonce ne contient de prix — structure probablement modifiée');
    } else if (withPrice / listings.length < 0.5) {
      warnings.push(
        `Seules ${withPrice}/${listings.length} annonces contiennent un prix — parsing dégradé`,
      );
    }
  }

  // Pagination PAP : la page N+1 est le même chemin suffixé `-{N+1}`.
  const currentPage = Number.parseInt(/-(\d+)$/.exec(new URL(pageUrl).pathname)?.[1] ?? '1', 10);
  const nextSuffix = `-${currentPage + 1}`;
  const hasNextPage =
    $(`a[href$="${nextSuffix}"]`).length > 0 ||
    $(`a[href*="${nextSuffix}?"]`).length > 0 ||
    $('a.next').length > 0;

  return { listings, hasNextPage, warnings };
}
