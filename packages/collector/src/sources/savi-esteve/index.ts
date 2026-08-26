/**
 * Source : Agence Savi Estève (saviesteve-nice.com) — 24 av. Georges
 * Clemenceau, 06000 Nice. Repérée le 2026-08-26 par la découverte automatique
 * d'agences dans les e-mails, puis demandée par l'utilisateur.
 *
 * Première instance de la plateforme AdaptImmo/Ubiflow dans le projet — voir
 * l'adaptateur générique `../adaptimmo/`. robots.txt vérifié le 2026-08-26 :
 * n'interdit que /stats/, /statweb/ et /DetailVideo.php ; les pages de liste et
 * de fiche sont autorisées. Aucun anti-bot, rendu côté serveur.
 *
 * Inventaire modeste (≈7 biens en location, dont 4-5 logements à Nice/Cagnes),
 * mais avec une vraie rotation et des loyers dans le budget.
 */

import { makeAdaptImmoScraper } from '../adaptimmo/scraper.js';

export const saviEsteveScraper = makeAdaptImmoScraper({
  id: 'savi-esteve',
  name: 'Agence Savi Estève',
  domain: 'saviesteve-nice.com',
  // `tdp=5` = location annuelle. Les autres types (étudiant, colocation,
  // saisonnier) sont sans stock chez cette agence.
  listUrl: 'https://www.saviesteve-nice.com/fr/liste.htm?tdp=5&page=1',
});

export const SAVI_ESTEVE_DESCRIPTOR = saviEsteveScraper.descriptor;
