/**
 * Lecture de texte LONG depuis du HTML, mise en forme comprise.
 *
 * `.text()` de cheerio ignore la structure : un `<br>` ou une fin de paragraphe
 * ne produit rien du tout. Les descriptions d'agences, écrites en paragraphes,
 * arrivaient donc en un seul bloc — illisible sur la fiche, et privé du seul
 * indice de structure dont dispose l'extraction d'adresse.
 *
 * Ce module matérialise ces ruptures AVANT d'extraire le texte. Il vit du côté
 * des sources, et non de la normalisation, parce qu'il connaît le HTML :
 * `normalization/text.ts` ne doit dépendre d'aucun analyseur.
 */

import type * as cheerio from 'cheerio';
import { cleanMultiline } from '../../normalization/text.js';

/** Éléments dont la fin sépare deux idées, au même titre qu'un `<br>`. */
const BLOCK_ELEMENTS = 'p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article';

/**
 * Texte du premier fragment visé, retours à la ligne conservés.
 *
 * `target` est soit un sélecteur, soit un fragment déjà en main — les parseurs
 * de pages de résultats travaillent sur une carte, pas sur le document.
 *
 * Le fragment est CLONÉ : le document reste intact pour la suite du parseur.
 *
 * @returns le texte nettoyé, ou une chaîne vide si le fragment est absent.
 */
export function htmlToText($: cheerio.CheerioAPI, target: string | cheerio.Cheerio<never>): string {
  const node = (typeof target === 'string' ? $(target) : target).first();
  if (node.length === 0) return '';
  const clone = node.clone();
  clone.find('br').replaceWith('\n');
  // Une rupture AVANT et APRÈS chaque bloc, sans toucher au contenu : un
  // `replaceWith` risquerait d'aplatir un bloc imbriqué, et la seule rupture
  // finale collait le bloc au texte qui le précède.
  clone.find(BLOCK_ELEMENTS).prepend('\n').append('\n');
  return cleanMultiline(clone.text());
}
