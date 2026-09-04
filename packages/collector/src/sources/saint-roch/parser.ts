/**
 * Source : Saint Roch Immobilier (saintrochimmobilier.com) — agence niçoise
 * (quartier Saint-Roch), site ASP maison server-rendered.
 *
 * Vérifié le 2026-08-18 : robots.txt n'interdit que l'admin et les endpoints de
 * formulaires (dont `/moteur_recherche.asp`, NON utilisé ici) ; la page liste
 * `/location-immobilier-nice.asp` et les fiches `/annonce/location-….asp` sont
 * libres. Fiches riches : loyer CC + provision de charges, DPE/GES en toutes
 * lettres (classe CSS `colorDPE{X}`), photos, description.
 *
 * Particularité : le site publie aussi des biens à St-Dié-des-Vosges (autre
 * agence du réseau familial) — seules les fiches des communes cibles sont
 * visitées.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';
import { htmlToText } from '../shared/html-text.js';
import { compactListing } from '../shared/raw-listing.js';

/**
 * URL de fiche : `/annonce/location-{type}[-{ville}]-{réf}.asp`, où la
 * référence est un code `L…` pouvant contenir des parenthèses —
 * ex. `location-appartement-nice-L00015(A02F).asp`, `location-garage-L00287(1046).asp`.
 */
const FICHE_PATTERN =
  /\/annonce\/location-([a-z][a-z-]*?)-(L[A-Z0-9]*\d[A-Z0-9]*(?:\([^)]*\))?)\.asp$/i;

/** Types de biens dont la fiche mérite une requête (§30 : pas les parkings…). */
const RESIDENTIAL_TYPES = /^(appartement|studio|maison|villa|duplex|loft|immeuble)/i;

export interface ParsedSaintRochUrl {
  readonly reference: string;
  readonly canonicalUrl: string;
  /** Segment type[-ville] de l'URL, ex. `appartement-nice`. */
  readonly slug: string;
}

/** Analyse une URL de fiche. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string, baseUrl: string): ParsedSaintRochUrl | null {
  let resolved: URL;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return null;
  }
  if (new URL(baseUrl).hostname !== resolved.hostname) return null;

  const match = FICHE_PATTERN.exec(decodeURIComponent(resolved.pathname));
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return {
    reference: match[2],
    canonicalUrl: `${resolved.origin}${resolved.pathname}`,
    slug: match[1].toLowerCase(),
  };
}

/**
 * `true` si la fiche est un logement d'une commune cible. Les biens sans ville
 * dans l'URL (garages…) et les autres villes du réseau (St-Dié) sont écartés.
 */
export function isTargetListing(url: ParsedSaintRochUrl, citySlugs: readonly string[]): boolean {
  if (!RESIDENTIAL_TYPES.test(url.slug)) return false;
  return citySlugs.some((city) => url.slug.endsWith(`-${city}`) || url.slug.includes(`-${city}-`));
}

export interface ParsedList {
  readonly urls: readonly ParsedSaintRochUrl[];
  readonly warnings: readonly string[];
}

/** Extrait les liens de fiches d'une page de liste. */
export function parseListPage(html: string, pageUrl: string): ParsedList {
  const $ = cheerio.load(html);
  const seen = new Map<string, ParsedSaintRochUrl>();

  $('a[href]').each((_i, el) => {
    const parsed = parseListingUrl($(el).attr('href') ?? '', pageUrl);
    if (parsed !== null && !seen.has(parsed.reference)) seen.set(parsed.reference, parsed);
  });

  const urls = [...seen.values()];
  return {
    urls,
    warnings: urls.length === 0 ? [`Aucune fiche trouvée sur la liste : ${pageUrl}`] : [],
  };
}

export interface ParsedDetail {
  readonly listing: RawListing | null;
  readonly warnings: readonly string[];
}

/** Analyse une fiche bien et en extrait l'annonce. */
/**
 * Mots qui désignent le BIEN et non un quartier. Aucun quartier de Nice ne
 * s'appelle « Studio » ni « Appartement ».
 */
const PROPERTY_TYPE_WORD =
  /\b(studio|studette|appartement|appart|maison|villa|loft|duplex|pi[eè]ces?|chambre|parking|garage|local|bureau)\b/i;

export function parseDetailPage(html: string, pageUrl: string, agencyName: string): ParsedDetail {
  const parsedUrl = parseListingUrl(pageUrl, pageUrl);
  if (parsedUrl === null) {
    return { listing: null, warnings: [`URL inattendue pour une fiche : ${pageUrl}`] };
  }

  const $ = cheerio.load(html);
  const warnings: string[] = [];

  // h1 « Nice Saint Roch 6 Pieces de 136.57m² » : pièces + surface.
  const title = cleanText($('h1').first().text().replace(/\s+/g, ' '));
  const description = htmlToText($, '.property-desc');

  // « Loyer: 2 110€/mois c.c., dont : 110€ de provision pour charges… »
  // (cheerio a déjà décodé &euro;). Le texte est reformulé en jeton « CC » que
  // la normalisation comprend.
  const loyer = description.match(
    /loyer\s*:?\s*([\d\s.,]+)\s*€\s*(?:\/|par)?\s*mois\s*(c\.?c\.?|charges? comprises?)?/i,
  );
  const priceText =
    loyer?.[1] !== undefined
      ? `${loyer[1].trim()} € par mois${loyer[2] !== undefined ? ' CC' : ''}`
      : undefined;
  if (priceText === undefined) warnings.push(`Fiche sans loyer lisible : ${pageUrl}`);

  const chargesMatch = description.match(
    /([\d\s.,]+)\s*€\s*de provision pour charges|provision pour charges\s*:?\s*([\d\s.,]+)\s*€/i,
  );
  const chargesAmount = chargesMatch?.[1] ?? chargesMatch?.[2];

  // COORDONNÉES DU BIEN. La fiche porte une carte, et l'adresse de son
  // iframe contient la position : `/googlemapPOI.asp?long=…&lat=…`. Vérifié
  // le 2026-09-04 sur les cinq annonces en ligne — cinq points distincts,
  // tous dans Nice : c'est bien le logement qui est situé, et non l'agence,
  // comme chez d'autres sources où le même point revient partout (§17, §20).
  //
  // C'est la seule position exacte que Saint Roch publie : ni rue ni numéro
  // n'apparaissent ailleurs sur la page.
  const point = /googlemapPOI\.asp\?long=(-?\d+\.\d+)&(?:amp;)?lat=(-?\d+\.\d+)/i.exec(html);
  const longitude = point?.[1] !== undefined ? Number(point[1]) : undefined;
  const latitude = point?.[2] !== undefined ? Number(point[2]) : undefined;

  // QUARTIER. Le h1 s'ouvre sur la ville puis le quartier, sous deux formes
  // selon l'âge de la fiche : « Nice Saint Roch - Studio meublé - 22.81m² »
  // et « Nice Saint Roch 3 Pieces de 64.57m² ». Dans les deux cas le quartier
  // s'arrête au premier tiret OU au premier chiffre.
  //
  // Encore faut-il que ce soit un quartier : « Nice Studio meublé 22m² » n'en
  // nomme aucun, et la même découpe y attraperait le type du bien. On refuse
  // donc ce qui ressemble à un type plutôt que d'inventer un lieu (§17).
  const districtMatch = /^\s*Nice\s+([^-–—\d]{2,40}?)\s*(?:[-–—]|\d)/i.exec(title);
  const candidate = districtMatch?.[1]?.trim();
  const district =
    candidate !== undefined && !PROPERTY_TYPE_WORD.test(candidate) ? candidate : undefined;

  // DPE/GES : lettre portée par la classe CSS de la cellule du bilan.
  const dpe = /colorDPE([A-G])\b/.exec(html)?.[1] ?? null;

  const imageUrls: string[] = [];
  $('img[src*="/photos/"]').each((_i, el) => {
    const src = $(el).attr('src') ?? '';
    try {
      const absolute = new URL(src, pageUrl).toString();
      if (!imageUrls.includes(absolute)) imageUrls.push(absolute);
    } catch {
      /* src illisible : photo ignorée */
    }
  });

  // Ville depuis le slug d'URL (« appartement-nice » → « nice ») : le h1 la
  // répète mais mélangé au quartier.
  const cityFromSlug = parsedUrl.slug.split('-').slice(1).join(' ') || undefined;

  // Téléphone de l'agence, publié en pied de fiche (§21).
  const phoneMatch = html.match(/Tel\s*:?\s*((?:0\d[\s.]?){5})/i)?.[1];

  const listing = compactListing({
    sourceRef: parsedUrl.reference,
    sourceUrl: parsedUrl.canonicalUrl,
    title: title !== '' ? title : undefined,
    description: description !== '' ? description : undefined,
    priceText,
    chargesText: chargesAmount !== undefined ? `${chargesAmount.trim()} € de charges` : undefined,
    areaText: title.match(/\d+(?:[.,]\d+)?\s*m²/)?.[0],
    roomsText: title.match(/\d+\s*pi[eè]ces?/i)?.[0],
    propertyTypeText: parsedUrl.slug,
    furnishedText: description,
    cityText: cityFromSlug,
    latitude,
    longitude,
    agencyName,
    phoneText: phoneMatch,
    contactFormUrl: parsedUrl.canonicalUrl,
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    extra: {
      reference: parsedUrl.reference,
      ...(dpe !== null ? { dpe: `DPE ${dpe}` } : {}),
      ...(district !== undefined ? { quartier: district } : {}),
    },
  });

  return { listing, warnings };
}
