/**
 * Source : Agence Longchamp (agencelongchamp.com) — agence niçoise sur la plateforme
 * Apimo/Cello (§47).
 *
 * Petit volume, dominé par les commerces ; une dizaine de logements.
 *
 * Vérifié le 2026-09-05 avec `scripts/probe-agency.mjs` : robots.txt permissif
 * (seul `/app_dev.php` interdit), signature Apimo confirmée, 10 locations
 * dans les communes cibles au sitemap.
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const agenceLongchampScraper = makeApimoScraper({
  id: 'agence-longchamp',
  name: 'Agence Longchamp',
  domain: 'agencelongchamp.com',
  sitemapUrl: 'https://agencelongchamp.com/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});
