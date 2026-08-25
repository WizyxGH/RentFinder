/**
 * Source : Agence Privilège (agenceprivilege.com) — agence niçoise sur Apimo,
 * mais ANCIEN schéma d'URL : les fiches sont `/fr/propriété/{id}` (accentué,
 * souvent %-encodé), sans slug ville/type, et le sitemap mélange ventes et
 * locations sans marqueur. On ne peut donc PAS filtrer par le sitemap comme les
 * autres sources Apimo.
 *
 * En revanche la page `/fr/locations` liste, en HTML, les liens des fiches de
 * LOCATION. On y récupère donc les références, puis on visite chaque fiche : le
 * détail est du JSON-LD Apimo standard (prix, surface, adresse), parsé par
 * `parseApimoDetail`. Ce module ne fait QUE l'extraction des liens de la liste.
 */

import * as cheerio from 'cheerio';

export interface LocationLink {
  readonly reference: string;
  readonly canonicalUrl: string;
}

/** `/fr/propriété/{id}` avec accent littéral ou %-encodé (`%C3%A9`). */
const PROPERTY_HREF = /\/fr\/propri(?:%C3%A9|é)t(?:%C3%A9|é)\/(\d{4,})/i;

/** Liens de fiches de location trouvés sur la page `/fr/locations`. */
export function parseLocationLinks(html: string, pageUrl: string): LocationLink[] {
  const $ = cheerio.load(html);
  const byRef = new Map<string, LocationLink>();

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const reference = PROPERTY_HREF.exec(href)?.[1];
    if (reference === undefined || byRef.has(reference)) return;
    try {
      const canonicalUrl = new URL(href, pageUrl).toString().replace(/[?#].*$/, '');
      byRef.set(reference, { reference, canonicalUrl });
    } catch {
      /* href inexploitable : on ignore */
    }
  });

  return [...byRef.values()];
}
