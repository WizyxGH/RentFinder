/**
 * Lecture d'un sitemap XML.
 *
 * La même boucle existait en trois exemplaires — Apimo, Lamy, et l'index des
 * sitemaps d'Apimo — avec à chaque fois la même expression pour extraire un
 * `<loc>`, y compris le `CDATA` que certains générateurs y ajoutent. Trois
 * copies d'une expression, c'est trois occasions qu'elles divergent le jour où
 * un site change sa mise en forme.
 *
 * On ne rend ici que ce qu'un sitemap CONTIENT — une URL, une date de dernière
 * modification. Ce qu'il faut en garder est l'affaire de chaque source : Apimo
 * ne retient que les locations, Lamy tout ce qui ressemble à une annonce.
 */

/** Une entrée `<url>` : l'adresse, et sa date si elle est déclarée. */
export interface SitemapUrl {
  readonly loc: string;
  /** `null` quand le sitemap ne la publie pas — on n'invente pas de date (§17). */
  readonly lastmod: string | null;
}

/**
 * `<loc>` avec ou sans `CDATA`. La classe `[^\]<]` s'arrête aussi bien sur le
 * crochet fermant du `CDATA` que sur la balise suivante.
 */
const LOC = /<loc>(?:<!\[CDATA\[)?([^\]<]+?)(?:\]\]>)?<\/loc>/;
const LASTMOD = /<lastmod>([^<]+)<\/lastmod>/;

/** Les entrées `<url>` d'un sitemap. */
export function sitemapUrls(xml: string): SitemapUrl[] {
  const entries: SitemapUrl[] = [];
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/g) ?? []) {
    const loc = LOC.exec(block)?.[1];
    if (loc === undefined) continue;
    entries.push({ loc: loc.trim(), lastmod: LASTMOD.exec(block)?.[1]?.trim() ?? null });
  }
  return entries;
}

/** Les adresses `<sitemap>` d'un index de sitemaps. */
export function sitemapIndexUrls(xml: string): string[] {
  const urls: string[] = [];
  for (const block of xml.match(/<sitemap>[\s\S]*?<\/sitemap>/g) ?? []) {
    const loc = LOC.exec(block)?.[1];
    if (loc !== undefined) urls.push(loc.trim());
  }
  return urls;
}
