/**
 * Source : ALERTES E-MAIL des portails (Leboncoin, SeLoger, Bien'ici…) — §6, §10.
 *
 * Voie 100 % conforme pour les portails qui interdisent l'accès automatisé
 * (DataDome) : ce n'est PAS du scraping. L'utilisateur crée une alerte de
 * recherche sur le portail ; le portail LUI envoie par e-mail les nouvelles
 * annonces ; RentFinder lit ces e-mails dans SA boîte (IMAP, lecture seule) et
 * en extrait les annonces. Aucune connexion au portail, aucun contournement.
 *
 * Ce module ne fait QUE le parsing du HTML d'un e-mail (pur, testable). Le
 * transport IMAP vit dans `core/email-import.ts`.
 *
 * Les e-mails sont des gabarits « tableau » : chaque annonce est un bloc
 * contenant un lien-image, un lien-titre (« Appartement · 3 pièces · 67 m² »)
 * et un prix, chacun pointant vers un lien de TRACKING distinct. On part donc
 * du lien-TITRE (seul repérable de façon fiable), on remonte à son bloc, et on
 * y lit prix / ville. Les liens de tracking sont dénoués : Bien'ici encode la
 * vraie URL en base64 dans le lien ; SeLoger garde un jeton opaque (on retombe
 * alors sur une référence de CONTENU). On n'invente jamais l'absent (§17).
 */

import * as cheerio from 'cheerio';
import type { RawListing } from '@rentfinder/shared';
import { cleanText } from '../../normalization/text.js';

/** Portail reconnu et comment en tirer une référence stable depuis l'URL. */
interface Portal {
  readonly id: string;
  readonly host: RegExp;
  /** Extrait l'identifiant de l'annonce depuis l'URL réelle (canonique). */
  readonly reference: (url: URL) => string | null;
}

const PORTALS: readonly Portal[] = [
  {
    id: 'leboncoin',
    host: /(^|\.)leboncoin\.fr$/i,
    reference: (url) => /(\d{8,})/.exec(url.pathname)?.[1] ?? null,
  },
  {
    id: 'seloger',
    host: /(^|\.)seloger\.com$/i,
    // Deux générations d'identifiants coexistent : l'ancien tout numérique et
    // l'actuel alphanumérique en capitales (« /annonce/262DQEQC5SVU »).
    reference: (url) =>
      /\/([0-9A-Z]{8,})\/?$/.exec(url.pathname)?.[1] ??
      /\/(\d{6,})/.exec(url.pathname)?.[1] ??
      null,
  },
  {
    id: 'bienici',
    host: /(^|\.)bienici\.com$/i,
    reference: (url) => /\/annonce\/([a-z0-9-]+)/i.exec(url.pathname)?.[1] ?? null,
  },
];

/** Sous-domaines de tracking : l'href y pointe, la vraie URL est ailleurs. */
const TRACKING_HOST = /(^|\.)(click|link|clic|url\d*|email|mail|t)\./i;

interface Resolved {
  readonly portal: Portal;
  readonly url: URL;
  /** Vraie URL d'annonce (pas un sous-domaine de tracking). */
  readonly canonical: boolean;
}

/** Décode un segment base64url s'il contient une URL http (cas Bien'ici). */
function decodeEmbeddedUrl(segment: string): string | null {
  if (segment.length < 24 || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    const decoded = Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    return /^https?:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Toutes les URL candidates cachées dans un href (params + segments base64). */
function urlCandidates(href: string): string[] {
  const out = [href];
  let outer: URL | undefined;
  try {
    outer = new URL(href);
  } catch {
    return out;
  }
  for (const value of outer.searchParams.values()) {
    if (/^https?%3a|^https?:\/\//i.test(value)) out.push(decodeURIComponent(value));
  }
  for (const segment of outer.pathname.split('/')) {
    const embedded = decodeEmbeddedUrl(segment);
    if (embedded !== null) out.push(embedded);
  }
  return out;
}

/**
 * Dénoue une URL de lien d'e-mail vers son portail d'origine. On teste l'href,
 * ses paramètres, puis ses segments base64. `null` si aucun portail reconnu.
 */
export function resolvePortalUrl(href: string): Resolved | null {
  let fallback: Resolved | null = null;
  for (const candidate of urlCandidates(href)) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    const portal = PORTALS.find((p) => p.host.test(url.hostname));
    if (portal === undefined) continue;
    const resolved: Resolved = { portal, url, canonical: !TRACKING_HOST.test(url.hostname) };
    // On préfère la vraie URL d'annonce (canonique) à un sous-domaine de
    // tracking : Bien'ici encode la vraie URL en base64 APRÈS le lien `link.…`.
    if (resolved.canonical) return resolved;
    fallback ??= resolved;
  }
  return fallback;
}

/**
 * Premier montant « … € » trouvé (loyer). On n'accepte les espaces qu'entre
 * milliers (« 1 890 € ») pour ne pas avaler un code postal collé au prix
 * (« 06000 570 € » → « 570 € »).
 */
function findPrice(text: string): string | undefined {
  const match = /(?<!\d)(\d{1,3}(?:[\s\u00a0 .]\d{3})+|\d{1,4})\s*\u20ac/.exec(text);
  return match?.[0]?.replace(/[\s\u00a0 ]+/g, ' ').trim();
}

/** Première surface « … m² » trouvée dans un texte. */
function findArea(text: string): string | undefined {
  return /(\d[\d.,]*)\s*m²/i.exec(text)?.[0];
}

/** Ville + code postal depuis un texte « Nice, 06000 » ou « Nice 06000 ». */
function findLocation(text: string): { city?: string; postalCode?: string } {
  const match = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ -]{1,40}?)[,\s]+(\d{5})\b/.exec(text);
  if (match === null) return {};
  return { city: cleanText(match[1]).replace(/\s+/g, ' ').trim(), postalCode: match[2] };
}

/**
 * Détails du bien lus dans le texte du bloc : typologie, pièces/chambres,
 * meublé, charges. On ne devine pas l'absent (§17) — chaque champ reste absent
 * si le digest ne le donne pas.
 */
interface ListingDetails {
  readonly propertyTypeText?: string;
  readonly roomsText?: string;
  readonly furnishedText?: string;
  readonly chargesIncluded: boolean;
}

function extractDetails(text: string): ListingDetails {
  const pieces = /\d+\s*pièces?/i.exec(text)?.[0];
  const chambres = /\d+\s*chambres?/i.exec(text)?.[0];
  // « X pièces • Y chambres » alimente à la fois le nb de pièces et de chambres.
  const roomsText = [pieces, chambres].filter((p) => p !== undefined).join(' • ') || undefined;

  // Type explicite d'abord ; à défaut, la présence de « pièce(s) » désigne un
  // appartement (jamais une simple chambre ni un parking) — ce qui évite en
  // prime que « 1 chambre » (nb de chambres) soit pris pour une location de
  // chambre par la normalisation.
  let propertyTypeText: string | undefined;
  if (/\bstudio\b/i.test(text)) propertyTypeText = 'studio';
  else if (/\bmaison\b|\bvilla\b/i.test(text)) propertyTypeText = 'maison';
  else if (/\bloft\b/i.test(text)) propertyTypeText = 'loft';
  else if (/\bduplex\b/i.test(text)) propertyTypeText = 'duplex';
  else if (/\bappartement\b/i.test(text) || pieces !== undefined) propertyTypeText = 'appartement';

  let furnishedText: string | undefined;
  if (/\bnon\s+meubl/i.test(text)) furnishedText = 'non meublé';
  else if (/\bmeubl[ée]/i.test(text)) furnishedText = 'meublé';

  const chargesIncluded = /charges comprises|\bcc\b|\+\s*cc\b|\btcc\b/i.test(text);

  return {
    ...(propertyTypeText !== undefined ? { propertyTypeText } : {}),
    ...(roomsText !== undefined ? { roomsText } : {}),
    ...(furnishedText !== undefined ? { furnishedText } : {}),
    chargesIncluded,
  };
}

/** Référence de repli quand le portail n'expose pas d'identifiant (SeLoger). */
function contentReference(portalId: string, parts: readonly (string | undefined)[]): string {
  const slug = parts
    .filter((p): p is string => p !== undefined && p !== '')
    .join('|')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug !== '' ? slug : `${portalId}-inconnu`;
}

/** Type minimal d'un nœud cheerio (évite d'importer les types d'éléments). */
type Node = ReturnType<cheerio.CheerioAPI>;

/** URL qui pointe vraiment vers une photo (extension image, éventuel `?token`). */
const IMAGE_URL = /\.(?:jpe?g|png|webp)(?:[?&#]|$)/i;
/**
 * Habillage d'e-mail à écarter : logos, icônes sociales, pixels de tracking, et
 * surtout les ASSETS de gabarit marketing (badges « exclusivité », flèches
 * « voir l'annonce », boutons). Les vraies photos sont sur les CDN photo des
 * portails (`mms.seloger.com`, `file.bienici.com`, `img.leboncoin.fr`), jamais
 * sur les hôtes d'e-mailing (`image.by.seloger.com/lib/…`, `mail-sender.…`).
 */
const IMAGE_DENY =
  /mail-sender|by\.seloger|\/lib\/|\/static\/|facebook|instagram|linkedin|twitter|x_round|transparent|spacer|pixel|logo|badge|fleche|arrow|bouton|button|exclusiv/i;

/**
 * Première photo d'annonce trouvée dans un nœud. Les digests placent la photo
 * soit en `<img src>` (Bien'ici), soit en `background-image` CSS / VML Outlook
 * (SeLoger) — on regarde les deux, en filtrant l'habillage.
 */
function findImage($: cheerio.CheerioAPI, node: Node): string | undefined {
  const urls: string[] = [];
  node.find('img[src]').each((_i, el) => {
    const src = $(el).attr('src');
    if (src !== undefined) urls.push(src);
  });
  node.find('[style*="background"]').each((_i, el) => {
    const match = /url\(\s*['"]?(https?:\/\/[^'")\s]+)/i.exec($(el).attr('style') ?? '');
    if (match?.[1] !== undefined) urls.push(match[1]);
  });
  return urls.find((url) => IMAGE_URL.test(url) && !IMAGE_DENY.test(url));
}

/**
 * Remonte au bloc de l'annonce et y repère sa photo. Le bloc « texte » est le
 * 1er ancêtre portant un prix (tight, pour ne pas mélanger les voisins) ; la
 * photo, elle, vit souvent un cran plus haut (rangée image au-dessus du titre),
 * donc on continue de remonter pour la trouver — chaque annonce a la sienne.
 */
function climbToBlock(anchor: Node, $: cheerio.CheerioAPI): { block: Node; image?: string } {
  let node = anchor;
  let block: Node | null = null;
  let image: string | undefined;
  for (let depth = 0; depth < 6; depth += 1) {
    const parent = node.parent();
    if (parent.length === 0) break;
    node = parent;
    if (block === null && /€/.test(node.text())) block = node;
    if (image === undefined) image = findImage($, node);
    if (block !== null && image !== undefined) break;
  }
  return { block: block ?? anchor, image };
}

/** Construit l'annonce à partir de son lien-titre (celui qui porte « m² »). */
function buildFromTitle(
  $: cheerio.CheerioAPI,
  anchor: Node,
  title: string,
  resolved: Resolved,
): RawListing | null {
  const { portal, url, canonical } = resolved;
  const { block, image } = climbToBlock(anchor, $);
  const blockText = cleanText(block.text().replace(/\s+/g, ' '));

  const rawPrice = findPrice(title) ?? findPrice(blockText);
  const areaText = findArea(title) ?? findArea(blockText);
  const { city, postalCode } = findLocation(blockText);
  if (rawPrice === undefined && areaText === undefined) return null;

  // Détails lus dans le titre + le bloc (typologie, pièces, meublé, charges).
  const details = extractDetails(`${title} ${blockText}`);
  // On réinjecte « cc » dans le prix pour que la normalisation marque le loyer
  // comme charges comprises (findPrice ne garde que le montant).
  const priceText =
    rawPrice !== undefined ? (details.chargesIncluded ? `${rawPrice} cc` : rawPrice) : undefined;

  const reference =
    (canonical ? portal.reference(url) : null) ??
    contentReference(portal.id, [areaText, priceText, postalCode, city]);
  // Lien ouvert par l'utilisateur : la vraie URL si on l'a dénouée, sinon le
  // lien de tracking d'origine (qui redirige bien vers l'annonce).
  const sourceUrl = canonical ? `${url.origin}${url.pathname}` : (anchor.attr('href') ?? url.href);

  return {
    sourceRef: `${portal.id}:${reference}`,
    sourceUrl,
    title,
    ...(priceText !== undefined ? { priceText } : {}),
    ...(areaText !== undefined ? { areaText } : {}),
    ...(details.propertyTypeText !== undefined
      ? { propertyTypeText: details.propertyTypeText }
      : {}),
    ...(details.roomsText !== undefined ? { roomsText: details.roomsText } : {}),
    ...(details.furnishedText !== undefined ? { furnishedText: details.furnishedText } : {}),
    ...(city !== undefined ? { cityText: city } : {}),
    ...(postalCode !== undefined ? { postalCodeText: postalCode } : {}),
    contactFormUrl: sourceUrl,
    ...(image !== undefined && /^https?:/i.test(image) ? { imageUrls: [image] } : {}),
    extra: { reference, portal: portal.id },
  };
}

/**
 * Extrait les annonces d'un e-mail d'alerte (HTML). Une occurrence par annonce
 * distincte (dédoublonnée sur la référence). Le `sourceId` de collecte reste
 * `email-alerts` ; le portail d'origine est porté par `sourceUrl` et
 * `extra.portal` (§13, §38).
 */
/**
 * Référence stable d'une annonce depuis son URL CANONIQUE (« seloger:262DQ… »).
 *
 * Les liens des e-mails sont des redirections opaques : au moment du parsing on
 * ne peut que fabriquer une référence à partir du contenu (surface, prix,
 * ville). Or ce contenu varie d'un e-mail à l'autre — l'un nomme la commune,
 * l'autre non — et la MÊME annonce se retrouvait alors sous deux références,
 * donc en doublon. Une fois le lien dénoué, on rétablit la vraie identité.
 */
export function referenceFromUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const portal = PORTALS.find((candidate) => candidate.host.test(url.hostname));
  if (portal === undefined) return null;
  const reference = portal.reference(url);
  return reference === null ? null : `${portal.id}:${reference}`;
}

/** Localisation lue dans l'URL canonique d'une annonce. */
export interface UrlLocation {
  readonly cityText?: string;
  readonly postalCodeText?: string;
  readonly districtText?: string;
}

/**
 * Extrait la localisation du CHEMIN de l'URL canonique.
 *
 * Les digests des portails existent en deux gabarits : l'un nomme la commune
 * (« 1 pièce • 22 m² Nice, 06100 »), l'autre pas (« 1 pièce · 23,55 m² »). 72 %
 * des annonces arrivaient donc sans ville — ce qui les rendait incomparables au
 * dédoublonnage, dont les clés sont préfixées par la commune.
 *
 * L'URL, elle, la porte presque toujours, et fait autorité — c'est le portail
 * qui l'écrit, on ne devine rien (§17). Deux formes rencontrées :
 *
 *   …/appartement/nice-06/baumettes/26A8CE41HBAQ.htm   → ville + QUARTIER
 *   …/alpes-maritimes-06/nice-06000/26AUM6K            → ville + code postal
 */
export function locationFromUrl(href: string): UrlLocation {
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    return {};
  }

  // « nice-06000 » (code postal complet) ou « nice-06 » (département seul).
  //
  // Le chemin peut en contenir PLUSIEURS : « /alpes-maritimes-06/nice-06000/ »
  // porte le département avant la commune. On préfère donc la forme à cinq
  // chiffres, et à défaut le dernier segment — le plus profond est le plus
  // précis. Prendre le premier rendait « alpes maritimes » comme ville.
  const matches = [...path.matchAll(/\/([a-z][a-z-]*?)-(\d{2}|\d{5})(?=\/)/g)];
  if (matches.length === 0) return {};
  const match = matches.find((m) => m[2]?.length === 5) ?? matches[matches.length - 1];
  if (match?.[1] === undefined) return {};
  const city = match[1].replace(/-/g, ' ');
  const code = match[2] ?? '';

  // Le segment qui suit immédiatement la commune est le quartier, quand il
  // n'est pas déjà l'identifiant de l'annonce (majuscules et chiffres).
  const after = path.slice((match.index ?? 0) + match[0].length + 1).split('/')[0] ?? '';
  const district =
    after !== '' && /^[a-z][a-z-]*$/.test(after) ? after.replace(/-/g, ' ') : undefined;

  return {
    cityText: city,
    ...(code.length === 5 ? { postalCodeText: code } : {}),
    ...(district !== undefined ? { districtText: district } : {}),
  };
}

export function parseAlertEmail(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const bySourceRef = new Map<string, RawListing>();

  $('a[href]').each((_i, el) => {
    const anchor = $(el);
    const title = cleanText(anchor.text().replace(/\s+/g, ' '));
    // Seul le lien-TITRE d'une annonce porte surface/typologie : point d'entrée
    // fiable pour délimiter un bloc (les liens image/prix sont ignorés ici).
    if (!/\bm²|pièces?\b|studio/i.test(title)) return;
    const resolved = resolvePortalUrl(anchor.attr('href') ?? '');
    if (resolved === null) return;

    const listing = buildFromTitle($, anchor, title, resolved);
    if (listing !== null && !bySourceRef.has(listing.sourceRef)) {
      bySourceRef.set(listing.sourceRef, listing);
    }
  });

  return [...bySourceRef.values()];
}
