/**
 * Source : LT Immobilier (lt-immobilier.com) — agence de La Trinité sur la
 * plateforme La Boîte Immo/Hektor (§47). Seule couverture trouvée pour
 * La Trinité / Drap / vallée du Paillon (inventaire du 2026-08-17), communes
 * mal desservies par les autres sources — un stock faible mais stratégique.
 *
 * robots.txt vérifié le 2026-08-17 : permissif (Allow: /), sitemap déclaré
 * (mais sans les fiches → collecte par la liste).
 */

import { makeHektorScraper } from '../hektor/scraper.js';

export const ltImmobilierScraper = makeHektorScraper({
  id: 'lt-immobilier',
  name: 'LT Immobilier',
  domain: 'lt-immobilier.com',
  listUrls: ['https://www.lt-immobilier.com/a-louer/1'],
});
