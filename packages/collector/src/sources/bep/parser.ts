/**
 * Parser BEP Logement — réexporte l'adaptateur générique Apimo (§47).
 *
 * BEP a été la première agence de cette plateforme ; son parser a depuis été
 * généralisé dans `sources/apimo/parser.ts`, désormais partagé avec les autres
 * agences Apimo. Ce module conserve l'API historique (et son `defaultAgencyName`
 * propre) pour les tests de BEP.
 */

import { parseDetailPage as apimoParseDetailPage, type ParsedDetail } from '../apimo/parser.js';

export {
  parseListingUrl,
  parseSitemap,
  parseSitemapIndex,
  type ParsedListingUrl,
  type SitemapEntry,
  type ParsedDetail,
} from '../apimo/parser.js';

/** Analyse une fiche BEP (agence par défaut : « BEP Logement »). */
export function parseDetailPage(html: string, pageUrl: string): ParsedDetail {
  return apimoParseDetailPage(html, pageUrl, 'BEP Logement');
}
