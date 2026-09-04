/**
 * Source : Borne & Delaunay (borne-delaunay.com) — agence niçoise, demandée par
 * l'utilisateur le 2026-09-04. Voir la fiche d'étude dans `docs/sources.md`.
 *
 * Site Rails maison, rendu côté serveur, sans anti-bot. `robots.txt` n'interdit
 * qu'un endpoint de formulaire (`/contacts/success_landing`).
 *
 * TOUT EST SUR LA CARTE : titre, ville, code postal, type, pièces, surface,
 * loyer et photo. Aucune visite de fiche n'est donc nécessaire (§30).
 *
 * Les classes sont utilitaires (Tailwind) et changeraient à la moindre
 * retouche de style : on s'ancre sur celles qui portent un SENS —
 * `.thumb` pour la carte, `.thumb__content` pour son bloc de faits — et on lit
 * le reste par ce qu'il contient, jamais par sa position.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';
import { compactListing, type ParsedList } from '../shared/raw-listing.js';

/** `/location-appartement-t2-nice-06000-2082` → `2082`. */
export function referenceOf(href: string): string | null {
  return /-(\d+)$/.exec(href)?.[1] ?? null;
}

/** Extrait les annonces de la page de locations. */
export function parseListPage(html: string, pageUrl: string, agencyName: string): ParsedList {
  const $ = cheerio.load(html);
  const listings: RawListing[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  $('.thumb').each((_index, element) => {
    const card = $(element);
    const href = card.find('a[href^="/location-"]').first().attr('href');
    if (href === undefined) return;

    const reference = referenceOf(href);
    if (reference === null) {
      warnings.push(`Lien sans référence : ${href}`);
      return;
    }
    if (seen.has(reference)) return;
    seen.add(reference);

    let sourceUrl: string;
    try {
      sourceUrl = new URL(href, pageUrl).toString();
    } catch {
      return;
    }

    // Deux titres cohabitent : l'accroche de l'agence, posée sur la photo, et
    // le libellé générique du lien (« Location Appartement T2 »). L'accroche
    // est la plus riche — elle nomme souvent la rue ou le quartier — mais le
    // libellé porte le TYPE de façon fiable : on garde les deux, chacun pour
    // ce qu'il apporte.
    const headline = cleanText(card.find('h3.title-100').first().text());
    const typeLabel = cleanText(card.find('a.link-graydark-primary').first().text());

    // Ville et code postal, dans deux blocs jumeaux ; le CP est le seul des
    // deux à être un nombre à cinq chiffres.
    const places = card
      .find('.thumb__content .text-2xs')
      .map((_i, node) => cleanText($(node).text()))
      .get()
      .filter((text) => text !== '');
    const postalCode = places.find((text) => /^\d{5}$/.test(text));
    const cityText = places.find((text) => !/^\d{5}$/.test(text));

    // Pièces et surface, lues par leur unité et non par leur rang.
    const facts = card
      .find('.thumb__content h3')
      .map((_i, node) => cleanText($(node).text()))
      .get();
    const roomsText = facts.find((text) => /pi[eè]ces?/i.test(text));
    const areaText = facts.find((text) => /m²/i.test(text));
    const priceText = facts.find((text) => /€/.test(text));

    const image = card.find('img[src*="/uploads/accommodations/"]').first().attr('src');

    listings.push(
      compactListing({
        sourceRef: reference,
        sourceUrl,
        title: headline !== '' ? headline : typeLabel || undefined,
        priceText,
        areaText,
        roomsText,
        propertyTypeText: `${typeLabel} ${headline}`,
        cityText,
        postalCodeText: postalCode,
        agencyName,
        contactFormUrl: sourceUrl,
        ...(image !== undefined ? { imageUrls: [new URL(image, pageUrl).toString()] } : {}),
        extra: { reference },
      }),
    );
  });

  return { listings, warnings };
}
