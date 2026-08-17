/**
 * Source : Personal Immo (personalimmo.fr) — agence niçoise sur la plateforme
 * Apimo/Cello (§47).
 *
 * Identifiée par l'inventaire Apimo du 2026-08-17. robots.txt revérifié le
 * 2026-08-17 : signature Apimo exacte. ~16 locations à Nice dans le sitemap au
 * moment de l'étude.
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const personalimmoScraper = makeApimoScraper({
  id: 'personalimmo',
  name: 'Personal Immo',
  domain: 'personalimmo.fr',
  sitemapUrl: 'https://personalimmo.fr/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});

export const PERSONALIMMO_DESCRIPTOR = personalimmoScraper.descriptor;
