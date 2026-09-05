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
 * LA CARTE PORTE L'ESSENTIEL : titre (type, pièces, surface, ville, CP), loyer,
 * agence, téléphone, photos. Mais elle COUPE la description vers 250
 * caractères, et ce qu'elle coupe contient souvent l'adresse en toutes lettres.
 * Les fiches NOUVELLES sont donc visitées, vingt par passage au plus (§30) —
 * l'en-tête a longtemps prétendu le contraire, et cette phrase périmée a fait
 * conclure à tort qu'enrichir FNAIM coûterait soixante-seize requêtes.
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
import { compactListing, type ParsedList, type RawDraft } from '../shared/raw-listing.js';

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

/**
 * Ce que la FICHE ajoute à la carte : la description entière.
 *
 * La carte la coupe à environ 250 caractères, sur une ellipse (« … revenus
 * ... »). La fiche donne le texte complet — 1 900 caractères dans le cas
 * mesuré — et, avec lui, l'adresse en toutes lettres que l'agence écrit
 * souvent en tête (« 94 AV. DE LA CORNICHE FLEURIE 06200 NICE »), donc de quoi
 * placer une punaise (§20) et reconnaître un doublon (§14).
 *
 * `itemprop="description"` : le gabarit le pose lui-même pour les moteurs de
 * recherche. C'est un ancrage sémantique, plus stable qu'une classe de mise en
 * page.
 *
 * @returns le complément à fusionner, ou `null` si la fiche n'apprend rien —
 *          auquel cas on garde ce que la carte avait donné (§17).
 */
/**
 * Le tableau « Caractéristiques du bien » d'une fiche.
 *
 * Balisage régulier : `<li><span>Intitulé&nbsp;: </span> Valeur</li>`, groupé
 * sous des titres (Composition, Extérieur, Partie commune). On ne cherche pas
 * un intitulé précis — chaque agence remplit ce qu'elle veut — on ramasse tout.
 *
 * LES « NON » SONT ÉCARTÉS, et c'est le point délicat. Ce tableau répond par
 * « Oui » ou « Non » : « Balcon : Non » recopié tel quel dans le texte des
 * atouts y ferait apparaître un balcon, puisque la normalisation cherche le
 * mot. On inventerait un équipement à partir de son absence, ce qui est
 * exactement l'inverse de ce que §17 demande.
 *
 * Un « Oui » perd sa valeur et ne garde que l'intitulé : « Ascenseur » se lit,
 * « Ascenseur : Oui » ne se lit pas mieux.
 */
export function parseCharacteristics(html: string): string | undefined {
  const $ = cheerio.load(html);
  const parts: string[] = [];

  $('.caracteristique li').each((_index, element) => {
    const item = $(element);
    const label = cleanText(item.find('span').first().text()).replace(/\s*:\s*$/, '');
    if (label === '') return;
    const value = cleanText(item.clone().children('span').remove().end().text());
    if (value === '' || /^non$/i.test(value)) return;
    parts.push(/^oui$/i.test(value) ? label : `${label} : ${value}`);
  });

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function parseDetail(html: string): RawDraft | null {
  const $ = cheerio.load(html);
  const node = $('[itemprop="description"]').first();
  // Une annonce retirée renvoie la page de LISTE, qui n'a pas de description :
  // c'est ce qui distingue les deux, et ce qui évite de recopier la description
  // d'une annonce voisine sur celle qu'on cherchait.
  if (node.length === 0) return null;
  const description = htmlToText($, node as unknown as cheerio.Cheerio<never>);
  if (description.length === 0) return null;

  // La fiche est déjà téléchargée pour sa description : lire le tableau des
  // caractéristiques au passage ne coûte aucune requête de plus.
  const features = parseCharacteristics(html);
  return features === undefined ? { description } : { description, extra: { features } };
}
