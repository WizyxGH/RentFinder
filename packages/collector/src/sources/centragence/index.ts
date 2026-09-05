/**
 * Source : Centragence (centragence.net) — agence niçoise indépendante depuis
 * 2006, sur la plateforme Netty (§47). Demandée explicitement le 2026-09-05.
 *
 * Vérifié le 2026-09-05 : `robots.txt` n'interdit que `/*.pdf` et demande
 * `Crawl-delay: 5` (respecté par le budget de l'adaptateur) ; sitemap déclaré,
 * 25 URL dont 9 fiches de location dans les communes cibles.
 *
 * Fiches particulièrement riches : loyer, provision sur charges, dépôt de
 * garantie, honoraires, classes énergie et climat, étage, exposition,
 * ameublement, et le TYPE DE BAIL — plusieurs annonces sont des locations
 * étudiantes de septembre à juin, que la détection sait désormais reconnaître.
 */

import { makeNettyScraper } from '../netty/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const centragenceScraper = makeNettyScraper({
  id: 'centragence',
  name: 'Centragence',
  domain: 'centragence.net',
  sitemapUrl: 'https://www.centragence.net/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});
