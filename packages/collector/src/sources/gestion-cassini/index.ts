/**
 * Source : Gestion Cassini (gestioncassini.com) — agence niçoise indépendante
 * (12 rue François Guisol, 06300 Nice), sur la plateforme Apimo/Cello.
 * Demandée par l'utilisateur.
 *
 * Instance de l'adaptateur générique `sources/apimo` (§47) : même robots.txt
 * permissif (seul /app_dev.php interdit), même sitemap, mêmes fiches JSON-LD
 * que BEP et D'Azur. Vérifié le 2026-08-16 — beaucoup de locations à Nice, avec
 * l'adresse dans l'URL de la fiche.
 */

import { makeApimoScraper } from '../apimo/scraper.js';

export const gestionCassiniScraper = makeApimoScraper({
  id: 'gestion-cassini',
  name: 'Gestion Cassini',
  domain: 'gestioncassini.com',
  sitemapUrl: 'https://www.gestioncassini.com/sitemap.xml',
  citySlugs: [
    'nice',
    'saint-laurent-du-var',
    'cagnes-sur-mer',
    'beaulieu-sur-mer',
    'cap-d-ail',
    'villefranche-sur-mer',
    'la-trinite',
    'drap',
    'carros',
    'contes',
  ],
});

export const GESTION_CASSINI_DESCRIPTOR = gestionCassiniScraper.descriptor;
