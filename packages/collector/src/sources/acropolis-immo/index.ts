/**
 * Source : Acropolis Immobilier (acropolisimmo.com) — agence niçoise sur la plateforme
 * Apimo/Cello (§47).
 *
 * Appartements, parkings et locaux : volume régulier.
 *
 * Vérifié le 2026-09-05 avec `scripts/probe-agency.mjs` : robots.txt permissif
 * (seul `/app_dev.php` interdit), signature Apimo confirmée, 49 locations
 * dans les communes cibles au sitemap.
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const acropolisImmoScraper = makeApimoScraper({
  id: 'acropolis-immo',
  name: 'Acropolis Immobilier',
  domain: 'acropolisimmo.com',
  sitemapUrl: 'https://acropolisimmo.com/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
  maxDetailsBackfill: 25,
});
