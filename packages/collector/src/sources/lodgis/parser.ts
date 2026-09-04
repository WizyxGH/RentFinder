/**
 * Source : Lodgis (lodgis.com) — marque du groupe Emeria, spécialisée dans la
 * location MEUBLÉE moyen/long terme. Ajoutée le 2026-08-26 à la demande de
 * l'utilisateur, après revue du portefeuille Emeria (les autres marques du
 * groupe ne publient pas de location à Nice, ou l'interdisent).
 *
 * robots.txt vérifié le 2026-08-26 : les chemins d'annonces
 * `/fr/france,location-meublee/**` sont AUTORISÉS. Sont interdits — et donc
 * jamais appelés ici : `/ajax*` (les filtres dynamiques), les paramètres
 * `?surf=` / `?cur=` / `?add=` / `?del=`, et `/impression/`. La page catégorie
 * SSR suffit : une requête, aucune visite de fiche (§30).
 *
 * Chaque carte (`div.card__appart`) porte le titre (typologie + chambres), la
 * référence, la surface, la ville, le loyer et la date de disponibilité.
 *
 * NOTE : le stock niçois de Lodgis est du meublé haut de gamme (~1 600-2 100 €).
 * La plupart des annonces sortiront du budget au scoring — c'est attendu, elles
 * restent consultables en « hors critères » (§53).
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { htmlToText } from '../shared/html-text.js';
import { cleanText } from '../../normalization/text.js';
import { compactListing, type ParsedList, type RawDraft } from '../shared/raw-listing.js';

/** Référence Lodgis (« LPA26747 ») lue dans l'URL de la fiche. */
function referenceFrom(href: string): string | null {
  return /\/([A-Z]{2,4}\d{4,})-/.exec(href)?.[1] ?? null;
}

/**
 * Texte d'une rue déduit du slug de l'URL : « LPA26747-avenue-jean-medecin-
 * appartement-france-6 » → « avenue jean medecin ». Lodgis ne publie pas
 * l'adresse en clair sur la liste, mais la nomme dans l'URL (§20).
 */
function streetFromSlug(href: string): string | undefined {
  const slug = /\/[A-Z]{2,4}\d{4,}-(.+?)-(?:appartement|studio|maison|loft)-/.exec(href)?.[1];
  if (slug === undefined || slug === '') return undefined;
  return slug.replace(/-/g, ' ');
}

function buildListing(fields: {
  reference: string;
  sourceUrl: string;
  href: string;
  title: string;
  surface: string;
  city: string;
  price: string;
  availability: string;
  image: string | undefined;
  agencyName: string;
}): RawListing {
  const {
    reference,
    sourceUrl,
    href,
    title,
    surface,
    city,
    price,
    availability,
    image,
    agencyName,
  } = fields;
  // « Appartement meublé 3 chambres » : Lodgis compte les CHAMBRES, pas les
  // pièces — on ne convertit pas (§17), on laisse la normalisation lire le
  // nombre de chambres tel qu'il est publié.
  return compactListing({
    sourceRef: reference,
    sourceUrl,
    title: title || undefined,
    priceText: price || undefined,
    areaText: surface || undefined,
    roomsText: /(\d+\s*chambres?|studio)/i.exec(title)?.[0],
    propertyTypeText: /appartement|studio|maison|loft/i.exec(title)?.[0],
    // Toutes les annonces Lodgis sont des locations MEUBLÉES (c'est le métier).
    furnishedText: 'meublé',
    addressText: streetFromSlug(href),
    cityText: city || undefined,
    availableAtText: availability || undefined,
    agencyName,
    contactFormUrl: sourceUrl,
    imageUrls: image !== undefined && /^https?:/i.test(image) ? [image] : undefined,
    extra: { reference },
  });
}

/**
 * Ce que la FICHE ajoute à la carte : le descriptif, et toutes les photos.
 *
 * La carte n'en portait qu'une, celle d'`og:image`, et aucun texte — sept
 * annonces sans description ni galerie alors que la fiche publie dix-neuf
 * clichés et un paragraphe qui dit l'essentiel : « peut accueillir jusqu'à 4
 * personnes ». Ce chiffre est ce qui distingue un logement où tenir à deux
 * d'une chambre en colocation, et la normalisation sait déjà le lire.
 *
 * LES PHOTOS EXISTENT EN QUATRE TAILLES, et le même cliché revient sous deux
 * noms — `appartement-nice--G11.jpg` et `appartement-nice-sejour-G11.jpg`.
 * On ne garde que le dossier `/G/`, le plus grand, et on dédoublonne sur le
 * CODE DE PRISE DE VUE qui termine le nom (G11, E21, Y14…) : sans cela, la
 * galerie montrait deux fois chaque pièce.
 */
export function parseDetail(html: string): RawDraft | null {
  const $ = cheerio.load(html);
  const description = htmlToText($, '.appart__infos__description');

  const byShot = new Map<string, string>();
  for (const match of html.matchAll(PHOTO_URL)) {
    const url = match[0];
    const shot = SHOT_CODE.exec(url)?.[1];
    if (shot === undefined) continue;
    // À code égal, le nom le plus court est le générique : on le préfère,
    // l'autre ne fait qu'y ajouter le nom de la pièce.
    const kept = byShot.get(shot);
    if (kept === undefined || url.length < kept.length) byShot.set(shot, url);
  }
  const imageUrls = [...byShot.values()].sort();

  if (description === '' && imageUrls.length === 0) return null;
  return {
    ...(description !== '' ? { description } : {}),
    ...(imageUrls.length > 0 ? { imageUrls } : {}),
  };
}

/** Photos en pleine taille : le dossier `/G/` de la référence. */
const PHOTO_URL =
  /https:\/\/www\.lodgis\.com\/photos\/[a-z]+\/[a-z]+\/\d+\/G\/[^"' ]+\.jpg(?:\?v=\d+)?/gi;

/** Code de prise de vue en fin de nom : `…-G11.jpg`, `…--E21.jpg?v=…`. */
const SHOT_CODE = /-([A-Z]\d{2})\.jpg/;
/** Parse la page catégorie et rend une annonce par carte `div.card__appart`. */
export function parseListPage(html: string, pageUrl: string, agencyName: string): ParsedList {
  const $ = cheerio.load(html);
  const bySourceRef = new Map<string, RawListing>();

  $('a[href*=".mod.html"]').each((_i, el) => {
    const link = $(el);
    const href = link.attr('href') ?? '';
    const reference = referenceFrom(href);
    if (reference === null || bySourceRef.has(reference)) return;

    let sourceUrl: string;
    try {
      sourceUrl = new URL(href, pageUrl).toString();
    } catch {
      return;
    }

    const card = link.closest('div.card__appart');
    const container = card.length > 0 ? card : link.parent();
    // Le prix vit dans `span.price` ; la disponibilité dans le `<span>` qui
    // suit « Disponible à partir du ».
    const availability = cleanText(
      container
        .find('p')
        .filter((_j, p) => /disponible/i.test($(p).text()))
        .first()
        .find('span')
        .first()
        .text(),
    );

    bySourceRef.set(
      reference,
      buildListing({
        reference,
        sourceUrl,
        href,
        title: cleanText(
          container.find('.card__appart__title').first().text().replace(/\s+/g, ' '),
        ),
        surface: cleanText(container.find('.card-surface').first().text().replace(/\s+/g, ' ')),
        city: cleanText(
          container
            .find('p.card-text')
            .filter((_j, p) => !/€/.test($(p).text()))
            .first()
            .text()
            .replace(/\s+/g, ' '),
        ),
        price: cleanText(container.find('.price').first().text().replace(/\s+/g, ' ')),
        availability,
        image: container.find('img[src]').attr('src'),
        agencyName,
      }),
    );
  });

  const listings = [...bySourceRef.values()];
  return {
    listings,
    warnings: listings.length === 0 ? [`Aucune annonce sur la liste : ${pageUrl}`] : [],
  };
}
