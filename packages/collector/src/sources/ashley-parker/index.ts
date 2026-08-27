/**
 * Source : Ashley & Parker (ashley-parker.fr) — agence niçoise, 39 rue de
 * France, 06000 Nice. Demandée par l'utilisateur le 2026-08-26.
 *
 * Plateforme Apimo/Cello : l'adaptateur générique suffit, aucune ligne de
 * parsing spécifique. robots.txt vérifié le 2026-08-26 : n'interdit que
 * /app_dev.php, sitemap déclaré — signature Apimo exacte.
 *
 * RENDEMENT ATTENDU FAIBLE, mais bien ciblé : l'agence est vendeuse à ~99 %
 * (≈388 fiches de vente contre 5 de location). Sur ces 5 locations niçoises,
 * 4 datent du 2024-12-04 — écartées par `maxEntryAgeDays` — et une seule est
 * vivante. En revanche les loyers relevés (650 €/22 m², 660 €/20 m²) tombent
 * pile dans les critères, ce qui est rare parmi les agences du secteur. C'est
 * une source « filet », pas une source de volume : une requête de sitemap par
 * cycle, et rien d'autre tant qu'aucune nouvelle annonce n'apparaît (§30).
 */

import { makeApimoScraper } from '../apimo/scraper.js';
import { NICE_AREA_SLUGS } from '../agence-victoire/index.js';

export const ashleyParkerScraper = makeApimoScraper({
  id: 'ashley-parker',
  name: 'Ashley & Parker',
  domain: 'ashley-parker.fr',
  sitemapUrl: 'https://ashley-parker.fr/sitemap.xml',
  citySlugs: NICE_AREA_SLUGS,
});

export const ASHLEY_PARKER_DESCRIPTOR = ashleyParkerScraper.descriptor;
