/**
 * Source : ERA Immobilier (eraimmobilier.com) — réseau, demandé par
 * l'utilisateur le 2026-09-04 sous le nom de sa franchise niçoise « ERA Mac
 * Immobilier ». Voir la fiche d'étude dans `docs/sources.md`.
 *
 * ON NE LIT QUE `www.eraimmobilier.com`. Le site est un Angular rendu côté
 * serveur : chaque page embarque, dans un `<script id="ng-state">`, l'état de
 * transfert qui a servi à ce rendu — c'est-à-dire les mêmes annonces que les
 * cartes visibles, mais structurées et complètes (descriptif entier, photos,
 * agence avec son téléphone). On lit donc ce bloc plutôt que de reconstituer
 * les faits à partir de classes utilitaires générées.
 *
 * L'état nomme l'API interne dont il provient (`api.eraimmobilier.com`). Ce
 * domaine-là interdit tout accès automatisé (`Disallow: /`) : on ne l'appelle
 * PAS (§10). Lire le document que `www` nous a servi sur une URL autorisée est
 * une autre chose que d'aller frapper à une porte marquée « interdit ».
 *
 * ⚠️ LA GÉOLOCALISATION EST INEXPLOITABLE. Chaque annonce porte un `geoloc`,
 * mais le relevé du 2026-09-04 montre qu'il ne désigne pas le bien : sur dix
 * annonces niçoises, trois partagent au centième près le centroïde de Nice et
 * une pointe sur Cannes La Bocca, à l'adresse de son agence. Le champ
 * `precision_geoloc` vaut « 1 » partout et ne distingue donc rien. La retenir
 * placerait une punaise et une distance domicile-travail fausses sur la carte
 * — exactement le faux message qu'on a retiré ailleurs. On l'ignore (§17, §20)
 * et on s'en remet au descriptif, qui nomme souvent le quartier ou la rue.
 */

import type { RawListing } from '@rentfinder/shared';
import { cleanMultiline, cleanText } from '../../normalization/text.js';
import { compactListing, type ParsedList } from '../shared/raw-listing.js';

/** Page de résultats extraite de l'état de transfert. */
export interface EraPage extends ParsedList {
  /** Nombre total d'annonces annoncé par la recherche, `null` si absent. */
  readonly total: number | null;
}

/**
 * Biens qui ne sont pas des logements. ERA loue aussi des entrepôts, des
 * bureaux et des places de parking depuis la même page ; ils n'ont rien à
 * faire dans une recherche d'habitation (§3).
 */
const NOT_A_HOME = /parking|box|garage|entrep[oô]t|local|bureau|commerce|terrain|immeuble/i;

/** `"NC"` = non communiqué chez ERA : c'est une absence, pas une note (§17). */
const DPE_LETTER = /^[A-G]$/;

interface EraAgency {
  readonly enseigne?: unknown;
  readonly telephone?: unknown;
}

interface EraRow {
  readonly id?: unknown;
  readonly reference?: unknown;
  readonly libelle?: unknown;
  readonly descriptif?: unknown;
  readonly type_bien?: unknown;
  readonly prix?: unknown;
  readonly surface_habitable?: unknown;
  readonly nb_pieces?: unknown;
  readonly nb_chambres?: unknown;
  readonly ville?: unknown;
  readonly code_postal?: unknown;
  readonly bilan_dpe?: unknown;
  readonly date_publication?: unknown;
  readonly photo?: unknown;
  readonly agence?: unknown;
}

/**
 * « ERA MAC IMMOBILIER » → « ERA Mac Immobilier ».
 *
 * Les enseignes sont saisies en capitales dans le back-office du réseau, ce
 * qui crie dans une liste. On rétablit la casse, sauf sur ce qui ne peut pas
 * être un nom commun : le nom du réseau, les mots de deux lettres, et ceux qui
 * portent un point ou un chiffre — « ERA CD », « B.A », « JT2 » sont des
 * sigles, « MAC » et « MARESOL » des noms.
 */
const ACRONYM = /^(?:ERA|.{1,2}|.*[.\d].*)$/;

export function agencyLabel(raw: string): string {
  return cleanText(raw)
    .split(' ')
    .filter((word) => word !== '')
    .map((word) => (ACRONYM.test(word) ? word : word[0] + word.slice(1).toLowerCase()))
    .join(' ');
}

/** Les équipements sont des drapeaux `critere_*` ; on en fait du texte lisible. */
function featuresOf(row: Record<string, unknown>): string | undefined {
  const found = Object.entries(row)
    .filter(([key, value]) => key.startsWith('critere_') && value === 1)
    .map(([key]) => key.slice('critere_'.length).replace(/_/g, ' '));
  return found.length > 0 ? found.join(', ') : undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = cleanText(value);
    return text !== '' ? text : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function compactExtra(
  draft: Record<string, string | undefined>,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Localise, dans l'état de transfert, le résultat de recherche qui a rempli la
 * page. La clé porte l'URL de l'API interne, requête comprise, et varie donc
 * d'une page à l'autre : on la reconnaît à sa forme, et on garde la plus
 * fournie — une fiche embarque aussi une recherche de « biens similaires »,
 * limitée à trois annonces, qu'on ne veut pas confondre avec la liste.
 */
function findSearchResult(
  state: Record<string, unknown>,
): { rows: readonly unknown[]; total: number | null } | null {
  let best: { rows: readonly unknown[]; total: number | null } | null = null;
  for (const [key, value] of Object.entries(state)) {
    if (!key.includes('/annonces/search')) continue;
    if (typeof value !== 'object' || value === null) continue;
    const data = (value as { data?: unknown }).data;
    if (!Array.isArray(data)) continue;
    const meta = (value as { meta?: { total?: unknown } }).meta;
    const total = typeof meta?.total === 'number' ? meta.total : null;
    if (best === null || data.length > best.rows.length) best = { rows: data, total };
  }
  return best;
}

/** Une annonce ERA, telle que l'état de transfert la décrit. */
function toListing(row: EraRow, pageUrl: string): RawListing | null {
  const reference = asText(row.id);
  if (reference === undefined) return null;

  const type = asText(row.type_bien);
  if (type !== undefined && NOT_A_HOME.test(type)) return null;

  const agency = (
    typeof row.agence === 'object' && row.agence !== null ? row.agence : {}
  ) as EraAgency;
  const agencyName = asText(agency.enseigne);
  const dpe = asText(row.bilan_dpe);
  const price = asText(row.prix);
  const area = asText(row.surface_habitable);
  const rooms = asText(row.nb_pieces);
  const bedrooms = asText(row.nb_chambres);
  const url = new URL(`/annonces/${reference}`, pageUrl).toString();
  const photos = Array.isArray(row.photo)
    ? row.photo.filter(
        (item): item is string => typeof item === 'string' && item.startsWith('http'),
      )
    : [];
  const description =
    typeof row.descriptif === 'string' ? cleanMultiline(row.descriptif) : undefined;
  const roomsText = [
    rooms !== undefined && rooms !== '0' ? `${rooms} pièces` : undefined,
    bedrooms !== undefined && bedrooms !== '0' ? `${bedrooms} chambres` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' ');

  return compactListing({
    sourceRef: reference,
    sourceUrl: url,
    title: asText(row.libelle),
    description: description !== undefined && description !== '' ? description : undefined,
    priceText: price !== undefined ? `${price} €` : undefined,
    areaText: area !== undefined && area !== '0' ? `${area} m²` : undefined,
    roomsText: roomsText !== '' ? roomsText : undefined,
    propertyTypeText: type,
    cityText: asText(row.ville),
    postalCodeText: asText(row.code_postal),
    agencyName: agencyName !== undefined ? agencyLabel(agencyName) : undefined,
    phoneText: asText(agency.telephone),
    contactFormUrl: url,
    publishedAtText: asText(row.date_publication),
    imageUrls: photos.length > 0 ? photos : undefined,
    extra: compactExtra({
      reference: asText(row.reference),
      dpe: dpe !== undefined && DPE_LETTER.test(dpe) ? dpe : undefined,
      features: featuresOf(row as Record<string, unknown>),
    }),
  });
}

/** Extrait les annonces d'une page de liste ERA. */
export function parseListPage(html: string, pageUrl: string): EraPage {
  const encoded = /<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (encoded === null) {
    return { listings: [], warnings: ['État de transfert absent de la page'], total: null };
  }

  let state: Record<string, unknown>;
  try {
    state = JSON.parse(encoded[1] ?? '') as Record<string, unknown>;
  } catch {
    return { listings: [], warnings: ['État de transfert illisible'], total: null };
  }

  const found = findSearchResult(state);
  if (found === null) {
    return { listings: [], warnings: ['Aucun résultat de recherche dans la page'], total: null };
  }

  const listings: RawListing[] = [];
  for (const row of found.rows) {
    if (typeof row !== 'object' || row === null) continue;
    const listing = toListing(row as EraRow, pageUrl);
    if (listing !== null) listings.push(listing);
  }
  return { listings, warnings: [], total: found.total };
}
