/**
 * Parser des pages « ville » de nousgerons.com (gestion locative en ligne).
 *
 * CONFORMITÉ : `robots.txt` (vérifié le 2026-08-15) explicitement ouvert —
 * `Allow: /` pour tous avec `Crawl-delay: 1`, y compris nommément pour les
 * robots d'IA. Source demandée par l'utilisateur.
 *
 * ANCRAGE : la page `/location/{ville}` embarque un JSON-LD schema.org
 * complet (`CollectionPage > ItemList` de `Product` avec `additionalProperty`
 * pièces/surface/ville et `offers.price`) — balisage SEO stable, seule chose
 * parsée : le rendu visuel est côté client.
 *
 * PARTICULARITÉ : beaucoup d'annonces sont des COLOCATIONS, indiquées dans le
 * `name` (« T4 en colocation – … ») — le champ `flatShare` de la
 * normalisation les distingue des locations classiques.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/** Forme d'une URL de fiche : `/logement/location/{référence}-{slug}`. */
const LISTING_URL_PATTERN =
  /^https?:\/\/(?:www\.)?nousgerons\.com\/logement\/location\/(\d{4,})(?:-[a-z0-9-]*)?\/?(?:[?#].*)?$/i;

export interface ParsedListingUrl {
  readonly reference: string;
  readonly canonicalUrl: string;
}

/** Analyse une URL de fiche. `null` si ce n'en est pas une. */
export function parseListingUrl(href: string): ParsedListingUrl | null {
  const match = LISTING_URL_PATTERN.exec(href.trim());
  if (match?.[1] === undefined) return null;
  return { reference: match[1], canonicalUrl: href.trim().replace(/[?#].*$/, '') };
}

/** `additionalProperty` d'un Product schema.org, indexées par nom. */
function propertyMap(item: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  const properties = item['additionalProperty'];
  if (!Array.isArray(properties)) return map;
  for (const property of properties) {
    const name = (property as { name?: unknown }).name;
    const value = (property as { value?: unknown }).value;
    if (typeof name === 'string') map.set(name, value);
  }
  return map;
}

/** Résultat du parsing d'une page de liste. */
export interface ParsedPage {
  readonly listings: readonly RawListing[];
  readonly hasNextPage: boolean;
  readonly warnings: readonly string[];
}

/** Analyse une page `/location/{ville}` via son JSON-LD. */
export function parseSearchPage(html: string, _pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const byReference = new Map<string, RawListing>();

  $('script[type="application/ld+json"]').each((_index, element) => {
    const raw = $(element).text();
    if (raw.trim() === '') return;

    let graph: unknown[];
    try {
      const parsed: unknown = JSON.parse(raw);
      const candidate = (parsed as { '@graph'?: unknown[] })['@graph'];
      graph = Array.isArray(candidate) ? candidate : [parsed];
    } catch {
      warnings.push('JSON-LD illisible — structure probablement modifiée');
      return;
    }

    for (const node of graph) {
      const mainEntity = (node as { mainEntity?: unknown }).mainEntity;
      const itemList = (mainEntity ?? node) as { itemListElement?: unknown[] };
      if (!Array.isArray(itemList.itemListElement)) continue;

      for (const listItem of itemList.itemListElement) {
        const item = (listItem as { item?: Record<string, unknown> }).item;
        if (item === undefined || typeof item['url'] !== 'string') continue;

        const parsedUrl = parseListingUrl(item['url']);
        if (parsedUrl === null || byReference.has(parsedUrl.reference)) continue;

        const properties = propertyMap(item);
        const name = typeof item['name'] === 'string' ? cleanText(item['name']) : '';
        const offers = item['offers'] as Record<string, unknown> | undefined;
        const price = offers?.['price'];
        const rooms = properties.get('Nombre de pièces');
        const areaValue = properties.get('Surface habitable');
        const cityValue = properties.get('Ville');
        const typeValue = properties.get('Type de bien');
        const image = item['image'];

        const listing: RawListing = {
          sourceRef: parsedUrl.reference,
          sourceUrl: parsedUrl.canonicalUrl,
          ...(name !== '' ? { title: name } : {}),
          ...(typeof price === 'string' || typeof price === 'number'
            ? { priceText: `${price} €` }
            : {}),
          // `Surface habitable` est documentée en m² (`unitCode: MTK`).
          ...(typeof areaValue === 'number' ? { areaText: `${areaValue} m²` } : {}),
          ...(typeof rooms === 'number' ? { roomsText: `${rooms} pièces` } : {}),
          propertyTypeText: `${typeof typeValue === 'string' ? typeValue : ''} ${name}`,
          furnishedText: name,
          ...(typeof cityValue === 'string' ? { cityText: cityValue } : {}),
          agencyName: 'NousGérons',
          // §21 : la fiche (messagerie du site) est le canal de contact prévu.
          contactFormUrl: parsedUrl.canonicalUrl,
          ...(typeof image === 'string' && image.startsWith('http') ? { imageUrls: [image] } : {}),
          extra: { reference: parsedUrl.reference },
        };

        byReference.set(parsedUrl.reference, listing);
      }
    }
  });

  const listings = [...byReference.values()];

  // §61 : une page sans aucun JSON-LD exploitable est signalée par le warning
  // ci-dessus ; une liste vide est aussi possible (aucun bien à la location).
  if (listings.length > 0) {
    const withPrice = listings.filter((listing) => listing.priceText !== undefined).length;
    if (withPrice === 0) {
      warnings.push('Aucune annonce ne contient de prix — structure probablement modifiée');
    }
  }

  return { listings, hasNextPage: false, warnings };
}
