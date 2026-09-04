/**
 * Source : Palais Immobilier Côte d'Azur (palaisimmobilier.com) — réseau
 * d'agences niçoises sur la plateforme Apimo/Cello (§47).
 *
 * LA PLUS GROSSE SOURCE LOCALE DU PROJET à ce jour : 105 locations dans les
 * communes cibles au sitemap du 2026-09-04, devant fnaim.fr (~75 par passage).
 * Le réseau tient plusieurs bureaux — Vieux Nice, Nice Ouest — et publie
 * appartements, maisons, bureaux, caves et parkings ; le filtrage par type
 * reste celui du pipeline, on ne trie pas ici (§17).
 *
 * Vérifié le 2026-09-04 : robots.txt permissif (seul `/app_dev.php` interdit),
 * sitemap index → 2 196 URL, signature Apimo confirmée sur les fiches
 * `/fr/propriete/location+…`.
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const palaisImmobilierScraper = makeApimoScraper({
  id: 'palais-immobilier',
  name: 'Palais Immobilier',
  domain: 'palaisimmobilier.com',
  sitemapUrl: 'https://palaisimmobilier.com/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
  // Le volume justifie un budget de découverte plus large que le défaut : à
  // 20 fiches par passage, un stock de 105 mettrait cinq passages à entrer.
  maxDetailsBackfill: 40,
});
