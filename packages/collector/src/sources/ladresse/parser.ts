/**
 * Source : L'Adresse (ladresse.com) — réseau coopératif d'agences, demandé
 * explicitement. Agence de Nice.
 *
 * Vérifié le 2026-08-22 : robots.txt permissif (n'interdit que /admin/, /page/,
 * /conf/…). La page de résultats `/recherche/location/appartement/nice-06000`
 * est en SSR et porte TOUT sur chaque carte (`a.bien`) : prix charges comprises,
 * type, pièces/chambres, surface, ville/CP (dans l'`alt` de la photo), photo et
 * lien `/annonce/location/…/{id}`. On parse donc la LISTE en une requête — pas
 * de visite de fiche (§30). Pas de JSON-LD.
 *
 * La page inclut aussi des communes voisines (Cannes, Le Cannet, Mandelieu) :
 * elles sont conservées telles quelles et écartées ensuite par le scoring de
 * ville (§16), comme pour les autres sources multi-communes.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/** Type de bien depuis le libellé français de la carte. */
const TYPE_LABELS = /appartement|maison|studio|villa|duplex|loft|chambre/i;

export interface ParsedList {
  readonly listings: readonly RawListing[];
  readonly warnings: readonly string[];
}

/** Brouillon : champs de `RawListing` tous facultatifs, `undefined` toléré. */
type RawDraft = { [K in keyof RawListing]?: RawListing[K] | undefined };

/** Retire les champs `undefined` et fige en `RawListing`. */
function compact(draft: RawDraft): RawListing {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as RawListing;
}

/**
 * Compose l'annonce à partir des champs déjà extraits d'une carte. Isolé pour
 * garder la boucle de parsing simple (complexité).
 */
function buildListing(fields: {
  reference: string;
  sourceUrl: string;
  alt: string;
  typeText: string;
  description: string;
  geo: string;
  price: string;
  image: string | undefined;
  agencyName: string;
}): RawListing {
  const { reference, sourceUrl, alt, typeText, description, geo, price, image, agencyName } =
    fields;
  return compact({
    sourceRef: reference,
    sourceUrl,
    title: cleanText(alt) || undefined,
    description: description || undefined,
    priceText: price || undefined,
    // Surface/pièces : dans la description, sinon dans l'alt.
    areaText: (description.match(/[\d.,]+\s*m²/i) ?? alt.match(/[\d.,]+\s*m²/i))?.[0],
    roomsText: (description.match(/\d+\s*pi[eè]ces?/i) ?? alt.match(/\d+\s*pi[eè]ces?/i))?.[0],
    propertyTypeText: TYPE_LABELS.test(typeText) ? typeText : undefined,
    // Ville : depuis l'alt « {Type} {VILLE} ({CP}) … » — fiable (le `.bien-geo`
    // vaut parfois « à 33 km de Nice » pour les communes lointaines, trompeur).
    // CP depuis l'alt aussi.
    cityText:
      /^\S+\s+(.+?)\s*\(\d{5}\)/.exec(alt)?.[1]?.trim() ||
      geo.replace(/\s*\(\d+\)\s*$/, '').trim() ||
      undefined,
    postalCodeText: /\((\d{5})\)/.exec(alt)?.[1],
    agencyName,
    contactFormUrl: sourceUrl,
    imageUrls: image !== undefined && /^https?:/i.test(image) ? [image] : undefined,
    extra: { reference },
  });
}

/** Parse la page de résultats et rend une annonce par carte `a.bien`. */
export function parseListPage(html: string, pageUrl: string, agencyName: string): ParsedList {
  const $ = cheerio.load(html);
  const bySourceRef = new Map<string, RawListing>();

  $('a.bien[href]').each((_i, el) => {
    const card = $(el);
    const href = card.attr('href') ?? '';
    const reference = card.attr('data-id') ?? /\/(\d{4,})(?:\?|$)/.exec(href)?.[1] ?? null;
    if (reference === null || bySourceRef.has(reference)) return;
    let sourceUrl: string;
    try {
      sourceUrl = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    bySourceRef.set(
      reference,
      buildListing({
        reference,
        sourceUrl,
        alt: card.find('img[alt]').attr('alt') ?? '',
        typeText: cleanText(card.find('.bien-type').text()),
        description: cleanText(card.find('.bien-description').text().replace(/\s+/g, ' ')),
        geo: cleanText(card.find('.bien-geo').text().replace(/\s+/g, ' ')),
        price: cleanText(card.find('.bien-prix').text().replace(/\s+/g, ' ')),
        image: card.find('img[src]').attr('src'),
        agencyName,
      }),
    );
  });

  const listings = [...bySourceRef.values()];
  return {
    listings,
    warnings: listings.length === 0 ? [`Aucune annonce sur la liste : ${pageUrl}`] : [],
  };
}
