/**
 * Source : Immo JBF (immo-jbf.com) — agence niçoise sur la plateforme
 * Apimo/Cello (§47).
 *
 * La plus grosse source locale du projet, devant Palais Immobilier (105) et
 * fnaim.fr (~75 par passage). Elle publie aussi bureaux, commerces et
 * parkings : le tri par type reste celui du pipeline (§17).
 *
 * Vérifié le 2026-09-05 avec `scripts/probe-agency.mjs` : robots.txt permissif
 * (seul `/app_dev.php` interdit), signature Apimo confirmée, 151 locations
 * dans les communes cibles au sitemap.
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const immoJbfScraper = makeApimoScraper({
  id: 'immo-jbf',
  name: 'Immo JBF',
  domain: 'immo-jbf.com',
  sitemapUrl: 'https://immo-jbf.com/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
  maxDetailsBackfill: 40,
});
