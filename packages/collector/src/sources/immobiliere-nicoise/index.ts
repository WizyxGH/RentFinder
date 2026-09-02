/**
 * Source : L'Immobilière Niçoise (immobiliere-nicoise.com) — 33 avenue du
 * Maréchal Foch, 06000 Nice. Demandée par l'utilisateur le 2026-08-27.
 *
 * Plateforme La Boîte Immo : l'adaptateur générique suffit, aucune ligne de
 * parsing spécifique. robots.txt vérifié le 2026-08-27 — identique à celui déjà
 * documenté pour la plateforme (n'interdit que /stats, /phpmv2, /fonctions,
 * /templates, /admin) : les chemins d'annonces sont autorisés.
 *
 * Deux pièges relevés à l'étude, d'où le choix d'URL :
 *  - `/location/06-alpes-maritimes/1`, l'adresse que renvoient les moteurs de
 *    recherche, répond « aucun bien » : c'est `/location/1` qui liste.
 *  - `/location-pro/1` contient des locaux commerciaux, parfois hors 06 : cette
 *    page n'est jamais collectée.
 *
 * Stock modeste (2 biens à l'étude, au-dessus du budget), mais l'agence fait
 * bien de la location longue durée — pas de saisonnier au catalogue.
 */

import { makeHektorScraper } from '../hektor/scraper.js';

export const immobiliereNicoiseScraper = makeHektorScraper({
  id: 'immobiliere-nicoise',
  name: "L'Immobilière Niçoise",
  domain: 'immobiliere-nicoise.com',
  listUrls: ['https://www.immobiliere-nicoise.com/location/1'],
});
