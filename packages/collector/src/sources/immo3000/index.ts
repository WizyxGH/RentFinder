/**
 * Source : Immo 3000 (immo3000.com) — agence niçoise sur la plateforme
 * Apimo/Cello (§47).
 *
 * Uniquement des appartements dans les communes cibles — une agence de
 * logement, sans le bruit des locaux commerciaux.
 *
 * Vérifié le 2026-09-05 avec `scripts/probe-agency.mjs` : robots.txt permissif
 * (seul `/app_dev.php` interdit), signature Apimo confirmée, 63 locations
 * dans les communes cibles au sitemap.
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const immo3000Scraper = makeApimoScraper({
  id: 'immo3000',
  name: 'Immo 3000',
  domain: 'immo3000.com',
  sitemapUrl: 'https://immo3000.com/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
  maxDetailsBackfill: 30,
});
