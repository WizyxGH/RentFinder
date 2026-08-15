/**
 * Source : D'Azur Immobilier (dazur.fr) — agence niçoise (Carré d'Or), sur la
 * plateforme Apimo/Cello. Demandée par l'utilisateur.
 *
 * Instance de l'adaptateur générique `sources/apimo` (§47) : même robots.txt
 * permissif (seul /app_dev.php interdit), même sitemap, mêmes fiches JSON-LD
 * que BEP. Vérifié le 2026-08-15.
 */

import { makeApimoScraper } from '../apimo/scraper.js';

export const dazurScraper = makeApimoScraper({
  id: 'dazur',
  name: "D'Azur Immobilier",
  domain: 'dazur.fr',
  sitemapUrl: 'https://dazur.fr/sitemap.xml',
  citySlugs: [
    'nice',
    'saint-laurent-du-var',
    'cagnes-sur-mer',
    'villefranche-sur-mer',
    'beaulieu-sur-mer',
    'cap-d-ail',
    'la-trinite',
  ],
});

export const DAZUR_DESCRIPTOR = dazurScraper.descriptor;
