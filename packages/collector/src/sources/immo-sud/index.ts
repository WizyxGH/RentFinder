/**
 * Source : Immo-Sud Nice (agenceimmosud.com) — agence niçoise sur la plateforme
 * La Boîte Immo/Hektor (§47). Repérée le 2026-08-24 via les e-mails de
 * confirmation SeLoger (agence contactée non encore couverte).
 *
 * Signature La Boîte Immo confirmée le 2026-08-24 (« Powered by La Boîte Immo »).
 * La page location filtrée Nice (/location/1-nice/appartement/1) liste ~15
 * biens en HTML server-side, sur une seule page. robots.txt permissif pour
 * /location (seuls /stats, /phpmv2, /fonctions sont interdits).
 */

import { makeHektorScraper } from '../hektor/scraper.js';

export const immoSudScraper = makeHektorScraper({
  id: 'immo-sud',
  name: 'Immo-Sud Nice',
  domain: 'agenceimmosud.com',
  listUrls: ['https://www.agenceimmosud.com/location/1-nice/appartement/1'],
});
