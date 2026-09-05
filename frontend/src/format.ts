/**
 * Formatage pour l'affichage.
 *
 * Règle transverse : une donnée absente s'affiche « — » ou « inconnu », jamais
 * « 0 » ni une estimation (§17). L'utilisateur doit pouvoir distinguer d'un
 * coup d'œil « aucun favori » de « la source ne publie pas les favoris ».
 */

import { SOURCES } from './sources.generated.js';
import type { PropertyType, TrackingStatus } from '@rentfinder/shared';
import { formatCommune, formatLocation } from '@rentfinder/shared';

/**
 * Valeur non fournie par la source.
 *
 * Deux formes, selon la place : le tiret dans les lignes DENSES d'une carte
 * (« 650 € · — · 1 pièce »), où une phrase noierait l'information utile ; le
 * libellé « N/A » dans les listes de caractéristiques, où un tiret laisse le
 * lecteur se demander si la donnée manque ou vaut zéro.
 */
export const UNKNOWN = '—';
export const UNKNOWN_LABEL = 'N/A';

export function formatPrice(price: number | null): string {
  return price === null ? UNKNOWN : `${Math.round(price)} €`;
}

export function formatArea(area: number | null): string {
  return area === null ? UNKNOWN : `${Number.isInteger(area) ? area : area.toFixed(1)} m²`;
}

export function formatRooms(rooms: number | null): string {
  if (rooms === null) return UNKNOWN;
  return rooms === 1 ? '1 pièce' : `${rooms} pièces`;
}

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartment: 'Appartement',
  house: 'Maison',
  studio: 'Studio',
  room: 'Chambre',
  loft: 'Loft',
  parking: 'Stationnement',
  other: 'Autre',
  unknown: 'Type inconnu',
};

export const formatPropertyType = (type: PropertyType): string => PROPERTY_TYPE_LABELS[type];

export function formatCity(city: string | null): string {
  if (city === null) return UNKNOWN;
  // La ville est stockée en forme comparable (minuscules, sans accent ni
  // tiret) pour le dédoublonnage. On délègue au formateur PARTAGÉ pour que
  // l'interface, les notifications et les messages écrivent exactement la même
  // chose (§20) : il rétablit l'orthographe officielle des communes
  // (« cagnes sur mer » → « Cagnes-sur-Mer ») et détache le quartier que
  // certaines sources y collent (« nice magnan » → « Nice »).
  return formatCommune(city);
}

/** Particules françaises laissées en minuscules dans une adresse. */
const ADDRESS_PARTICLES = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'l',
  'd',
  'et',
  'au',
  'aux',
  'sur',
  'sous',
  'en',
  'à',
  'a',
  'bis',
  'ter',
]);

/** Abréviations de voies, dépliées pour un affichage homogène. */
const ADDRESS_ABBREVIATIONS: Record<string, string> = {
  bd: 'boulevard',
  bld: 'boulevard',
  blvd: 'boulevard',
  boul: 'boulevard',
  av: 'avenue',
  ave: 'avenue',
  imp: 'impasse',
  chem: 'chemin',
  ch: 'chemin',
  prom: 'promenade',
  bat: 'bât.',
  pl: 'place',
  rte: 'route',
  sq: 'square',
  all: 'allée',
  crs: 'cours',
  qu: 'quai',
  pass: 'passage',
  res: 'résidence',
  resid: 'résidence',
  mte: 'montée',
  cor: 'corniche',
  trav: 'traverse',
  vla: 'villa',
};

/** Chiffres romains (Napoléon III, Albert 1er…) gardés en capitales. */
const ROMAN_NUMERAL = /^[ivx]{1,4}$/i;

/** Capitalise un mot d'adresse en respectant traits d'union et apostrophes. */
function capitalizeAddressWord(word: string, isFirst: boolean): string {
  // Segments séparés par un trait d'union : chacun est capitalisé.
  if (word.includes('-')) {
    return word
      .split('-')
      .map((part, index) => capitalizeAddressWord(part, isFirst && index === 0))
      .join('-');
  }
  // « l'hermitage » → « l'Hermitage » : la particule élidée reste minuscule.
  const elision = /^([ld])['’](.+)$/i.exec(word);
  if (elision !== null) {
    return `${elision[1]!.toLowerCase()}’${capitalizeAddressWord(elision[2]!, false)}`;
  }
  if (word === '') return word;
  // « 77bis », « 26/30 », « 1er » : les jetons commençant par un chiffre
  // restent en minuscules après le chiffre.
  if (/^\d/.test(word)) return word.toLowerCase();
  if (ROMAN_NUMERAL.test(word)) return word.toUpperCase();
  const lower = word.toLowerCase();
  if (!isFirst && ADDRESS_PARTICLES.has(lower)) return lower;
  return lower[0]!.toUpperCase() + lower.slice(1);
}

/**
 * Adresse lisible, quelle que soit la forme publiée par la source :
 * « 260 BOULEVARD DE LA MADELEINE » → « 260 Boulevard de la Madeleine »,
 * « 26/30 BLD NAPOLEON III » → « 26/30 Boulevard Napoleon III », « 144 rue
 * France » → « 144 Rue France ». Les particules restent minuscules, les
 * chiffres romains en capitales, les abréviations de voies sont dépliées. Les
 * accents absents ne sont PAS restaurés — on n'invente pas de donnée (§17).
 */
/**
 * Mots par lesquels une DESCRIPTION commence, et qu'aucune voie ne porte.
 *
 * Plusieurs sources déversent le début de l'annonce dans le champ adresse —
 * « 84 rue Barberis Très bel appartement de », parfois même collé au dernier
 * mot : « 10 Avenue Sainte-MargueriteAu sein d'une résidence ». Le champ
 * devient alors illisible et l'affichage perd toute uniformité.
 *
 * La coupe reste PRUDENTE : elle n'intervient qu'après au moins deux mots,
 * pour ne jamais amputer une voie qui commencerait par l'un de ces termes.
 */
const DESCRIPTION_OPENERS =
  /\b(joli|jolie|beau|bel|belle|magnifique|superbe|charmant|charmante|spacieux|spacieuse|lumineux|lumineuse|agréable|très|tres|idéalement|idealement|situé|située|situe|situee|venez|découvrez|decouvrez|exclusivité|exclusivite|entièrement|entierement|récemment|recemment|nouvellement|rénové|renove|rénovée|renovee|refait|comprenant|composé|compose|composée|composee|offrant|bénéficie|beneficie|disponible|au sein|à louer|a louer|coup de cœur|coup de coeur|dans une résidence|dans un immeuble)\b/iu;

/**
 * Coupe ce qui suit la voie quand une description a débordé dans le champ.
 * Rend l'adresse telle quelle si rien ne trahit un débordement (§17 : on
 * n'invente pas, on se contente de retirer ce qui n'est pas une adresse).
 */
function trimDescriptionBleed(address: string): string {
  // Deux textes concaténés sans espace : « …MargueriteAu sein… ». Une voie
  // française ne colle jamais une minuscule à une majuscule dans un mot.
  //
  // `\p{Ll}`/`\p{Lu}` et non `[a-zà-ÿ]`/`[A-ZÀ-Ÿ]` : la seconde plage couvre
  // aussi les MINUSCULES accentuées (U+00E0–U+00FF), si bien que « Montée »
  // était coupé après « Mont ».
  const glued = /(\p{Ll})(\p{Lu})/u.exec(address);
  const withoutGlue = glued?.index !== undefined ? address.slice(0, glued.index + 1) : address;

  const opener = DESCRIPTION_OPENERS.exec(withoutGlue);
  if (opener?.index === undefined || opener.index === 0) return withoutGlue;
  const head = withoutGlue.slice(0, opener.index).trim();
  // Moins de deux mots devant : ce n'est probablement pas un débordement.
  return head.split(/\s+/).length >= 2 ? head : withoutGlue;
}

export function formatAddress(address: string | null): string {
  if (address === null || address.trim() === '') return UNKNOWN;

  const words = trimDescriptionBleed(address)
    .replace(/\s+/g, ' ')
    // Homogénéisation : certaines sources collent « … 06000 Nice » à la rue,
    // d'autres non. On retire le CODE POSTAL et tout ce qui suit pour ne garder
    // que la VOIE (la ville est affichée à part). Signal fiable, contrairement
    // au nom « Nice »/« France » qui peut être une voie (« rue France »).
    .replace(/[\s,]+\d{5}\b.*$/, '')
    // « 37 - 39 » → « 37-39 » : plage de numéros recollée.
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
    .replace(/,\s*$/, '')
    .trim()
    .split(' ')
    .map((word) => {
      const stripped = word.toLowerCase().replace(/\.$/, '');
      return ADDRESS_ABBREVIATIONS[stripped] ?? word;
    });

  // « 7 ET 9 RUE PAPON » : la conjonction est le premier mot alphabétique et
  // se retrouvait capitalisée. Une particule ne commence jamais une voie.
  let seenAlpha = false;
  return words
    .map((word) => {
      const isFirst = !seenAlpha && !ADDRESS_PARTICLES.has(word.toLowerCase());
      if (/[a-zà-ÿ]/i.test(word)) seenAlpha = seenAlpha || isFirst;
      return capitalizeAddressWord(word, isFirst);
    })
    .join(' ');
}

/**
 * Disponibilité lisible : « Dispo maintenant » si la date est passée ou
 * imminente, sinon « Dispo 1 sept. 2027 ». `null` si inconnue (§17 : on
 * n'affiche rien plutôt qu'une invention).
 */
export function formatAvailability(iso: string | null, nowMs: number): string | null {
  if (iso === null) return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  if (timestamp <= nowMs + 3 * 86_400_000) return 'Dispo maintenant';
  const date = new Date(timestamp);
  const formatted = date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: date.getUTCFullYear() === new Date(nowMs).getUTCFullYear() ? undefined : 'numeric',
    timeZone: 'UTC',
  });
  return `Dispo ${formatted}`;
}

/**
 * Ancienneté lisible : « il y a 4 min », « il y a 2 h », « il y a 3 j ».
 * `nowMs` est un paramètre pour garder les tests déterministes (§59).
 */
export function formatAge(iso: string | null, nowMs: number): string {
  if (iso === null) return UNKNOWN;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return UNKNOWN;

  // ARRONDI VERS LE BAS partout : une annonce vue il y a 90 minutes n'a pas
  // « 2 h », et 20 heures ne sont pas « hier ». Sur une recherche où quelques
  // heures décident d'une visite, surestimer l'âge fait renoncer à tort.
  const minutes = Math.max(0, Math.floor((nowMs - timestamp) / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;

  // Les heures vont jusqu'à DEUX jours : « il y a 30 h » dit encore quelque
  // chose d'actionnable, « hier » ne dit plus rien entre 24 et 48 heures.
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;

  return `il y a ${Math.floor(hours / 24)} j`;
}

/** Durée de trajet : « 17 min ». */
export const formatDuration = (minutes: number): string => `${minutes} min`;

const TRACKING_LABELS: Record<TrackingStatus, string> = {
  new: 'Nouveau',
  toContact: 'À contacter',
  contacted: 'Contacté',
  replied: 'Réponse reçue',
  visitOffered: 'Visite proposée',
  visitScheduled: 'Visite programmée',
  visited: 'Visité',
  rejected: 'Refusé',
  rented: 'Loué',
  ignored: 'Ignoré',
};

export const formatTracking = (status: TrackingStatus): string => TRACKING_LABELS[status];

export const TRACKING_ORDER: readonly TrackingStatus[] = [
  'new',
  'toContact',
  'contacted',
  'replied',
  'visitOffered',
  'visitScheduled',
  'visited',
  'rejected',
  'rented',
  'ignored',
];

/**
 * Nom d'affichage de chaque source, tel que l'agence l'écrit elle-même.
 *
 * Le repli mécanique (capitaliser chaque segment de l'identifiant) rendait
 * « bep » en « Bep » alors que l'agence s'appelle BEP, « ladresse » en
 * « Ladresse » au lieu de L'Adresse, « century21 » en « Century21 ». Un nom
 * propre ne se déduit pas d'un identifiant technique.
 *
 * Cette table reprend le champ `name` des descripteurs du collecteur ; le
 * frontend ne peut pas les importer (il ne dépend que de `@rentfinder/shared`,
 * qui ne connaît aucune source). Ajouter une source ici quand on en ajoute une
 * là-bas — l'oubli est sans gravité : le repli reprend la main.
 */

/**
 * Nom lisible d'une source à partir de son identifiant.
 *
 * La table vient du collecteur, ENGENDRÉE : sa version manuelle avait dérivé,
 * et huit sources s'affichaient par le repli ci-dessous — « Akorimmo » au lieu
 * d'AKOR Immo. Rien ne cassait, ce qui est le propre d'une table tenue à la
 * main : elle ne signale jamais qu'elle est incomplète.
 */
export function formatSourceName(sourceId: string): string {
  const known = SOURCES[sourceId]?.name;
  if (known !== undefined) return known;
  // Source inconnue de la table : mieux vaut un nom approximatif qu'un
  // identifiant brut à l'écran.
  return sourceId
    .split(/[-_]/)
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ');
}

/**
 * Numéro de téléphone français, lisible et cliquable.
 *
 * Les sources publient toutes les variantes : international, séparé par des
 * points, déjà espacé. On rend la forme française usuelle, par paires. Ce qui
 * n'est pas un numéro français reconnaissable est laissé TEL QUEL — mieux vaut
 * un format inhabituel qu'un numéro déformé (§17).
 */
export function formatPhone(phone: string | null): string {
  if (phone === null || phone.trim() === '') return UNKNOWN;
  const digits = phone.replace(/[^\d+]/g, '');
  const national = digits.startsWith('+33')
    ? `0${digits.slice(3)}`
    : digits.startsWith('0033')
      ? `0${digits.slice(4)}`
      : digits;
  if (!/^0\d{9}$/.test(national)) return phone.trim();
  return national.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}

/** Lien `tel:` : sans espace ni ponctuation, sinon certains téléphones échouent. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/**
 * Libellé d'un JOUR pour l'historique : « Aujourd'hui », « Hier », sinon la
 * date en toutes lettres. Comparaison sur la date locale, pas sur un écart en
 * heures : une alerte de 23 h 50 doit rester « Hier » le lendemain matin.
 */
export function formatDay(iso: string, nowMs: number): string {
  const day = new Date(iso);
  const today = new Date(nowMs);
  const same = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();
  if (same(day, today)) return "Aujourd'hui";
  const yesterday = new Date(nowMs - 24 * 60 * 60 * 1000);
  if (same(day, yesterday)) return 'Hier';
  return day.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Heure seule (« 14:32 ») — la date est portée par l'en-tête du jour. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Adresse complète au format Google Maps : « 34 Avenue Auber, 06000 Nice ».
 *
 * L'ASSEMBLAGE est délégué au formateur partagé, qui sert déjà aux
 * notifications et aux messages (§20) — le refaire ici aurait fait diverger
 * les deux à la première retouche. Ne reste ici que ce qui est propre à
 * l'affichage : le nettoyage de la voie, où les sources déversent parfois leur
 * description.
 */
export function formatPostalAddress(place: {
  readonly address: string | null;
  readonly postalCode: string | null;
  readonly city: string | null;
  readonly district?: string | null;
}): string {
  const street =
    place.address !== null && place.address.trim() !== '' ? formatAddress(place.address) : null;

  const line = formatLocation({
    street,
    postalCode: place.postalCode,
    city: place.city,
    district:
      place.district !== null && place.district !== undefined
        ? formatDistrict(place.district)
        : null,
  });
  return line === '' ? UNKNOWN : line;
}

/**
 * Quartier lisible : « EST ACROPOLIS » → « Est Acropolis », « - BELLET » →
 * « Bellet ». Les sources les publient en capitales, parfois précédés d'un
 * tiret de liste, ce qui jurait à côté d'adresses correctement capitalisées.
 */
export function formatDistrict(district: string | null): string {
  if (district === null || district.trim() === '') return UNKNOWN;
  const cleaned = district
    .replace(/^[\s\-–—•]+/, '')
    .replace(/[\s\-–—•]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return UNKNOWN;

  let seenAlpha = false;
  return cleaned
    .split(' ')
    .map((word) => {
      const isFirst = !seenAlpha && !ADDRESS_PARTICLES.has(word.toLowerCase());
      if (/[a-z]/i.test(word)) seenAlpha = seenAlpha || isFirst;
      return capitalizeAddressWord(word, isFirst);
    })
    .join(' ');
}
