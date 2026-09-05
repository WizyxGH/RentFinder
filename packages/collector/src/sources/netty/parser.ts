/**
 * Adaptateur générique des sites d'agences sur la plateforme **Netty**
 * (§5, §47 : un seul parser pour de nombreuses agences).
 *
 * Netty (netty.fr) est, avec Apimo/Cello et Hektor/La Boîte Immo, l'un des
 * prestataires qui génèrent l'essentiel des sites d'agences françaises. Deux
 * agences niçoises demandées le 2026-09-05 en dépendent — Centragence et
 * I.C.I Info Conseil Immobilier —, et un adaptateur les couvre toutes deux du
 * même coup, comme il couvrira les suivantes.
 *
 * SIGNATURE DE LA PLATEFORME :
 *   - `robots.txt` n'interdisant que `/*.pdf`, avec `Crawl-delay: 5` et un
 *     sitemap déclaré ;
 *   - URLs de fiches `/{transaction}/{slug}-{code postal},{référence}` ;
 *   - JSON-LD schema.org `Product`, dont le bien tient sous
 *     `offers.itemOffered` — et non à la racine comme chez Apimo ;
 *   - page composée de blocs `[data-author="Netty.fr"]`.
 *
 * ON NE S'ACCROCHE PAS AUX CLASSES CSS. Netty les engendre hachées
 * (`_1o6jcyu`, `_s2u4i5`) : elles changent à chaque reconstruction du thème, et
 * un sélecteur qui s'y fierait casserait sans prévenir. Tout ce que ce parser
 * vise est STRUCTUREL — le découpage en composants Netty, les couples
 * intitulé/valeur d'une liste, les intertitres en toutes lettres — ou porté par
 * le JSON-LD.
 */

import * as cheerio from 'cheerio';
import { sitemapIndexUrls, sitemapUrls } from '../shared/sitemap.js';
import type { RawListing } from '@rentfinder/shared';
import { cleanText, comparable } from '../../normalization/text.js';
import { htmlToText } from '../shared/html-text.js';
import { compactListing } from '../shared/raw-listing.js';
import {
  collectJsonLdNodes,
  findJsonLdNode,
  jsonLdString,
  type JsonLdNode,
} from '../shared/json-ld.js';

/**
 * Forme d'une URL de fiche : `/{transaction}/{slug}-{code postal},{référence}`.
 *
 * Le code postal est le seul repère fiable de commune. Le slug contient bien un
 * nom de ville, mais collé à tout le reste — `appartement-t2-2-pieces-nice` —
 * et une commune en plusieurs mots (`saint-laurent-du-var`) rend tout découpage
 * naïf faux. On garde donc le slug entier et l'on compare par sa FIN.
 */
const LISTING_URL_PATTERN =
  /^https?:\/\/(?:www\.)?[a-z0-9.-]+\/(location|vente)\/([a-z0-9-]+)-(\d{5}),([^/,?#]+)\/?$/i;

export interface ParsedListingUrl {
  readonly transaction: 'location' | 'vente';
  /** Slug complet, code postal exclu : `appartement-t2-2-pieces-nice`. */
  readonly slug: string;
  /** Premier segment du slug : `appartement`, `maison`, `local`… */
  readonly typeSlug: string;
  readonly postalCode: string;
  readonly reference: string;
  readonly canonicalUrl: string;
}

/** Analyse une URL de fiche. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string): ParsedListingUrl | null {
  const match = LISTING_URL_PATTERN.exec(href.trim());
  if (match === null) return null;
  const [, transaction, slug, postalCode, reference] = match;
  if (
    transaction === undefined ||
    slug === undefined ||
    postalCode === undefined ||
    reference === undefined
  ) {
    return null;
  }
  return {
    transaction: transaction.toLowerCase() as 'location' | 'vente',
    slug: slug.toLowerCase(),
    typeSlug: slug.toLowerCase().split('-')[0] ?? '',
    postalCode,
    reference,
    canonicalUrl: href.trim().replace(/[?#].*$/, ''),
  };
}

/**
 * `true` si la fiche porte sur l'une des communes visées.
 *
 * Le nom de commune termine le slug, juste avant le code postal : comparer par
 * la fin traite « nice » et « saint-laurent-du-var » de la même façon, sans
 * avoir à deviner où commence le nom.
 */
export function matchesCity(url: ParsedListingUrl, citySlugs: readonly string[]): boolean {
  return citySlugs.some((city) => url.slug === city || url.slug.endsWith(`-${city}`));
}

export interface SitemapEntry {
  readonly url: ParsedListingUrl;
}

/**
 * Extrait les fiches de LOCATION d'un sitemap.
 *
 * Les sitemaps Netty ne portent AUCUN `lastmod` : rien n'y dit ce qui est
 * récent. On ne peut donc ni prioriser ni écarter les fiches anciennes — ce que
 * l'adaptateur Apimo fait grâce à cette date. C'est supportable parce que ces
 * sitemaps sont petits (25 URL sur les deux sites observés) et purgés : une
 * annonce retirée n'y figure plus.
 */
export function parseSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  for (const { loc } of sitemapUrls(xml)) {
    const url = parseListingUrl(loc);
    if (url === null || url.transaction !== 'location') continue;
    entries.push({ url });
  }
  return entries;
}

export function parseSitemapIndex(xml: string): string[] {
  return sitemapIndexUrls(xml);
}

/** Sous-ensemble utile du JSON-LD d'une fiche Netty. */
interface JsonLdData {
  readonly name?: string;
  readonly rooms?: number;
  readonly area?: number;
  readonly city?: string;
  readonly postalCode?: string;
  readonly price?: string;
  readonly imageUrls?: readonly string[];
}

/** URLs de photos d'un nœud : `image` (chaîne ou tableau) et `photo[].url`. */
function jsonLdImages(product: JsonLdNode, item: JsonLdNode | undefined): string[] {
  const urls: string[] = [];
  const image = product['image'];
  if (typeof image === 'string') urls.push(image);
  else if (Array.isArray(image))
    urls.push(...image.filter((u): u is string => typeof u === 'string'));
  const photos = item?.['photo'];
  if (Array.isArray(photos)) {
    for (const photo of photos) {
      const url = (photo as JsonLdNode | undefined)?.['url'];
      if (typeof url === 'string' && url !== '') urls.push(url);
    }
  }
  return [...new Set(urls)];
}

/**
 * Décode le JSON-LD d'une fiche. `null` si la page n'en porte pas.
 *
 * Le bien est sous `offers.itemOffered`, deux niveaux plus bas que chez Apimo :
 * la racine `Product` ne porte que le titre et une description passe-partout
 * engendrée par la plateforme (« Découvrez cet appartement (t2) de 2 pièces
 * situé à Nice »), qui n'apprend rien que les autres champs ne disent déjà.
 */
function parseJsonLd($: cheerio.CheerioAPI): JsonLdData | null {
  const product = findJsonLdNode(collectJsonLdNodes($), ['product']);
  if (product === undefined) return null;
  const offers = product['offers'] as JsonLdNode | undefined;
  const item = offers?.['itemOffered'] as JsonLdNode | undefined;
  const address = item?.['address'] as JsonLdNode | undefined;
  const floorSize = item?.['floorSize'] as JsonLdNode | undefined;
  const images = jsonLdImages(product, item);
  return {
    ...(jsonLdString(product['name']) !== undefined ? { name: jsonLdString(product['name']) } : {}),
    ...(typeof item?.['numberOfRooms'] === 'number' ? { rooms: item['numberOfRooms'] } : {}),
    ...(typeof floorSize?.['value'] === 'number' ? { area: floorSize['value'] } : {}),
    ...(jsonLdString(address?.['addressLocality']) !== undefined
      ? { city: jsonLdString(address?.['addressLocality']) }
      : {}),
    ...(jsonLdString(address?.['postalCode']) !== undefined
      ? { postalCode: jsonLdString(address?.['postalCode']) }
      : {}),
    ...(jsonLdString(offers?.['price']) !== undefined
      ? { price: jsonLdString(offers?.['price']) }
      : {}),
    ...(images.length > 0 ? { imageUrls: images } : {}),
  };
}

/**
 * Les blocs de contenu de la page, dans l'ordre où ils s'affichent.
 *
 * Netty compose ses pages en composants `[data-author="Netty.fr"]` : un
 * intertitre est un composant, le texte qui le suit en est un autre. C'est le
 * seul découpage stable de ces pages — les classes CSS étant hachées.
 *
 * On ne retient que les composants SANS composant imbriqué : un conteneur
 * rendrait le texte de tous ses enfants, et l'on ne saurait plus lequel suit
 * quel intertitre.
 */
function contentBlocks($: cheerio.CheerioAPI): { text: string; html: cheerio.Cheerio<never> }[] {
  const blocks: { text: string; html: cheerio.Cheerio<never> }[] = [];
  $('[data-author="Netty.fr"]').each((_index, element) => {
    const node = $(element) as unknown as cheerio.Cheerio<never>;
    if ($(element).find('[data-author="Netty.fr"]').length > 0) return;
    const text = cleanText($(element).text().replace(/\s+/g, ' '));
    if (text !== '') blocks.push({ text, html: node });
  });
  return blocks;
}

/**
 * La description du bien : le bloc qui suit l'intertitre « Descriptif ».
 *
 * L'intitulé varie d'un thème à l'autre — « Descriptif », « Descriptif du
 * bien » — mais commence toujours par le même mot. On prend ensuite le premier
 * bloc assez long pour être un texte et non une étiquette.
 *
 * `htmlToText` plutôt que `.text()` : la description est écrite en paragraphes
 * séparés par des `<br>`, et c'est cette structure qui permet plus tard d'y
 * repérer une adresse ou une date de disponibilité.
 */
function extractDescription(
  $: cheerio.CheerioAPI,
  blocks: readonly { text: string; html: cheerio.Cheerio<never> }[],
): { description?: string; title?: string } {
  const heading = blocks.findIndex((block) => /^descriptif/i.test(block.text));
  if (heading === -1) return {};
  for (const block of blocks.slice(heading + 1, heading + 4)) {
    if (block.text.length < 80) continue;
    // Certains thèmes portent le VRAI titre de l'annonce en `<h1>` au sommet de
    // la description. Il vaut mieux que le `name` du JSON-LD, qui n'est pas
    // toujours remis à jour : sur une fiche relevée le 2026-09-05, le JSON-LD
    // annonçait « SEPTEMBRE A JUIN 2025 » là où la page disait 2027.
    //
    // Il est RETIRÉ de la description : une description qui commence par son
    // propre titre le fait apparaître deux fois sur la fiche.
    const fragment = block.html.clone();
    const h1 = cleanText(fragment.find('h1').first().text());
    fragment.find('h1').remove();
    const description = htmlToText($, fragment);
    return {
      ...(description !== '' ? { description } : {}),
      ...(h1 !== '' ? { title: h1 } : {}),
    };
  }
  return {};
}

/**
 * Le bloc « informations juridiques & financières », imposé par la loi.
 *
 * C'est le plus riche de la page, et le plus régulier : honoraires, loyer de
 * base, provision sur charges, dépôt de garantie et classes énergie/climat y
 * figurent en toutes lettres, dans une phrase engendrée par la plateforme. Il
 * se reconnaît à son contenu et non à sa place, qui varie selon le thème.
 *
 * ON LE RECONNAÎT À SA TOURNURE MACHINALE, et non au mot « honoraires ». Une
 * description rédigée par l'agence reprend souvent les mêmes informations à sa
 * façon — « Loyer : 670 € par mois charges comprises, dont 112 € de provisions
 * sur charges » —, et c'est elle qui était prise pour le bloc légal quand elle
 * précédait. Or elle n'a pas de forme fixe, là où la phrase engendrée en a une :
 * « Loyer de base X €/mois », « Classe énergie C, Classe climat A ».
 */
function extractLegalMentions(
  blocks: readonly { text: string; html: cheerio.Cheerio<never> }[],
): string | undefined {
  const generated =
    /loyer de base\s+[\d\s.,]+\s*€|classe (?:énergie|energie)\s+[A-G]\s*,\s*classe climat/i;
  return blocks.find((candidate) => generated.test(candidate.text))?.text;
}

/**
 * Les couples intitulé → valeur des listes de caractéristiques.
 *
 * Le balisage est régulier d'un thème à l'autre : un `<li>` contenant
 * exactement DEUX éléments de texte, l'intitulé puis la valeur. On ne cherche
 * aucun intitulé précis — les agences en ajoutent, et chaque thème les nomme un
 * peu autrement — on ramasse tout, et la normalisation y puise ce qu'elle sait
 * reconnaître : étage, chambres, meublé, chauffage, exposition.
 */
function extractCriteria($: cheerio.CheerioAPI): Map<string, string> {
  const criteria = new Map<string, string>();
  $('li').each((_index, element) => {
    const spans = $(element).find('span.textblock');
    if (spans.length !== 2) return;
    const label = cleanText($(spans[0] as never).text()).replace(/\s*:\s*$/, '');
    const value = cleanText($(spans[1] as never).text());
    if (label === '' || value === '' || criteria.has(label)) return;
    criteria.set(label, value);
  });
  return criteria;
}

/** Valeur du premier intitulé reconnu, comparaison sans accents ni casse. */
function criterion(criteria: Map<string, string>, patterns: readonly RegExp[]): string | undefined {
  for (const [label, value] of criteria) {
    const plain = comparable(label);
    if (patterns.some((pattern) => pattern.test(plain))) return value;
  }
  return undefined;
}

/** Slugs de type d'URL désignant un bien NON résidentiel. */
const COMMERCIAL_SLUGS =
  /commerce|bureau|local|atelier|entrepot|fonds|professionnel|industriel|terrain|hangar|garage|parking/;

export interface ParsedDetail {
  readonly listing: RawListing | null;
  readonly warnings: readonly string[];
}

/**
 * Analyse une fiche Netty.
 *
 * @param html contenu HTML brut de la fiche
 * @param pageUrl URL de la fiche
 * @param defaultAgencyName agence à afficher — le JSON-LD Netty ne la nomme pas
 */
export function parseDetailPage(
  html: string,
  pageUrl: string,
  defaultAgencyName: string,
): ParsedDetail {
  const parsedUrl = parseListingUrl(pageUrl);
  if (parsedUrl === null) {
    return { listing: null, warnings: [`URL inattendue pour une fiche : ${pageUrl}`] };
  }
  if (COMMERCIAL_SLUGS.test(parsedUrl.slug)) {
    return { listing: null, warnings: [`Bien à usage commercial (ignoré) : ${pageUrl}`] };
  }

  const $ = cheerio.load(html);
  const jsonLd = parseJsonLd($);
  const blocks = contentBlocks($);
  const { description, title } = extractDescription($, blocks);
  const mentions = extractLegalMentions(blocks);
  const criteria = extractCriteria($);

  // Fiche retirée : ni bien décrit, ni loyer. On ne produit rien plutôt qu'une
  // fiche fantôme (§17).
  if (jsonLd === null || jsonLd.price === undefined) {
    return { listing: null, warnings: [`Fiche sans bien exploitable (ignorée) : ${pageUrl}`] };
  }

  const warnings: string[] = [];
  if (description === undefined) warnings.push(`Fiche sans descriptif : ${pageUrl}`);

  const listing = compactListing({
    sourceRef: parsedUrl.reference,
    sourceUrl: parsedUrl.canonicalUrl,
    title: title ?? jsonLd.name,
    description,
    priceText: `${jsonLd.price} €`,
    // La provision sur charges n'apparaît que dans les mentions légales, jamais
    // dans les caractéristiques : c'est de là qu'il faut la tirer.
    chargesText: chargesFromMentions(mentions) ?? criterion(criteria, [/^charges?$/, /provision/]),
    // La surface des caractéristiques passe AVANT celle du JSON-LD : la
    // plateforme y arrondit à l'entier (22 m² pour 22,05), et le prix au mètre
    // carré s'en ressent.
    areaText:
      criterion(criteria, [/^surface$/]) ??
      (jsonLd.area !== undefined ? `${jsonLd.area} m²` : undefined),
    roomsText:
      jsonLd.rooms !== undefined ? `${jsonLd.rooms} pièces` : criterion(criteria, [/^pieces?$/]),
    propertyTypeText: criterion(criteria, [/type de bien/]) ?? parsedUrl.typeSlug,
    // Netty publie l'ameublement comme critère explicite quand il est renseigné.
    furnishedText: cleanText(
      `${criterion(criteria, [/ameublement/]) ?? ''} ${title ?? ''} ${description ?? ''}`,
    ),
    cityText: jsonLd.city,
    postalCodeText: jsonLd.postalCode ?? parsedUrl.postalCode,
    agencyName: defaultAgencyName,
    phoneText: $('a[href^="tel:"]').first().attr('href')?.replace(/^tel:/, ''),
    contactFormUrl: parsedUrl.canonicalUrl,
    ...(jsonLd.imageUrls !== undefined ? { imageUrls: jsonLd.imageUrls } : {}),
    extra: {
      reference: parsedUrl.reference,
      // `features` est le champ que la normalisation FOUILLE : elle y cherche
      // l'étage, l'ascenseur, le balcon, les chambres, le DPE, le meublé. On y
      // verse les critères ET les mentions légales, seules porteuses des
      // classes énergie et du dépôt de garantie.
      features: [...[...criteria].map(([label, value]) => `${label} : ${value}`), mentions ?? '']
        .filter((part) => part !== '')
        .join(' · '),
    },
  });

  return { listing, warnings };
}

/**
 * La provision sur charges, lue dans les mentions légales.
 *
 * La phrase est engendrée par la plateforme et varie peu : « 100 €/mois de
 * charges forfaitaires », « Provision sur charges 112 €/mois ». On rend le
 * fragment TEL QUEL — c'est la normalisation qui en tire un montant, et elle
 * n'accepte un nombre nu que d'un champ dédié comme celui-ci.
 */
export function chargesFromMentions(mentions: string | undefined): string | undefined {
  if (mentions === undefined) return undefined;
  const match =
    /((?:provisions?\s+(?:sur\s+|pour\s+)?charges?|charges?)\s*:?\s*[\d\s.,]+\s*€(?:\s*\/\s*mois)?)/i.exec(
      mentions,
    ) ?? /(\d[\d\s.,]*\s*€\s*\/\s*mois\s+de\s+charges[^.]*)/i.exec(mentions);
  return match?.[1]?.trim();
}
