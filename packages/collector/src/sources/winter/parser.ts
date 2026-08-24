/**
 * Source : Winter Immobilier (agence-winter.com) — agence niçoise. Repérée le
 * 2026-08-24 via les e-mails de confirmation SeLoger.
 *
 * Site custom (Ruby on Rails), page `/louer` en SSR : chaque carte
 * (`div.anim-fade-up`) porte la ville, le titre (typologie/pièces/meublé), le
 * prix et un lien `/biens/a-louer-…-{id}`. On parse la LISTE en une requête, pas
 * de visite de fiche (§30). robots.txt permissif pour /biens (n'interdit que
 * /admin/, les tris et les PDF). La surface n'est pas toujours affichée : on la
 * prend dans le slug de l'URL quand il la porte, sinon on n'invente rien (§17).
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

export interface ParsedList {
  readonly listings: readonly RawListing[];
  readonly warnings: readonly string[];
}

type RawDraft = { [K in keyof RawListing]?: RawListing[K] | undefined };

function compact(draft: RawDraft): RawListing {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as RawListing;
}

/** Surface « 114-72-m » ou « 25-m » dans le slug → « 114.72 m² ». */
function areaFromSlug(slug: string): string | undefined {
  const match = /(\d+(?:-\d+)?)-m(?:-|$)/i.exec(slug);
  if (match?.[1] === undefined) return undefined;
  return `${match[1].replace('-', '.')} m²`;
}

function buildListing(fields: {
  reference: string;
  sourceUrl: string;
  slug: string;
  title: string;
  city: string;
  price: string;
  image: string | undefined;
  agencyName: string;
}): RawListing {
  const { reference, sourceUrl, slug, title, city, price, image, agencyName } = fields;
  const hay = `${title} ${slug}`;
  return compact({
    sourceRef: reference,
    sourceUrl,
    title: cleanText(title) || undefined,
    priceText: price || undefined,
    areaText: /[\d.,]+\s*m²/i.exec(title)?.[0] ?? areaFromSlug(slug),
    roomsText:
      /(\d+)\s*pi[eè]ces?/i.exec(hay)?.[0] ?? (/\bstudio\b/i.test(hay) ? 'studio' : undefined),
    propertyTypeText: /appartement|maison|studio|villa|duplex|loft/i.exec(hay)?.[0],
    furnishedText: /\bmeubl[ée]/i.test(hay) ? 'meublé' : undefined,
    cityText: cleanText(city) || undefined,
    agencyName,
    contactFormUrl: sourceUrl,
    imageUrls: image !== undefined && /^https?:/i.test(image) ? [image] : undefined,
    extra: { reference },
  });
}

/** Image de la carte : la source WebP du `<picture>`, sinon l'`<img>`. */
function cardImage($card: cheerio.Cheerio<never>, pageUrl: string): string | undefined {
  const raw =
    $card.find('source[srcset]').attr('srcset')?.split(/\s+/)[0] ??
    $card.find('img[src]').attr('src');
  if (raw === undefined || raw === '') return undefined;
  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return undefined;
  }
}

/** Parse la page `/louer` et rend une annonce par carte. */
export function parseListPage(html: string, pageUrl: string, agencyName: string): ParsedList {
  const $ = cheerio.load(html);
  const bySourceRef = new Map<string, RawListing>();

  $('a[href*="/biens/a-louer"]').each((_i, el) => {
    const link = $(el);
    const href = link.attr('href') ?? '';
    const reference = /-(\d{2,})(?:\?|$)/.exec(href)?.[1] ?? null;
    if (reference === null || bySourceRef.has(reference)) return;

    let sourceUrl: string;
    try {
      sourceUrl = new URL(href, pageUrl).toString();
    } catch {
      return;
    }

    // La carte englobe le lien, le titre (h3), la ville et le prix.
    const card = link.closest('div.anim-fade-up');
    const container = card.length > 0 ? card : link.parent();
    const price = cleanText(
      container
        .find('p')
        .filter((_j, p) => /€/.test($(p).text()))
        .first()
        .text()
        .replace(/\s+/g, ' '),
    );

    bySourceRef.set(
      reference,
      buildListing({
        reference,
        sourceUrl,
        slug: href,
        title: cleanText(container.find('h3').first().text().replace(/\s+/g, ' ')),
        city: cleanText(container.find('p.uppercase, .uppercase small').first().text()),
        price,
        image: cardImage(container as cheerio.Cheerio<never>, pageUrl),
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
