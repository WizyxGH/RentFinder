/**
 * Source : Beaumont Immobilier (beaumontimmo.com) — agence niçoise sur la
 * plateforme Apimo/Cello (§47). Repérée le 2026-08-24 via les e-mails de
 * confirmation SeLoger (agence contactée non encore couverte).
 *
 * Signature Apimo confirmée le 2026-08-24 : footer « Design by Apimo™ », sitemap
 * index → /fr/propriete/location*. ~336 locations Nice au sitemap (gros stock).
 * robots.txt permissif (Sitemap déclaré ; seul /app_dev.php interdit).
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const beaumontScraper = makeApimoScraper({
  id: 'beaumont',
  name: 'Beaumont Immobilier',
  domain: 'beaumontimmo.com',
  sitemapUrl: 'https://beaumontimmo.com/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});

export const BEAUMONT_DESCRIPTOR = beaumontScraper.descriptor;
