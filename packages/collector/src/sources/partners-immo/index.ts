/**
 * Source : Partners Immo (partners-immo.fr) — agence niçoise sur la plateforme
 * Apimo/Cello (§47).
 *
 * Appartements et maisons.
 *
 * Vérifié le 2026-09-05 avec `scripts/probe-agency.mjs` : robots.txt permissif
 * (seul `/app_dev.php` interdit), signature Apimo confirmée, 33 locations
 * dans les communes cibles au sitemap.
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const partnersImmoScraper = makeApimoScraper({
  id: 'partners-immo',
  name: 'Partners Immo',
  domain: 'partners-immo.fr',
  sitemapUrl: 'https://partners-immo.fr/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});
