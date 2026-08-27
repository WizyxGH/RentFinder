/**
 * Source : Dinamy Immobilier (dinamyimmobilier.com) — 13 rue François Guisol,
 * 06300 Nice. Demandée par l'utilisateur le 2026-08-27.
 *
 * Application PHP maison, rendue côté serveur, sans anti-bot. Pas de robots.txt
 * (404) : rien n'est interdit. Trois particularités guident ce parseur.
 *
 *  1. TOUT est déjà dans le lien de la carte : `idBien`, `ref`, `prix` et
 *     `trans` sont des paramètres du querystring — inutile d'ouvrir la fiche.
 *  2. Le CHEMIN DES PHOTOS encode la typologie : `Ap{pièces}P-{surface}-{ville}-
 *     {quartier}-{idBien}`. C'est la seule source de surface sur la liste, et
 *     elle s'est vérifiée sur l'ensemble des annonces (§17 : on ne lit que ce
 *     qui est réellement publié, ici sous une forme inhabituelle).
 *  3. `transactions=4` est de la location SAISONNIÈRE, tarifée à la nuitée.
 *     Elle n'est jamais collectée : ses « 90 € » pollueraient les notifications.
 *     Seules `3` (vide) et `5` (meublée) sont des baux longue durée.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';
import { compactListing } from '../shared/raw-listing.js';

/** Typologie déduite du dossier photo `Ap3P-53-Nice-Cimiez-51`. */
export interface PhotoSlug {
  readonly rooms?: string;
  readonly area?: string;
}

export function parsePhotoSlug(src: string): PhotoSlug {
  const folder = /photosBiens\/([^/]+)\//i.exec(src)?.[1];
  if (folder === undefined) return {};
  const match = /^Ap(\d+)P-(\d+(?:[.,]\d+)?)-/i.exec(folder);
  if (match?.[1] === undefined || match[2] === undefined) return {};
  return { rooms: `${match[1]} pièces`, area: `${match[2].replace(',', '.')} m²` };
}

/**
 * Extrait les annonces d'une page de résultats OU d'un fragment de pagination
 * (les deux partagent le même gabarit de carte).
 */
export function parseListPage(html: string, pageUrl: string, agencyName: string): RawListing[] {
  const $ = cheerio.load(html);
  const byRef = new Map<string, RawListing>();

  $('a[href*="controleur=fiche"]').each((_i, el) => {
    const link = $(el);
    const href = link.attr('href') ?? '';

    let params: URLSearchParams;
    let sourceUrl: string;
    try {
      const url = new URL(href, pageUrl);
      params = url.searchParams;
      sourceUrl = url.toString();
    } catch {
      return;
    }

    // `idBien` est l'identifiant interne stable ; `ref` est la référence
    // affichée par l'agence. On indexe sur `idBien`, plus fiable.
    const reference = params.get('idBien');
    if (reference === null || reference === '' || byRef.has(reference)) return;

    // Location saisonnière : jamais collectée (prix à la nuitée).
    const transaction = params.get('trans') ?? '';
    if (/saisonn/i.test(transaction)) return;

    const price = params.get('prix');
    const image = link.find('img[src]').attr('src');
    const slug = image !== undefined ? parsePhotoSlug(image) : {};

    // « Nice - Carras » : la commune précède le tiret, le quartier suit. Le
    // `<span>` de la référence est retiré avant lecture.
    const locality = cleanText(
      link.find('p').first().clone().children('span').remove().end().text(),
    );
    const [city, district] = locality.split(/\s*-\s*/, 2);

    byRef.set(
      reference,
      compactListing({
        sourceRef: reference,
        sourceUrl,
        title: cleanText(link.find('h5').first().text().replace(/\s+/g, ' ')) || undefined,
        priceText: price !== null && price !== '' ? `${price} €` : undefined,
        areaText: slug.area,
        roomsText: slug.rooms,
        propertyTypeText: /appartement|studio|maison|villa/i.exec(
          link.find('h5').first().text(),
        )?.[0],
        // « Location meublée » vs « Location vide » : l'information est dans le
        // paramètre `trans` du lien.
        furnishedText: /meubl/i.test(transaction) ? 'meublé' : 'non meublé',
        cityText: city?.trim() || undefined,
        agencyName,
        contactFormUrl: sourceUrl,
        imageUrls:
          image !== undefined && image !== '' ? [new URL(image, pageUrl).toString()] : undefined,
        extra: {
          reference,
          ...(params.get('ref') !== null ? { agencyRef: params.get('ref') as string } : {}),
          ...(district !== undefined && district !== '' ? { quartier: district.trim() } : {}),
        },
      }),
    );
  });

  return [...byRef.values()];
}

/** Nombre total de pages annoncé par la liste (`<span id="nbPages">`). */
export function parsePageCount(html: string): number {
  const raw = cheerio.load(html)('#nbPages').first().text();
  const value = Number.parseInt(cleanText(raw), 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
