/**
 * Parser du bulletin abonné BEP Logement (page « Classeurs »).
 *
 * ACCÈS PAYÉ par l'utilisateur (§6) — voir `index.ts` pour le flux de connexion.
 *
 * Le bulletin est une longue table HTML « à l'ancienne ». Chaque annonce est un
 * bloc introduit par un en-tête de TYPE (ligne rouge `bgcolor="#FFAAAA"`), puis :
 *   ( BULLETIN N° … DU jj/mm/aaaa )      → date de publication
 *   {référence} : {localisation}         → réf + secteur (sert de ville)
 *   DESCRIPTION : {type}, {surface} M², … → description + surface
 *   LOYER : {prix} €  … CHARGES COMPRISES … CLASSE ENERGETIQUE {A-G}
 *   liens photos beptransaction.com/bep/docs/*.jpg
 *
 * On s'ancre sur ces LIBELLÉS (stables car porteurs de sens), pas sur le HTML
 * de mise en page. Le bulletin est régional : le filtrage sur Nice est laissé
 * au scoring (§16).
 */

import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

const REF_URL = (ref: string): string =>
  `http://abonnes.beplogement.com/w_classeurs_references.php?references=${ref}`;

/** Décode les entités HTML utiles et retire les balises. */
function toText(html: string): string {
  return cleanText(
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&euro;/gi, '€')
      .replace(/&deg;/gi, '°')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&'),
  );
}

export interface ParsedBulletin {
  readonly listings: readonly RawListing[];
  readonly warnings: readonly string[];
}

/** Analyse le bulletin complet et en extrait les annonces. */
export function parseBulletin(html: string): ParsedBulletin {
  const warnings: string[] = [];
  const listings: RawListing[] = [];
  const byRef = new Map<string, RawListing>();

  // Ancre : le titre « {référence} : {localisation} ». Un en-tête de type
  // (ligne rouge) peut regrouper PLUSIEURS annonces — on itère donc sur chaque
  // titre, pas sur les en-têtes. Le bloc d'une annonce va d'un titre au suivant.
  const titleRe = /<b>\s*(\d{6,7})\s*:\s*([^<]+?)\s*<\/b>/g;
  const anchors = [...html.matchAll(titleRe)];

  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];
    if (anchor?.[1] === undefined || anchor[2] === undefined || anchor.index === undefined)
      continue;
    const reference = anchor[1];
    const location = cleanText(anchor[2]);
    if (byRef.has(reference)) continue;

    // Contenu de l'annonce : de ce titre au titre suivant.
    const end = anchors[i + 1]?.index ?? html.length;
    const block = html.slice(anchor.index, end);
    const text = toText(block);

    // La date du bulletin est juste AVANT le titre : on la cherche en arrière.
    const before = html.slice(Math.max(0, anchor.index - 1500), anchor.index);
    const dateMatches = [...before.matchAll(/BULLETIN[^)]*?DU\s+(\d{2})\/(\d{2})\/(\d{4})/gi)];
    const lastDate = dateMatches.at(-1);
    const publishedAtText =
      lastDate !== undefined ? `${lastDate[3]}-${lastDate[2]}-${lastDate[1]}` : undefined;

    // Type + surface depuis « DESCRIPTION : {type}, {surface} M² ».
    const description = text.match(/DESCRIPTION\s*:\s*(.+?)(?:\s*$)/i)?.[1] ?? text;
    const typeMatch = description.match(/^([A-ZÀ-Ý' ]+?)(?:,|\bEN\b|\d)/);
    const propertyTypeText = typeMatch?.[1] !== undefined ? cleanText(typeMatch[1]) : undefined;
    const areaText = description.match(/(\d+(?:[.,]\d+)?)\s*M²/i)?.[0];

    // Loyer + charges + DPE.
    const priceText = text.match(/LOYER\s*:\s*([\d.,]+)\s*€/i)?.[0];
    const chargesIncluded = /CHARGES\s+COMPRISES/i.test(text);
    const dpeMatch = text.match(/CLASSE\s+ENERGETIQUE\s+([A-G])\b/i);

    // Photos : uniquement les URLs (§11), jamais de téléchargement.
    const imageUrls = [...block.matchAll(/href=["'](https?:\/\/[^"']+\.jpg)["']/gi)].map(
      (m) => m[1] as string,
    );

    const listing: RawListing = {
      sourceRef: reference,
      sourceUrl: REF_URL(reference),
      title: `${propertyTypeText ?? ''} — ${location}`.trim(),
      description,
      ...(priceText !== undefined ? { priceText } : {}),
      // « charges comprises » : on le signale à la normalisation via le prix.
      ...(chargesIncluded ? { chargesText: 'charges comprises' } : {}),
      ...(areaText !== undefined ? { areaText } : {}),
      ...(propertyTypeText !== undefined ? { propertyTypeText } : {}),
      furnishedText: description,
      // La localisation du bulletin sert de ville : le filtre ne garde que Nice.
      cityText: location,
      ...(dpeMatch?.[1] !== undefined ? { extra: { dpe: dpeMatch[1].toUpperCase() } } : {}),
      agencyName: 'BEP Logement',
      contactFormUrl: REF_URL(reference),
      ...(publishedAtText !== undefined ? { publishedAtText } : {}),
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
    };

    byRef.set(reference, listing);
    listings.push(listing);
  }

  // §61 : un bulletin qui rend des annonces sans aucun loyer signale un
  // changement de structure.
  if (listings.length > 0 && listings.every((l) => l.priceText === undefined)) {
    warnings.push(
      'Aucune annonce ne contient de loyer — structure du bulletin probablement modifiée',
    );
  }

  return { listings, warnings };
}
