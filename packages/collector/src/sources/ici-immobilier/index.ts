/**
 * Source : I.C.I Info Conseil Immobilier (ici-immobilier.com) — agence niçoise
 * (8 place Philippe Randon), sur la plateforme Netty (§47). Demandée
 * explicitement le 2026-09-05 sous le nom « INFO CONSEIL IMMOBILIER ».
 *
 * Elle n'était connue que par la FNAIM, qui n'en relayait qu'une annonce : son
 * propre site en publie davantage, avec la description complète et les mentions
 * légales que le portail tronque.
 *
 * Vérifié le 2026-09-05 : `robots.txt` n'interdit que `/*.pdf` et demande
 * `Crawl-delay: 5` ; sitemap déclaré, 4 fiches de location au relevé.
 *
 * PETIT VOLUME ASSUMÉ : une agence de quartier publie peu, mais tôt, et une
 * source Netty inchangée coûte une requête par passage (§30).
 */

import { makeNettyScraper } from '../netty/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const iciImmobilierScraper = makeNettyScraper({
  id: 'ici-immobilier',
  name: 'I.C.I Info Conseil Immobilier',
  domain: 'ici-immobilier.com',
  sitemapUrl: 'https://www.ici-immobilier.com/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});
