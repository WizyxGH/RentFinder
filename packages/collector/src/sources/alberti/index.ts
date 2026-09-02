/**
 * Source : Alberti Immobilier (agencealbertinice.com) — agence niçoise sur la
 * plateforme Apimo/Cello (§47). Repérée le 2026-08-24 via les e-mails de
 * confirmation SeLoger (agence contactée non encore couverte).
 *
 * Signature Apimo confirmée le 2026-08-24 : footer « Design by Apimo™ », sitemap
 * index → /fr/propriete/location*. ~19 locations Nice au sitemap. robots.txt
 * permissif (signature Apimo : seul /app_dev.php interdit).
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const albertiScraper = makeApimoScraper({
  id: 'alberti',
  name: 'Alberti Immobilier',
  domain: 'agencealbertinice.com',
  sitemapUrl: 'https://agencealbertinice.com/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});
