/**
 * Source : Cabinet de Gestion Drago (cabinet-drago.com) — Immeuble Nice Europe
 * B, 29 rue Pastorelli, 06000 Nice. Demandée par l'utilisateur le 2026-08-27.
 *
 * Première instance de la plateforme ICS dans le projet — voir l'adaptateur
 * générique `../ics/`. robots.txt en 404 (aucune directive, rien d'interdit),
 * aucun anti-bot, rendu côté serveur.
 *
 * ATTENTE DE RENDEMENT : très faible, et c'est assumé. Le cabinet est d'abord
 * un syndic-gérant (NAF 68.32A) : au moment de l'étude il exposait UNE annonce
 * de location (un studio meublé étudiant, que le filtre étudiant écarte) contre
 * six ventes. On la garde comme « filet » — une requête par cycle, sans visite
 * de fiche — pour capter les biens qu'il publiera plus tard.
 *
 * Le `www` est obligatoire : l'apex `cabinet-drago.com` n'a pas de certificat
 * et sert une page vide en HTTP.
 */

import { makeIcsScraper } from '../ics/scraper.js';

export const dragoScraper = makeIcsScraper({
  id: 'drago',
  name: 'Cabinet Drago',
  domain: 'cabinet-drago.com',
  listUrl: 'https://www.cabinet-drago.com/location?transac=location',
});

export const DRAGO_DESCRIPTOR = dragoScraper.descriptor;
