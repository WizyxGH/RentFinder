/**
 * Source : FNAIM (fnaim.fr) — portail de la fédération professionnelle.
 * Voir la fiche d'étude dans `docs/sources.md`.
 *
 * POURQUOI ELLE COMPTE PLUS QUE LES AUTRES. Les trois quarts de l'inventaire
 * viennent aujourd'hui d'alertes e-mail, qui ne publient ni adresse ni
 * téléphone. La FNAIM est le contraire : 193 agences niçoises y publient
 * elles-mêmes, la carte nomme l'agence ET donne son téléphone en clair, et
 * beaucoup de ces agences n'ont pas de site scrapable. C'est la seule source
 * étudiée qui atteigne les petites agences en une requête.
 *
 * TOUT EST SUR LA CARTE : titre (type, pièces, surface, ville, CP), loyer,
 * description avec ses retours à la ligne — qui contient souvent l'adresse en
 * toutes lettres —, équipements, agence, téléphone, photos. Aucune fiche n'est
 * visitée (§30).
 *
 * ANCRAGE : classes sémantiques du gabarit (`li.item`, `.price`,
 * `.description`, `.agence .nom`, `.telNumber`), et l'attribut `data-title`
 * que le site pose lui-même sur chaque lien d'annonce pour son analytics —
 * il porte le titre canonique, à l'abri des retours à la ligne du HTML.
 *
 * PAS DE `relaysListings` ICI, à la différence de Rentumo. Les photos sont
 * réhébergées par la fédération, et ses adhérents sont les mêmes réseaux que
 * l'on collecte déjà en direct (Citya, Century 21…), dont certains illustrent
 * des dizaines d'annonces avec la même photo tamponnée. Une photo commune ne
 * prouverait donc rien au sein de la FNAIM (§14).
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';
import { htmlToText } from '../shared/html-text.js';
import { compactListing, type ParsedList } from '../shared/raw-listing.js';

const ORIGIN = 'https://www.fnaim.fr';

/** `/annonce-immobiliere/53157237/18-location-appartement-nice-06200.htm`. */
const LISTING_HREF = /^\/annonce-immobiliere\/(\d+)\//;

/** Le titre canonique : « Appartement 1 pièce 23m² NICE 06200 ». */
const TITLE_PARTS = /^(.+?)\s+(\d+\s*pi[eè]ces?)\s+([\d.,]+\s*m)²?\s+(.+?)\s+(\d{5})$/i;

export interface FnaimPage extends ParsedList {
  /** `true` si le gabarit annonce une page suivante. */
  readonly hasNext: boolean;
}

/** Décompose le titre canonique. Rien n'est deviné : sans forme, rien (§17). */
export function splitTitle(title: string): {
  propertyType?: string;
  rooms?: string;
  area?: string;
  city?: string;
  postalCode?: string;
} {
  const match = TITLE_PARTS.exec(cleanText(title));
  if (match === null) return {};
  const [, propertyType, rooms, area, city, postalCode] = match;
  return {
    ...(propertyType !== undefined ? { propertyType } : {}),
    ...(rooms !== undefined ? { rooms } : {}),
    ...(area !== undefined ? { area: `${area}²` } : {}),
    ...(city !== undefined ? { city } : {}),
    ...(postalCode !== undefined ? { postalCode } : {}),
  };
}

/**
 * Le loyer, quand il y en a un.
 *
 * La FNAIM laisse ses adhérents écrire « Nous consulter pour le prix » : c'est
 * une absence de prix, pas un prix. On ne renvoie que ce qui porte un montant
 * (§17) — la normalisation en tirera le nombre.
 */
function priceOf(text: string): string | undefined {
  const clean = cleanText(text);
  return /\d/.test(clean) ? clean : undefined;
}

function collectImages($: cheerio.CheerioAPI, card: cheerio.Cheerio<never>): string[] {
  const urls: string[] = [];
  card.find('img[src]').each((_index, node) => {
    const src = $(node).attr('src');
    // Le gabarit pose un logo de repli en `onerror` ; il n'est pas une photo.
    if (src === undefined || !src.startsWith('http')) return;
    if (!urls.includes(src)) urls.push(src);
  });
  return urls;
}

/** Extrait les annonces d'une page de résultats FNAIM. */
export function parseListPage(html: string, pageUrl: string): FnaimPage {
  const $ = cheerio.load(html);
  const listings: RawListing[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  $('li.item').each((_index, element) => {
    const card = $(element);
    const link = card.find('a.linkAnnonce[href^="/annonce-immobiliere/"]').first();
    const href = link.attr('href');
    if (href === undefined) return;

    const reference = LISTING_HREF.exec(href)?.[1];
    if (reference === undefined) {
      warnings.push(`Lien d'annonce sans référence : ${href}`);
      return;
    }
    if (seen.has(reference)) return;
    seen.add(reference);

    // `data-title` porte le titre canonique, sans les retours à la ligne que
    // le gabarit glisse dans le texte du lien.
    const title = cleanText(link.attr('data-title') ?? link.text());
    const parts = splitTitle(title);

    const agencyName = cleanText(card.find('.agence .nom').first().text());
    const phone = cleanText(card.find('.telNumber').first().text());
    const criteria = cleanText(card.find('.annonce_criteres').first().text());
    const description = htmlToText($, card.find('.description').first() as cheerio.Cheerio<never>);
    const images = collectImages($, card as cheerio.Cheerio<never>);

    listings.push(
      compactListing({
        sourceRef: reference,
        sourceUrl: new URL(href, pageUrl).toString(),
        title: title !== '' ? title : undefined,
        description: description !== '' ? description : undefined,
        priceText: priceOf(card.find('.price').first().text()),
        areaText: parts.area,
        roomsText: parts.rooms,
        propertyTypeText: parts.propertyType,
        cityText: parts.city,
        postalCodeText: parts.postalCode,
        agencyName: agencyName !== '' ? agencyName : undefined,
        phoneText: phone !== '' ? phone : undefined,
        // §23 : le contact passe par l'onglet « contacter l'agence » de la fiche.
        contactFormUrl: new URL(`${href}#AGE_CONTACT`, pageUrl).toString(),
        imageUrls: images.length > 0 ? images : undefined,
        extra: criteria !== '' ? { features: criteria } : undefined,
      }),
    );
  });

  const hasNext = $('a[href*="-page-"]').length > 0;
  return { listings, warnings, hasNext };
}

/** URL de la page N de la recherche « location appartement, Nice ». */
export function listUrl(page: number): string {
  const base = `${ORIGIN}/liste-annonces-immobilieres/18-location-appartement-nice-06000`;
  return page <= 1 ? `${base}.htm` : `${base}-page-${page}.htm`;
}
