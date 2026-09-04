/**
 * Source : AKOR Immo (akorimmo.com) — agence niçoise sur la plateforme
 * Apimo/Cello (§47).
 *
 * PETIT VOLUME ASSUMÉ : 4 locations dans les communes cibles au 2026-09-04, sur
 * un sitemap de 1 259 URL très majoritairement consacrées à la vente. On la
 * garde quand même — une agence de quartier publie peu mais publie tôt, et le
 * coût d'une source Apimo est de deux requêtes par passage quand rien n'a
 * changé (§30).
 *
 * Vérifié le 2026-09-04 : robots.txt permissif (seul `/app_dev.php` interdit),
 * signature Apimo confirmée sur les fiches `/fr/propriete/location+…`.
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const akorimmoScraper = makeApimoScraper({
  id: 'akorimmo',
  name: 'AKOR Immo',
  domain: 'akorimmo.com',
  sitemapUrl: 'https://akorimmo.com/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});
