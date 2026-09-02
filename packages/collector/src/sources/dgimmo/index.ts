/**
 * Source : DG Immo — Documentation Générale Immobilière (dgimmo.fr), agence
 * niçoise sur la plateforme Apimo/Cello (§47).
 *
 * Identifiée par l'inventaire Apimo du 2026-08-17. robots.txt revérifié le
 * 2026-08-17 : signature Apimo exacte. ~4 locations (Nice, Saint-Laurent-du-
 * Var) dans le sitemap au moment de l'étude.
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const dgimmoScraper = makeApimoScraper({
  id: 'dgimmo',
  name: 'DG Immo',
  domain: 'dgimmo.fr',
  sitemapUrl: 'https://dgimmo.fr/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});
