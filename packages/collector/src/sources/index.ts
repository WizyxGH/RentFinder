/**
 * Déclaration des sources actives (§5).
 *
 * AJOUTER UNE SOURCE :
 *   1. créer `src/sources/<id>/parser.ts` et `src/sources/<id>/index.ts` ;
 *   2. ajouter une fixture dans `tests/fixtures/<id>/` et son test de parsing ;
 *   3. importer le scraper et l'ajouter au tableau ci-dessous.
 *
 * Rien d'autre n'est à modifier : le scheduler, la normalisation, le
 * dédoublonnage et le scoring découvrent la source par ce seul tableau (§47).
 *
 * Pour désactiver une source sans supprimer son code, passer `enabled: false`
 * dans son descripteur (§5, §76).
 */

import type { Scraper } from '@rentfinder/shared';
import { agenceDuCentreScraper } from './agence-du-centre/index.js';
import { agenceVictoireScraper } from './agence-victoire/index.js';
import { bepScraper } from './bep/index.js';
import { gilettaScraper } from './giletta/index.js';
import { bepAbonnesScraper } from './bep-abonnes/index.js';
import { century21Scraper } from './century21/index.js';
import { dazurScraper } from './dazur/index.js';
import { dgimmoScraper } from './dgimmo/index.js';
import { gestionCassiniScraper } from './gestion-cassini/index.js';
import { groupeFochScraper } from './groupe-foch/index.js';
import { fonciaScraper } from './foncia/index.js';
import { laforetScraper } from './laforet/index.js';
import { lamyScraper } from './lamy/index.js';
import { leprinceRealtyScraper } from './leprince-realty/index.js';
import { ltImmobilierScraper } from './lt-immobilier/index.js';
import { saintRochScraper } from './saint-roch/index.js';
import { mirabelloScraper } from './mirabello/index.js';
import { cityaScraper } from './citya/index.js';
import { studapartScraper } from './studapart/index.js';
import { personalimmoScraper } from './personalimmo/index.js';
import { nousgeronsScraper } from './nousgerons/index.js';
import { orpiScraper } from './orpi/index.js';
import { papScraper } from './pap/index.js';

export const ALL_SCRAPERS: readonly Scraper[] = [
  laforetScraper,
  orpiScraper,
  bepScraper,
  papScraper,
  fonciaScraper,
  century21Scraper,
  nousgeronsScraper,
  dazurScraper,
  gestionCassiniScraper,
  bepAbonnesScraper,
  lamyScraper,
  agenceVictoireScraper,
  groupeFochScraper,
  personalimmoScraper,
  leprinceRealtyScraper,
  dgimmoScraper,
  gilettaScraper,
  ltImmobilierScraper,
  agenceDuCentreScraper,
  saintRochScraper,
  mirabelloScraper,
  cityaScraper,
  studapartScraper,
];

export { laforetScraper } from './laforet/index.js';
export { LAFORET_DESCRIPTOR } from './laforet/index.js';
export { orpiScraper } from './orpi/index.js';
export { ORPI_DESCRIPTOR } from './orpi/index.js';
export { bepScraper } from './bep/index.js';
export { BEP_DESCRIPTOR } from './bep/index.js';
export { bepAbonnesScraper, BEP_ABONNES_DESCRIPTOR } from './bep-abonnes/index.js';
export { dazurScraper } from './dazur/index.js';
export { DAZUR_DESCRIPTOR } from './dazur/index.js';
export { gestionCassiniScraper, GESTION_CASSINI_DESCRIPTOR } from './gestion-cassini/index.js';
