/**
 * Parser des pages « ville » de century21.fr.
 *
 * CONFORMITÉ (revérifiée le 2026-08-15) : le `robots.txt` interdit les
 * recherches par code postal (motifs « location…/cp-… ») et par agence
 * (« /a/…/annonces/ »), mais PAS le format par ville
 * `/annonces/location-appartement/v-nice/` — qui est indexable
 * (`meta robots: index, follow`) et servi en SSR. Le verdict initial du
 * projet (« écartée ») était trop sévère et a été corrigé après relecture.
 *
 * ANCRAGE : classes composant du site (`js-the-list-of-properties-list-property`,
 * `c-the-property-thumbnail-with-content`), attribut `data-uid`, texte du
 * `h3` (« NICE 06 / 78,27 m² / 3 pièces / Ref : 16862 / … / 3 000 € par mois
 * charges comprises »).
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/** Forme d'une URL de fiche : `/trouver_logement/detail/{uid}/`. */
const LISTING_URL_PATTERN =
  /^https?:\/\/(?:www\.)?century21\.fr\/trouver_logement\/detail\/(\d{6,})\/?(?:[?#].*)?$/i;

export interface ParsedListingUrl {
  readonly reference: string;
  readonly canonicalUrl: string;
}

/** Analyse une URL de fiche. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string): ParsedListingUrl | null {
  const match = LISTING_URL_PATTERN.exec(href.trim());
  if (match?.[1] === undefined) return null;
  return {
    reference: match[1],
    canonicalUrl: `https://www.century21.fr/trouver_logement/detail/${match[1]}/`,
  };
}

/** Résultat du parsing d'une page de résultats. */
export interface ParsedPage {
  readonly listings: readonly RawListing[];
  readonly hasNextPage: boolean;
  readonly warnings: readonly string[];
}

/**
 * Analyse une page `/annonces/location-appartement/v-{ville}/`.
 *
 * @param html contenu HTML brut de la page
 * @param pageUrl URL de la page, pour résoudre les liens relatifs
 */
export function parseSearchPage(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const byReference = new Map<string, RawListing>();

  $('.c-the-property-thumbnail-with-content[data-uid]').each((_index, element) => {
    const card = $(element);

    let parsedUrl: ParsedListingUrl | null = null;
    card.find('a[href*="/trouver_logement/detail/"]').each((_i, anchor) => {
      if (parsedUrl !== null) return;
      const href = $(anchor).attr('href');
      if (href === undefined) return;
      const absolute = href.startsWith('http') ? href : new URL(href, pageUrl).toString();
      parsedUrl = parseListingUrl(absolute);
    });
    if (parsedUrl === null) return;
    const url: ParsedListingUrl = parsedUrl;
    if (byReference.has(url.reference)) return;

    // Le h3 concentre tout : ville, surface, pièces, référence agence, type,
    // prix. Aplati en texte, les unités françaises servent d'ancres.
    const headText = cleanText(card.find('h3').first().text().replace(/\s+/g, ' '));
    const description = cleanText(card.find('.tw-truncate-safe').first().text());
    const ariaTitle = cleanText(card.find('a[aria-label]').first().attr('aria-label') ?? '');

    const priceText = headText.match(/[\d][\d\s.,]*\s*€\s*par\s*mois[^,.]*/i)?.[0];
    // Sans espaces internes : le « 06 » du département précède la surface
    // dans le texte aplati (« NICE 06 78,27 m² ») et serait sinon capturé.
    const areaText = headText.match(/\d+(?:[.,]\d+)?\s*m\s*(?:²|2)(?!\d)/i)?.[0];
    const roomsText = headText.match(/\d+\s*pièces?/i)?.[0];
    const agencyRef = headText.match(/Ref\s*:\s*([\w-]+)/i)?.[1];
    // « NICE 06 » en tête de bloc : ville en capitales suivie du département.
    const cityMatch = headText.match(/^([A-ZÀ-Ý][A-ZÀ-Ý\s'-]+?)\s+\d{2}\b/u);

    const imageUrls = card
      .find('img[src]')
      .map((_i, img) => $(img).attr('src'))
      .get()
      .filter((src): src is string => typeof src === 'string' && src.startsWith('http'));

    const extra: Record<string, string> = { reference: url.reference };
    if (agencyRef !== undefined) extra['agencyRef'] = agencyRef;

    const listing: RawListing = {
      sourceRef: url.reference,
      sourceUrl: url.canonicalUrl,
      ...(ariaTitle !== '' ? { title: ariaTitle } : { title: headText }),
      ...(description !== '' ? { description } : {}),
      ...(priceText !== undefined ? { priceText } : {}),
      ...(areaText !== undefined ? { areaText } : {}),
      ...(roomsText !== undefined ? { roomsText } : {}),
      propertyTypeText: ariaTitle !== '' ? ariaTitle : headText,
      furnishedText: cleanText(`${headText} ${description}`),
      ...(cityMatch?.[1] !== undefined ? { cityText: cleanText(cityMatch[1]) } : {}),
      agencyName: 'Century 21',
      // §21 : pas de coordonnées directes en liste ; la fiche est le canal.
      contactFormUrl: url.canonicalUrl,
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      extra,
    };

    byReference.set(url.reference, listing);
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

  // La page ville liste tout le stock d'un coup (19 annonces observées) :
  // pas de pagination à suivre.
  return { listings, hasNextPage: false, warnings };
}
