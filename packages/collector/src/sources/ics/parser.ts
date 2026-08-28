/**
 * Parseur de la plateforme ICS (ics.fr) — §5, §47.
 *
 * Quatrième éditeur rencontré sur Nice, après Apimo/Cello, Hektor/La Boîte Immo
 * et AdaptImmo/Ubiflow. ICS équipe des cabinets de syndic et de gérance depuis
 * longtemps : l'adaptateur est générique, paramétré par domaine.
 *
 * Particularité qui simplifie tout : la page de liste SÉRIALISE ses annonces en
 * JSON dans un `var properties = [...]`. Pas de cartes à parcourir, pas de
 * pagination côté serveur (le `<ul class="pagination">` est masqué et le
 * découpage se fait en JavaScript sur le tableau déjà chargé) : une seule
 * requête suffit, et aucune fiche n'a besoin d'être visitée (§30).
 *
 * Ce JSON n'est PAS analysable par `JSON.parse` : les valeurs contiennent du
 * HTML avec des échappements invalides. On lit donc champ par champ, puis on
 * décode les entités.
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';
import { compactListing } from '../shared/raw-listing.js';

/** Retire le balisage et décode les entités HTML d'une valeur du JSON. */
function decode(raw: string | undefined): string {
  if (raw === undefined || raw === '') return '';
  const withoutTags = raw.replace(/\\+/g, '').replace(/<[^>]+>/g, ' ');
  // cheerio décode les entités (`&agrave;`, `&sup2;`, `&euro;`…) de façon sûre.
  const decoded = cheerio.load(`<x>${withoutTags}</x>`)('x').text();
  return cleanText(decoded.replace(/\s+/g, ' '));
}

/** Valeur d'un champ du JSON, tolérante aux échappements invalides. */
function field(entry: string, key: string): string | undefined {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  return pattern.exec(entry)?.[1];
}

/**
 * Loyer depuis « LOYER : 750 € CC* ». On garde le montant et la mention de
 * charges, sans l'astérisque de renvoi.
 */
function parsePrice(raw: string): string | undefined {
  const amount = /(\d[\d\s.,]*)\s*€/.exec(raw);
  if (amount === null) return undefined;
  const suffix = /\bCC\b/i.test(raw) ? ' CC' : '';
  return `${amount[1]?.replace(/\s+/g, ' ').trim() ?? ''} €${suffix}`;
}

/** Surface « 29 m2 » → « 29 m² » (la plateforme écrit l'unité en ASCII). */
function parseArea(raw: string): string | undefined {
  const match = /(\d+(?:[.,]\d+)?)\s*m(?:²|2)/i.exec(raw);
  return match?.[1] !== undefined ? `${match[1]} m²` : undefined;
}

/**
 * Ville : la clé `ville` du JSON est souvent vide ; le titre (« … à Nice / … »)
 * et le slug du lien (« …-nice-GES… ») la portent de façon fiable.
 */
function parseCity(cityField: string, title: string, slug: string): string | undefined {
  if (cityField !== '') return cityField;
  // Pas de `\b` devant « à » : la limite de mot de JavaScript ne reconnaît que
  // [A-Za-z0-9_], donc « à » précédé d'une espace n'y forme aucune frontière —
  // la ville retombait alors sur le slug, en minuscules.
  const fromTitle = /(?:^|\s)à\s+([A-ZÀ-Ý][\wÀ-ÿ'-]+(?:[ -][A-ZÀ-Ý][\wÀ-ÿ'-]+)*)/.exec(title)?.[1];
  if (fromTitle !== undefined) return fromTitle;
  return /-([a-z]+(?:-[a-z]+)*)-[A-Z]{2,}\d/.exec(slug)?.[1]?.replace(/-/g, ' ');
}

/** Analyse la page de liste et rend une annonce par entrée du JSON. */
export function parseListPage(html: string, pageUrl: string, agencyName: string): RawListing[] {
  const block = /var\s+properties\s*=\s*(\[[\s\S]*?\]);/.exec(html)?.[1];
  if (block === undefined) return [];

  const byReference = new Map<string, RawListing>();

  for (const entry of block.split(/\},\s*\{/)) {
    const reference = field(entry, 'id');
    if (reference === undefined || reference === '' || byReference.has(reference)) continue;

    const slug = field(entry, 'lien') ?? '';
    let sourceUrl: string;
    try {
      sourceUrl = new URL(slug, pageUrl).toString();
    } catch {
      continue;
    }

    const title = decode(field(entry, 'titre'));
    const rawImage = field(entry, 'image');
    let image: string | undefined;
    if (rawImage !== undefined && rawImage !== '') {
      try {
        image = new URL(rawImage.replace(/\\+/g, ''), pageUrl).toString();
      } catch {
        image = undefined;
      }
    }

    byReference.set(
      reference,
      compactListing({
        sourceRef: reference,
        sourceUrl,
        title: title || undefined,
        description: decode(field(entry, 'description')) || undefined,
        priceText: parsePrice(decode(field(entry, 'prix'))),
        areaText: parseArea(decode(field(entry, 'surface'))),
        // « 1 pièce » dans le titre, ou « -1piece- » dans le slug.
        roomsText:
          /\d+\s*pi[eè]ces?/i.exec(title)?.[0] ??
          /(\d+)piece/i.exec(slug)?.[0]?.replace(/piece/i, ' pièces'),
        propertyTypeText: /appartement|studio|maison|villa|loft/i.exec(`${title} ${slug}`)?.[0],
        cityText: parseCity(decode(field(entry, 'ville')), title, slug),
        agencyName,
        contactFormUrl: sourceUrl,
        imageUrls: image !== undefined ? [image] : undefined,
        extra: { reference },
      }),
    );
  }

  return [...byReference.values()];
}
