/**
 * Source : BEP Logement — première AGENCE LOCALE du projet (§3), sur la
 * plateforme Apimo/Cello. Depuis la généralisation (§47), ce n'est plus qu'une
 * instance de l'adaptateur générique `sources/apimo` : toute la logique de
 * collecte (sitemap → fiches nouvelles) y vit, partagée avec les autres
 * agences Apimo (D'Azur…).
 *
 * robots.txt vérifié le 2026-08-15 : permissif (seul /app_dev.php interdit),
 * sitemap déclaré. Communes cibles : Nice et sa continuité urbaine.
 */

import { makeApimoScraper } from '../apimo/scraper.js';

export const bepScraper = makeApimoScraper({
  id: 'bep',
  name: 'BEP Logement',
  domain: 'bep-logement.com',
  sitemapUrl: 'https://bep-logement.com/sitemap.xml',
  citySlugs: [
    'nice',
    'saint-laurent-du-var',
    'cagnes-sur-mer',
    'villefranche-sur-mer',
    'beaulieu-sur-mer',
    'la-trinite',
    'saint-andre-de-la-roche',
    'drap',
    'falicon',
  ],
});

export const BEP_DESCRIPTOR = bepScraper.descriptor;
