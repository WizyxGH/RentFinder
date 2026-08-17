/**
 * Source : Foch Immobilier (groupe-foch.com) — agence niçoise (quartier du
 * port), gestion locative depuis 1989, sur la plateforme Apimo/Cello (§47).
 *
 * Identifiée par l'inventaire Apimo du 2026-08-17. robots.txt revérifié le
 * 2026-08-17 : signature Apimo exacte. ~25 locations (Nice, Cagnes-sur-Mer)
 * dans le sitemap au moment de l'étude.
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const groupeFochScraper = makeApimoScraper({
  id: 'groupe-foch',
  name: 'Foch Immobilier',
  domain: 'groupe-foch.com',
  sitemapUrl: 'https://groupe-foch.com/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});

export const GROUPE_FOCH_DESCRIPTOR = groupeFochScraper.descriptor;
