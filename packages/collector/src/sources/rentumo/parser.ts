/**
 * Source : Rentumo (rentumo.com) — AGRÉGATEUR, demandé par l'utilisateur le
 * 2026-09-03. Voir la fiche d'étude dans `docs/sources.md`.
 *
 * CE QU'IL FAUT SAVOIR AVANT DE LIRE CE FICHIER.
 *
 * Rentumo balaie lui-même des milliers de sites et republie les annonces. Trois
 * conséquences, assumées et signalées à l'utilisateur :
 *
 *   1. AUCUN LIEN VERS L'ANNONCE D'ORIGINE. La fiche Rentumo ne le publie pas,
 *      et les coordonnées y sont floutées derrière un abonnement payant. On ne
 *      collecte donc QUE la page de résultats : visiter les fiches coûterait
 *      des requêtes pour rien (§30).
 *   2. CHAMPS « extraits par IA », de l'aveu du site lui-même (« may not be
 *      100% accurate »). On ne retient que ce qui est affiché tel quel sur la
 *      carte — prix, surface, chambres, type, ville — jamais une déduction.
 *   3. DONNÉE DE SECONDE MAIN. Une annonce vue ici l'est souvent déjà par une
 *      source directe ; c'est le dédoublonnage qui tranche (§13, §14).
 *
 * LA SOURCE RÉELLE EST POURTANT RÉCUPÉRABLE, et c'est ce qui rend cette source
 * exploitable : les photos passent par un proxy dont l'URL encode, en base64,
 * l'adresse D'ORIGINE de l'image. On y lit l'hébergeur du site source (FNAIM,
 * La Boîte Immo, Orpi…), ce qui identifie l'annonceur et fournit une photo en
 * pleine qualité sans passer par le proxy.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';
import { compactListing, type ParsedList } from '../shared/raw-listing.js';
import { htmlToText } from '../shared/html-text.js';

/**
 * URL d'origine d'une image servie par le proxy de Rentumo.
 *
 * Le proxy (imgproxy) compose ses URLs ainsi :
 *
 *     https://img.rentumo.com/<signature>/s:366:311/rt:fill-down/<base64 découpé>
 *
 * La cible est encodée en base64url, PUIS découpée en tranches séparées par des
 * `/`. On recolle les tranches avant de décoder.
 *
 * @returns l'URL d'origine, ou `null` si l'URL ne suit pas ce format — auquel
 *          cas on ne devine rien (§17).
 */
export function decodeProxiedImage(url: string): string | null {
  const encoded = /\/rt:[^/]+\/(.+)$/.exec(url)?.[1];
  if (encoded === undefined) return null;
  const joined = encoded.replace(/\//g, '');
  let decoded: string;
  try {
    decoded = Buffer.from(joined, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  return /^https?:\/\/\S+$/.test(decoded) ? decoded : null;
}

/**
 * Hôte du site d'origine, tel que révélé par les photos.
 *
 * C'est la seule trace de provenance que Rentumo laisse : elle ne remplace pas
 * un lien vers l'annonce, mais elle dit d'où vient le bien, ce qui vaut mieux
 * que « rentumo » pour décider quoi faire (§15).
 */
function originHost(imageUrls: readonly string[]): string | undefined {
  for (const url of imageUrls) {
    try {
      return new URL(url).hostname;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Titre d'une annonce, s'il y en a un.
 *
 * La carte ne porte PAS de titre : seulement un extrait de description, dont
 * la première ligne fait souvent l'affaire (« NICE NORD - AV. ST MAURICE… »).
 * Mais certaines sources ouvrent sur le loyer (« Loyer : / 1 490 € / par mois »)
 * — en faire un titre donnerait « Loyer : ». Mieux vaut alors aucun titre
 * qu'un titre absurde (§17).
 */
function headline(description: string): string | undefined {
  const first = description.split('\n')[0]?.trim() ?? '';
  if (first.length < 12) return undefined;
  // Une ligne qui commence par une étiquette ou un montant n'est pas un titre.
  if (/^(loyer|prix|charges|montant|à partir)\b/i.test(first)) return undefined;
  if (/^[\d\s€.,]+$/.test(first)) return undefined;
  return first;
}

/** Ce qu'une page de résultats rend : ses annonces, et s'il en reste. */
export interface RentumoList extends ParsedList {
  /** `true` si la page déclare une suite (`<link rel="next">`). */
  readonly hasNext: boolean;
}

/** Extrait les annonces d'une page de résultats. */
export function parseListPage(html: string, pageUrl: string): RentumoList {
  const $ = cheerio.load(html);
  const listings: RawListing[] = [];
  const warnings: string[] = [];

  $('.listing-item').each((_index, element) => {
    const card = $(element);
    const reference = card.attr('data-listing-id');
    if (reference === undefined || reference === '') return;

    const href = card.find('a[href^="/listings/"]').first().attr('href');
    if (href === undefined) {
      warnings.push(`Annonce ${reference} sans lien : ignorée`);
      return;
    }
    let sourceUrl: string;
    try {
      sourceUrl = new URL(href, pageUrl).toString();
    } catch {
      return;
    }

    // Photos : on garde l'ORIGINE, jamais le proxy — la même image y est en
    // pleine résolution, et l'URL survit à un changement de proxy.
    const imageUrls: string[] = [];
    card.find('img[data-src^="https://img.rentumo.com/"]').each((_i, image) => {
      const decoded = decodeProxiedImage($(image).attr('data-src') ?? '');
      if (decoded !== null && !imageUrls.includes(decoded)) imageUrls.push(decoded);
    });

    // Les deux paragraphes du bloc texte : la ville, puis l'accroche.
    const paragraphs = card.find('a[href^="/listings/"] p');
    const cityText = cleanText(paragraphs.eq(0).text());
    const description = htmlToText($, paragraphs.eq(1) as cheerio.Cheerio<never>);

    // La rangée de faits : « 1 Bedroom · Apartment · 18 m² ». L'ordre varie
    // selon ce que la source publie : on lit chaque cellule pour ce qu'elle
    // est, jamais par sa position.
    const facts = card
      .find('li')
      .map((_i, cell) => cleanText($(cell).text()))
      .get()
      .filter((text) => text !== '');
    const areaText = facts.find((text) => /m²/i.test(text));
    const bedrooms = facts.find((text) => /\bbedrooms?\b/i.test(text));
    // Le vocabulaire anglais du site est passé TEL QUEL : c'est
    // `parsePropertyType` qui décide d'un type de bien, et il le comprend
    // désormais. Traduire ici en français pour qu'il retraduise ensuite était
    // un aller-retour, et un couplage muet entre deux fichiers (§12).
    const propertyTypeText = facts.join(' ');

    const priceText = cleanText(card.find('strong').first().text());
    const host = originHost(imageUrls);

    listings.push(
      compactListing({
        sourceRef: reference,
        sourceUrl,
        title: headline(description),
        description: description !== '' ? description : undefined,
        priceText: priceText !== '' ? priceText : undefined,
        areaText,
        // « 1 Bedroom » compte les CHAMBRES, pas les pièces : le confondre
        // gonflerait la typologie d'une unité sur tout l'inventaire (§17).
        // `parsePropertyType` en déduira « appartement », ce qui est juste.
        ...(bedrooms !== undefined ? { roomsText: bedrooms } : {}),
        propertyTypeText,
        cityText: cityText !== '' ? cityText : undefined,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        extra: {
          reference,
          ...(host !== undefined ? { origine: host } : {}),
        },
      }),
    );
  });

  // `hasNext` est rendu ici : le document est déjà analysé, et le relire pour
  // le seul `<link rel="next">` coûtait une seconde analyse complète.
  return { listings, warnings, hasNext: $('link[rel="next"]').attr('href') !== undefined };
}
