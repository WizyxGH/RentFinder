/**
 * Source : Cimiez Boulevard (cimiez-boulevard.fr) — agence niçoise.
 * Voir la fiche d'étude dans `docs/sources.md`.
 *
 * PREMIÈRE SOURCE HORS PLATEFORME CONNUE. Les cinq dernières agences ajoutées
 * étaient sur Apimo, où une entrée de configuration suffit. Celle-ci a son
 * propre site, d'où ce parseur ; il ne se réutilisera pas ailleurs, et c'est
 * assumé — sept annonces à Nice, mais parmi les mieux renseignées de
 * l'inventaire.
 *
 * L'URL PORTE LE QUARTIER, ce qu'aucune autre source ne fait aussi
 * franchement :
 *
 *   /properties/nice/cimiez/location/appartement-4-pieces-118m2-fr2182957
 *              ville quartier  transaction  type   pièces surface   référence
 *
 * La couverture des quartiers plafonne à 16 % sur l'inventaire ; ici elle est
 * de cent pour cent, sans deviner quoi que ce soit (§17, §20).
 *
 * DEUX DESCRIPTIONS COEXISTENT sur la page, et c'est le piège. Celle du
 * JSON-LD est TRONQUÉE à cent soixante caractères, suivie de « … » ; la
 * complète vit dans une expression Alpine.js (`descriptionText: '…'`), en
 * échappement JavaScript. C'est la seconde qu'il faut, parce que c'est elle qui
 * porte « Loyer mensuel : 1 840 € (dont 440 € de charges) », la caution et les
 * honoraires — soit exactement ce que le reste de l'inventaire n'a pas.
 */

import * as cheerio from 'cheerio';
import { cleanText } from '../../normalization/text.js';
import type { RawListing } from '@rentfinder/shared';
import { compactListing } from '../shared/raw-listing.js';
import { sitemapUrls } from '../shared/sitemap.js';

/** `/properties/<ville>/<quartier>/<transaction>/<slug>-fr<référence>`. */
const LISTING_PATH =
  /^\/properties\/([a-z0-9-]+)\/([a-z0-9-]+)\/(location|vente)\/([a-z0-9-]+)-fr(\d+)\/?$/i;

export interface ParsedListingUrl {
  readonly citySlug: string;
  /** Quartier, tel que le site le nomme dans l'adresse (« cimiez »). */
  readonly districtSlug: string;
  readonly transaction: 'location' | 'vente';
  readonly typeSlug: string;
  readonly reference: string;
  readonly canonicalUrl: string;
}

/** Sépare une adresse de fiche, ou `null` si ce n'en est pas une. */
export function parseListingUrl(href: string): ParsedListingUrl | null {
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    return null;
  }
  const match = LISTING_PATH.exec(path);
  if (match === null) return null;

  const [, citySlug, districtSlug, transaction, slug, reference] = match;
  if (
    citySlug === undefined ||
    districtSlug === undefined ||
    transaction === undefined ||
    slug === undefined ||
    reference === undefined
  ) {
    return null;
  }

  return {
    citySlug: citySlug.toLowerCase(),
    districtSlug: districtSlug.toLowerCase(),
    transaction: transaction.toLowerCase() as 'location' | 'vente',
    // Le type est le premier mot du slug : « appartement-4-pieces-118m2 ».
    typeSlug: (slug.split('-')[0] ?? '').toLowerCase(),
    reference,
    canonicalUrl: href.trim().replace(/[?#].*$/, ''),
  };
}

/** Les fiches de LOCATION d'un sitemap. Les ventes et pages éditoriales sortent. */
export function parseSitemap(xml: string): ParsedListingUrl[] {
  const entries: ParsedListingUrl[] = [];
  for (const { loc } of sitemapUrls(xml)) {
    const url = parseListingUrl(loc);
    if (url !== null && url.transaction === 'location') entries.push(url);
  }
  return entries;
}

/** Un nœud JSON-LD, lu sans rien supposer de sa forme. */
type JsonNode = Record<string, unknown>;

function jsonLdProduct($: cheerio.CheerioAPI): JsonNode | null {
  let found: JsonNode | null = null;
  $('script[type="application/ld+json"]').each((_index, element) => {
    if (found !== null) return;
    try {
      const parsed = JSON.parse($(element).text()) as JsonNode;
      if (parsed['@type'] === 'Product') found = parsed;
    } catch {
      // Bloc illisible : on passe au suivant plutôt que de faire tomber la
      // collecte pour une virgule (§69).
    }
  });
  return found;
}

/**
 * La description COMPLÈTE, extraite de l'expression Alpine.js.
 *
 * Le texte y est doublement échappé : en JavaScript (`\u00e9` pour « é »,
 * `\/` pour « / ») puis en HTML (`\u003Cbr \/\u003E` pour un `<br />`). On
 * défait les deux couches, puis on rend les sauts de ligne — sans quoi les
 * lignes « Loyer mensuel », « Caution » et « Honoraires » se colleraient en
 * une seule phrase illisible.
 */
export function parseFullDescription(html: string): string | undefined {
  const start = html.indexOf("descriptionText: '");
  if (start === -1) return undefined;
  const from = start + "descriptionText: '".length;

  // Fin de la chaîne : la première apostrophe non échappée.
  let end = from;
  while (end < html.length) {
    if (html[end] === "'" && html[end - 1] !== '\\') break;
    end += 1;
  }
  if (end >= html.length) return undefined;

  const raw = html.slice(from, end);
  const unescaped = raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/\\\//g, '/')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '');

  const text = unescaped
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text === '' ? undefined : text;
}

/** Valeur d'un `additionalProperty` du JSON-LD, par son intitulé. */
function additional(product: JsonNode | null, label: RegExp): string | undefined {
  const list = product?.['additionalProperty'];
  if (!Array.isArray(list)) return undefined;
  for (const entry of list as JsonNode[]) {
    const name = typeof entry['name'] === 'string' ? entry['name'] : '';
    if (label.test(name)) {
      const value = entry['value'];
      if (typeof value === 'string' || typeof value === 'number') return String(value);
    }
  }
  return undefined;
}

function offerPrice(product: JsonNode | null): string | undefined {
  const offers = product?.['offers'];
  if (offers === null || typeof offers !== 'object') return undefined;
  const price = (offers as JsonNode)['price'];
  return typeof price === 'string' || typeof price === 'number' ? `${String(price)} €` : undefined;
}

function coordinates(product: JsonNode | null): { latitude?: number; longitude?: number } {
  const geo = product?.['geo'];
  if (geo === null || typeof geo !== 'object') return {};
  const node = geo as JsonNode;
  const latitude = Number(node['latitude']);
  const longitude = Number(node['longitude']);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : {};
}

/**
 * Les photos de la fiche.
 *
 * §11 : seules les URL sont conservées, jamais les images. Le gabarit sert la
 * même photo en plusieurs tailles (`_1200x630`, `_820x864`) et mêle des
 * portraits de l'équipe : on ne garde que ce qui vient du dossier média ET
 * porte le slug de l'annonce, ce qui écarte les deux.
 */
function images(html: string, slug: string): string[] {
  const all = [
    ...new Set(
      [...html.matchAll(/https:\/\/cimiez-boulevard\.fr\/media\/[^\s"'\\)]+\.(?:jpe?g|png|webp)/gi)]
        .map((match) => match[0])
        .filter((url) => url.toLowerCase().includes(slug.split('-')[0] ?? '')),
    ),
  ];
  return all.slice(0, 12);
}

/** Une fiche complète, ou `null` si la page ne porte pas d'annonce (§17). */
export function parseDetailPage(
  html: string,
  parsedUrl: ParsedListingUrl,
  agencyName: string,
): { listing: RawListing | null; warnings: string[] } {
  const $ = cheerio.load(html);
  const product = jsonLdProduct($);
  const warnings: string[] = [];

  const priceText = offerPrice(product);
  const title = typeof product?.['name'] === 'string' ? cleanText(product['name']) : undefined;

  // Ni prix ni titre : la page n'est pas (ou plus) une annonce.
  if (priceText === undefined && title === undefined) {
    return {
      listing: null,
      warnings: [`Fiche sans annonce exploitable : ${parsedUrl.canonicalUrl}`],
    };
  }
  if (priceText === undefined) warnings.push(`Fiche sans prix : ${parsedUrl.canonicalUrl}`);

  const description = parseFullDescription(html);
  if (description === undefined) {
    // La description tronquée du JSON-LD reste préférable à rien, mais elle
    // perd les charges et la caution : on le signale.
    warnings.push(`Description complète introuvable : ${parsedUrl.canonicalUrl}`);
  }
  const fallback =
    typeof product?.['description'] === 'string' ? cleanText(product['description']) : undefined;
  const finalDescription = description ?? fallback;

  const listing = compactListing({
    sourceRef: parsedUrl.reference,
    sourceUrl: parsedUrl.canonicalUrl,
    title,
    description: finalDescription,
    priceText,
    areaText: additional(product, /surface/i),
    roomsText: additional(product, /pi[eè]ce/i),
    propertyTypeText: parsedUrl.typeSlug,
    // « Location non meublée » figure dans la description complète.
    furnishedText: finalDescription,
    cityText: parsedUrl.citySlug.replace(/-/g, ' '),
    ...coordinates(product),
    agencyName,
    contactFormUrl: parsedUrl.canonicalUrl,
    imageUrls: images(html, parsedUrl.typeSlug),
    extra: {
      reference: parsedUrl.reference,
      citySlug: parsedUrl.citySlug,
      // Le quartier vient de l'ADRESSE, pas d'une déduction : c'est le site
      // qui le nomme. La clé est `quartier` — c'est celle que la normalisation
      // consulte, avant de se rabattre sur une tournure du texte.
      quartier: parsedUrl.districtSlug.replace(/-/g, ' '),
    },
  });

  return { listing, warnings };
}
