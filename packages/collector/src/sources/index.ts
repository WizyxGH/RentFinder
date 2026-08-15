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
import { bepScraper } from './bep/index.js';
import { century21Scraper } from './century21/index.js';
import { fonciaScraper } from './foncia/index.js';
import { laforetScraper } from './laforet/index.js';
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
];

export { laforetScraper } from './laforet/index.js';
export { LAFORET_DESCRIPTOR } from './laforet/index.js';
export { orpiScraper } from './orpi/index.js';
export { ORPI_DESCRIPTOR } from './orpi/index.js';
export { bepScraper } from './bep/index.js';
export { BEP_DESCRIPTOR } from './bep/index.js';
