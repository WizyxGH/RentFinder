/**
 * Source : Agence du Centre (agenceducentrenice.com) — agence niçoise sur la
 * plateforme La Boîte Immo/Hektor (§47), inventaire du 2026-08-17.
 *
 * robots.txt vérifié le 2026-08-17 : permissif (Allow: /), sitemap déclaré.
 * ~5 fiches de location sur la liste au moment de l'étude.
 */

import { makeHektorScraper } from '../hektor/scraper.js';

export const agenceDuCentreScraper = makeHektorScraper({
  id: 'agence-du-centre',
  name: 'Agence du Centre',
  domain: 'agenceducentrenice.com',
  listUrls: ['https://www.agenceducentrenice.com/location/1'],
});

export const AGENCE_DU_CENTRE_DESCRIPTOR = agenceDuCentreScraper.descriptor;
