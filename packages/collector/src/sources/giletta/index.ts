/**
 * Source : Giletta Immobilier (giletta-properties.com) — agence niçoise sur la
 * plateforme La Boîte Immo/Hektor (§47). Meilleur volume unitaire de
 * l'inventaire du 2026-08-17 : ~47 fiches de location à Nice (dont beaucoup de
 * locations étudiantes exclusives, écartées par le filtre §-étudiant, et des
 * parkings, écartés par le scoring).
 *
 * robots.txt vérifié le 2026-08-17 : permissif (Allow: /), sitemap déclaré.
 */

import { makeHektorScraper } from '../hektor/scraper.js';

export const gilettaScraper = makeHektorScraper({
  id: 'giletta',
  name: 'Giletta Immobilier',
  domain: 'giletta-properties.com',
  listUrls: [
    'https://www.giletta-properties.com/location/1',
    'https://www.giletta-properties.com/location/2',
    'https://www.giletta-properties.com/location/3',
  ],
});

export const GILETTA_DESCRIPTOR = gilettaScraper.descriptor;
