/**
 * Source : leprince realty (leprincerealty.com) — agence Nice / côte Est sur la
 * plateforme Apimo/Cello (§47).
 *
 * Identifiée par l'inventaire Apimo du 2026-08-17. robots.txt revérifié le
 * 2026-08-17 : signature Apimo exacte. ~6 locations (Nice, Beaulieu-sur-Mer)
 * dans le sitemap au moment de l'étude.
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const leprinceRealtyScraper = makeApimoScraper({
  id: 'leprince-realty',
  name: 'leprince realty',
  domain: 'leprincerealty.com',
  sitemapUrl: 'https://leprincerealty.com/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});
