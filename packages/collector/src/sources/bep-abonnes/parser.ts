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
import { compactListing } from '../shared/raw-listing.js';

/**
 * URL vers laquelle pointe une annonce du bulletin abonné.
 *
 * Les références du bulletin sont ÉPHÉMÈRES : elles changent à chaque nouveau
 * bulletin, si bien qu'un lien `?references=<ref>` d'hier renvoie « référence
 * inconnue » aujourd'hui. Il n'existe donc AUCUN lien stable par annonce — on
 * pointe vers le bulletin lui-même (page d'accueil abonné), où l'utilisateur,
 * une fois connecté, retrouve l'annonce par sa référence (affichée sur la
 * fiche RentFinder). Voir `docs/sources.md`.
 */
const BULLETIN_URL = 'http://abonnes.beplogement.com/w_index_abonnes.php';

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

/**
 * Communes desservies par le bulletin, les plus longues d'abord pour que
 * « SAINT LAURENT DU VAR » l'emporte sur un éventuel préfixe plus court.
 *
 * Le bulletin écrit la localisation en un seul bloc — « NICE EST / MONT BORON »,
 * « VILLENEUVE LOUBET PROXIMITE VILLAGE AU COEUR DE LA COTE D AZUR ». Tel quel,
 * ce libellé était stocké comme NOM DE COMMUNE : impossible d'en déduire un code
 * postal, et l'affichage montrait une phrase entière à la place d'une ville.
 * On isole donc la commune, le reste devient le quartier (§20).
 */
const BEP_CITIES: readonly string[] = [
  'VILLENEUVE LOUBET',
  'SAINT LAURENT DU VAR',
  'ROQUEBRUNE CAP MARTIN',
  'VILLEFRANCHE SUR MER',
  'BEAULIEU SUR MER',
  'CAGNES SUR MER',
  'MANDELIEU LA NAPOULE',
  'JUAN LES PINS',
  'GOLFE JUAN',
  'SAINT JEAN CAP FERRAT',
  'CAP D AIL',
  'LA TRINITE',
  'LE CANNET',
  'VALLAURIS',
  'ANTIBES',
  'VENCE',
  'GRASSE',
  'CANNES',
  'MENTON',
  'MONACO',
  'BIOT',
  'NICE',
];

/** Sépare « NICE EST / MONT BORON » en commune + quartier. */
export function splitLocation(label: string): { city: string; district?: string } {
  const upper = cleanText(label).toUpperCase().replace(/\*+/g, ' ').replace(/\s+/g, ' ').trim();
  const city = BEP_CITIES.find((name) => upper.startsWith(name));
  if (city === undefined) return { city: cleanText(label) };

  // Le reste : zone puis quartier, séparés par « / ». On garde le segment le
  // plus parlant (après le dernier « / »), nettoyé des marqueurs du bulletin.
  const rest = upper.slice(city.length).replace(/[/]+/g, ' / ').replace(/\s+/g, ' ').trim();
  const district = rest
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 2 && !/^E$/i.test(part))
    .at(-1);

  return district !== undefined && district !== '' ? { city, district } : { city };
}

export interface ParsedBulletin {
  readonly listings: readonly RawListing[];
  readonly warnings: readonly string[];
}

/** Analyse le bulletin complet et en extrait les annonces. */
/**
 * Analyse UNE annonce du bulletin, du titre `startIndex` au titre suivant
 * `endIndex`. Extraite pour garder `parseBulletin` (l'itération) simple.
 */
function parseBulletinEntry(
  html: string,
  reference: string,
  location: string,
  startIndex: number,
  endIndex: number,
): RawListing {
  const block = html.slice(startIndex, endIndex);
  const text = toText(block);

  // La date du bulletin est juste AVANT le titre : on la cherche en arrière.
  const before = html.slice(Math.max(0, startIndex - 1500), startIndex);
  const lastDate = [...before.matchAll(/BULLETIN[^)]*?DU\s+(\d{2})\/(\d{2})\/(\d{4})/gi)].at(-1);
  const publishedAtText =
    lastDate !== undefined ? `${lastDate[3]}-${lastDate[2]}-${lastDate[1]}` : undefined;

  // Type + surface depuis « DESCRIPTION : {type}, {surface} M² ».
  const description = text.match(/DESCRIPTION\s*:\s*(.+?)(?:\s*$)/i)?.[1] ?? text;
  const typeMatch = description.match(/^([A-ZÀ-Ý' ]+?)(?:,|\bEN\b|\d)/);
  const propertyTypeText = typeMatch?.[1] !== undefined ? cleanText(typeMatch[1]) : undefined;
  // Nombre de pièces : notation « T2 »/« F3 » ou « 3 PIECES ». Sans cela, seuls
  // les studios étaient comptés (le type s'arrête au premier chiffre).
  const roomsText =
    /\b[TF](\d)\b/i.exec(description)?.[0] ??
    /\d+\s*PI[EÈ]CES?/i.exec(description)?.[0] ??
    (/\bSTUDIO\b/i.test(description) ? 'studio' : undefined);
  const dpe = text.match(/CLASSE\s+ENERGETIQUE\s+([A-G])\b/i)?.[1];

  // Photos : uniquement les URLs (§11), jamais de téléchargement.
  // Photos : liens ET balises <img>, en absolu (§11 : on ne stocke que l'URL).
  // N'accepter que les `href` faisait perdre les annonces dont la vignette
  // n'est portée que par un <img src>.
  const rawImages = [...block.matchAll(/(?:href|src)=["']([^"']+\.(?:jpe?g|png|webp))["']/gi)].map(
    (m) => m[1] as string,
  );
  const imageUrls = [
    ...new Set(
      rawImages
        .map((raw) => {
          try {
            return new URL(raw, BULLETIN_URL).toString();
          } catch {
            return null;
          }
        })
        .filter((url): url is string => url !== null && !/logo|banniere|pixel|spacer/i.test(url)),
    ),
  ];

  const place = splitLocation(location);

  return compactListing({
    sourceRef: reference,
    sourceUrl: BULLETIN_URL,
    title: `${propertyTypeText ?? ''} — ${location}`.trim(),
    description,
    priceText: text.match(/LOYER\s*:\s*([\d.,]+)\s*€/i)?.[0],
    // « charges comprises » : on le signale à la normalisation via le prix.
    chargesText: /CHARGES\s+COMPRISES/i.test(text) ? 'charges comprises' : undefined,
    areaText: description.match(/(\d+(?:[.,]\d+)?)\s*M²/i)?.[0],
    propertyTypeText,
    furnishedText: description,
    // La localisation du bulletin sert de ville : le filtre ne garde que Nice.
    // Commune et quartier séparés : le libellé brut du bulletin mélangeait les
    // deux, ce qui empêchait toute déduction de code postal (§20).
    cityText: place.city,
    roomsText,
    agencyName: 'BEP Logement',
    contactFormUrl: BULLETIN_URL,
    publishedAtText,
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    extra: {
      ...(dpe !== undefined ? { dpe: dpe.toUpperCase() } : {}),
      ...(place.district !== undefined ? { quartier: place.district } : {}),
    },
  });
}

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
    if (byRef.has(reference)) continue;

    // Contenu de l'annonce : de ce titre au titre suivant.
    const end = anchors[i + 1]?.index ?? html.length;
    const listing = parseBulletinEntry(html, reference, cleanText(anchor[2]), anchor.index, end);
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
