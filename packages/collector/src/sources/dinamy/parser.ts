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
import { htmlToText } from '../shared/html-text.js';

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
 * Découpe la ligne de localisation d'une carte.
 *
 * Le site l'écrit par niveaux, du plus large au plus précis, séparés par un
 * tiret ENTOURÉ D'ESPACES :
 *
 *     Nice - Le Port                        commune, quartier
 *     Nice - Carré d'Or - Rue de France     commune, quartier, voie
 *
 * Le découpage exige ces espaces : sur `\s*-\s*`, « Nice - Vieux-Nice » se
 * coupait aussi au tiret interne du quartier, qui devenait « Vieux ».
 *
 * Le troisième niveau est rendu tel quel comme adresse : c'est la place que le
 * site réserve à la voie, on ne devine rien (§17, §20).
 */
export function splitLocality(text: string): {
  readonly city?: string;
  readonly district?: string;
  readonly street?: string;
} {
  const [city, district, street] = cleanText(text)
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return {
    ...(city !== undefined ? { city } : {}),
    ...(district !== undefined ? { district } : {}),
    ...(street !== undefined ? { street } : {}),
  };
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

    // « Nice - Carras », « Nice - Carré d'Or - Rue de France » : la commune, le
    // quartier, puis parfois la VOIE — trois niveaux positionnels, pas deux. Le
    // `<span>` de la référence est retiré avant lecture.
    const locality = cleanText(
      link.find('p').first().clone().children('span').remove().end().text(),
    );
    const { city, district, street } = splitLocality(locality);

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
        cityText: city,
        addressText: street,
        agencyName,
        contactFormUrl: sourceUrl,
        imageUrls:
          image !== undefined && image !== '' ? [new URL(image, pageUrl).toString()] : undefined,
        extra: {
          reference,
          ...(params.get('ref') !== null ? { agencyRef: params.get('ref') as string } : {}),
          ...(district !== undefined ? { quartier: district } : {}),
        },
      }),
    );
  });

  return [...byRef.values()];
}

/** Ce qu'une FICHE apporte en plus de la carte de liste. */
export interface DinamyDetail {
  readonly description?: string;
  /** Toutes les photos du diaporama, en absolu. La liste n'en donne qu'une. */
  readonly imageUrls?: readonly string[];
  readonly dpe?: string;
}

/**
 * Lit la fiche d'un bien.
 *
 * La carte de liste ne porte ni description ni diaporama ; or c'est la
 * description qui nomme la RUE (« Rue Smolett, tout proche du port… ») et le
 * diaporama qui contient les six photos. Sans cette visite, 9 fiches sur 10
 * n'avaient qu'une image et aucune adresse.
 *
 * Le gabarit d'impression répète description et photos plus bas dans la page :
 * on ne lit donc que la PREMIÈRE occurrence de chaque bloc.
 *
 * DPE : le tableau empile les sept classes en images, toutes suffixées `-v`
 * (« vide ») sauf celle du bien. C'est cette absence de suffixe qui désigne la
 * classe — il n'y a pas d'autre marqueur dans la page.
 */
export function parseDetailPage(html: string, pageUrl: string): DinamyDetail {
  const $ = cheerio.load(html);
  const detail: {
    description?: string;
    imageUrls?: readonly string[];
    dpe?: string;
  } = {};

  // `htmlToText` et non `.text()` : la description est écrite en paragraphes,
  // et n'en lire que le PREMIER `<p>` perdait le reste — dont la rue, parfois
  // citée plus bas. Les retours à la ligne sont conservés.
  const description = htmlToText($, '#description_annonce p');
  if (description !== '') detail.description = description;

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  $('#diapo_bien')
    .first()
    .find('img')
    .each((_i, el) => {
      // Diaporama à chargement différé : la vraie URL est dans `data-src`,
      // `src` restant vide jusqu'à l'exécution du JavaScript.
      const raw = $(el).attr('data-src') ?? $(el).attr('src') ?? '';
      if (raw === '') return;
      let absolute: string;
      try {
        absolute = new URL(raw, pageUrl).toString();
      } catch {
        return;
      }
      if (seen.has(absolute)) return;
      seen.add(absolute);
      imageUrls.push(absolute);
    });
  if (imageUrls.length > 0) detail.imageUrls = imageUrls;

  // Portée au seul tableau du DPE : la page pèse 2 Mo, la sérialiser entière
  // pour y chercher une lettre serait du gâchis.
  const dpe = /\/dpe\/dpe-([a-g])\.png/i.exec($('table.dpe-ges').first().html() ?? '');
  if (dpe?.[1] !== undefined) detail.dpe = `DPE ${dpe[1].toUpperCase()}`;

  return detail;
}

/**
 * Complète une annonce lue sur la liste par ce que sa fiche apporte.
 *
 * La liste reste la source des faits qu'elle publie déjà (prix, surface,
 * pièces, quartier) : la fiche ne fait qu'ajouter ce qui lui manque. Un champ
 * déjà rempli n'est jamais écrasé — la fiche n'est pas plus fiable, seulement
 * plus complète.
 */
export function withDetail(listing: RawListing, detail: DinamyDetail): RawListing {
  return compactListing({
    ...listing,
    description: listing.description ?? detail.description,
    imageUrls: detail.imageUrls ?? listing.imageUrls,
    extra: {
      ...listing.extra,
      ...(detail.dpe !== undefined ? { dpe: detail.dpe } : {}),
    },
  });
}

/** Nombre total de pages annoncé par la liste (`<span id="nbPages">`). */
export function parsePageCount(html: string): number {
  const raw = cheerio.load(html)('#nbPages').first().text();
  const value = Number.parseInt(cleanText(raw), 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
