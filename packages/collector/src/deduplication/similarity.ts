/**
 * Score de similarité entre deux occurrences (§14).
 *
 * Le dédoublonnage repose sur une accumulation de signaux plutôt que sur une
 * règle unique, parce qu'aucune source ne fournit le même sous-ensemble
 * d'informations. Deux principes gouvernent l'implémentation :
 *
 *   1. Les signaux ABSENTS ne comptent pas. Deux annonces sans téléphone ne se
 *      ressemblent pas davantage pour autant.
 *   2. Certains désaccords sont RÉDHIBITOIRES. Un écart de surface important
 *      ou une ville différente interdit la fusion, quel que soit le reste :
 *      fusionner deux logements distincts est bien plus grave que d'en afficher
 *      un en double (§14).
 */

import type { NormalizedListing } from '@rentfinder/shared';
import { comparable, tokenize } from '../normalization/text.js';
import { haversineKm } from '../core/geo.js';

/** Verdict rendu pour une paire d'annonces. */
export type SimilarityVerdict = 'duplicate' | 'ambiguous' | 'distinct';

export interface SimilaritySignal {
  readonly code: string;
  readonly label: string;
  readonly points: number;
}

export interface SimilarityResult {
  readonly score: number;
  readonly verdict: SimilarityVerdict;
  readonly signals: readonly SimilaritySignal[];
  /** Renseigné quand un désaccord rédhibitoire a tranché la comparaison. */
  readonly blocker: string | null;
}

/** Au-delà de ce score, la fusion est automatique. */
export const DUPLICATE_THRESHOLD = 70;

/** En dessous de ce score, les annonces sont considérées distinctes. */
export const AMBIGUOUS_THRESHOLD = 45;

/** Tolérance sur le loyer : les portails diffèrent sur l'inclusion des charges. */
const PRICE_TOLERANCE_EUR = 30;
const PRICE_TOLERANCE_RATIO = 0.06;

/** Tolérance sur la surface : les arrondis varient d'une source à l'autre. */
const AREA_TOLERANCE_M2 = 2;
const AREA_TOLERANCE_RATIO = 0.05;

/** Deux points distants de moins de 80 m désignent très probablement le même immeuble. */
const GPS_SAME_BUILDING_KM = 0.08;

function withinTolerance(a: number, b: number, absolute: number, ratio: number): boolean {
  const delta = Math.abs(a - b);
  return delta <= Math.max(absolute, Math.max(a, b) * ratio);
}

/** Indice de Jaccard entre deux ensembles de mots, dans [0, 1]. */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Recherche un désaccord rédhibitoire.
 * @returns la raison du blocage, ou `null` si rien n'interdit la fusion.
 */
function findBlocker(a: NormalizedListing, b: NormalizedListing): string | null {
  if (a.city !== null && b.city !== null && a.city !== b.city) {
    return `villes différentes (${a.city} / ${b.city})`;
  }

  if (
    a.area !== null &&
    b.area !== null &&
    !withinTolerance(a.area, b.area, AREA_TOLERANCE_M2, AREA_TOLERANCE_RATIO)
  ) {
    return `surfaces incompatibles (${a.area} m² / ${b.area} m²)`;
  }

  if (
    a.price !== null &&
    b.price !== null &&
    !withinTolerance(a.price, b.price, PRICE_TOLERANCE_EUR, PRICE_TOLERANCE_RATIO)
  ) {
    return `loyers incompatibles (${a.price} € / ${b.price} €)`;
  }

  if (a.rooms !== null && b.rooms !== null && a.rooms !== b.rooms) {
    return `nombre de pièces différent (${a.rooms} / ${b.rooms})`;
  }

  if (a.latitude !== null && a.longitude !== null && b.latitude !== null && b.longitude !== null) {
    const distance = haversineKm(
      { latitude: a.latitude, longitude: a.longitude },
      { latitude: b.latitude, longitude: b.longitude },
    );
    // Au-delà de 500 m, il ne s'agit plus du même bien, même si tout concorde.
    if (distance > 0.5) return `positions éloignées de ${Math.round(distance * 1000)} m`;
  }

  return null;
}

/** Signaux très forts : ils identifient presque à eux seuls le même bien (§14). */
/**
 * Identité d'une image, indépendante de sa signature d'accès.
 *
 * Les portails ajoutent un jeton par requête (`?ci_seal=…`) : deux liens vers le
 * MÊME fichier ne se ressemblent pas caractère pour caractère. On ne garde donc
 * que l'hôte et le chemin.
 */
function imageIdentity(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

/**
 * `true` si les deux annonces publient au moins une image identique.
 *
 * ENTRE SOURCES DIFFÉRENTES, ou au sein d'une source qui RELAIE (voir
 * `SourceDescriptor.relaysListings`). Le signal repose sur le fait qu'une
 * agence pousse les mêmes fichiers vers le portail et vers son propre site ; au
 * sein d'UNE agence il ne dit rien, car certaines illustrent des dizaines
 * d'annonces avec la même photo tamponnée — Citya en réutilise une sur quatorze
 * biens distincts, Saint-Roch sur cinq. Combiné au téléphone de l'accueil,
 * commun lui aussi, cela suffisait à faire disparaître une annonce bien réelle
 * (§14). Chez un relais, à l'inverse, chaque photo vient du serveur média du
 * site d'origine et n'illustre qu'UNE annonce.
 */
function sharesImage(
  a: NormalizedListing,
  b: NormalizedListing,
  relaysListings: (sourceId: string) => boolean,
): boolean {
  if (a.sourceId === b.sourceId && !relaysListings(a.sourceId)) return false;
  const left = new Set(a.imageUrls.map(imageIdentity).filter((x): x is string => x !== null));
  if (left.size === 0) return false;
  return b.imageUrls.some((url) => {
    const identity = imageIdentity(url);
    return identity !== null && left.has(identity);
  });
}

function collectStrongSignals(
  a: NormalizedListing,
  b: NormalizedListing,
  push: (signal: SimilaritySignal) => void,
  relaysListings: (sourceId: string) => boolean,
): void {
  // Une PHOTO commune entre deux sources est le signal le plus sûr dont on
  // dispose, et il est gratuit : on compare des URL déjà collectées, sans
  // télécharger d'image.
  if (sharesImage(a, b, relaysListings)) {
    push({ code: 'image', label: 'photo identique', points: 45 });
  }

  // Coordonnées : signal fort ENTRE SOURCES seulement. Au sein d'une source,
  // le numéro est le plus souvent le STANDARD de l'agence — porté à l'identique
  // par une vingtaine d'annonces, et posé en repli par le pipeline sur celles
  // qui n'en publient aucun. Il ne distingue donc rien, et additionné à
  // l'adresse ou au GPS il franchissait le seuil de fusion (§14).
  if (a.sourceId !== b.sourceId) {
    if (a.contact.phone !== null && a.contact.phone === b.contact.phone) {
      push({ code: 'phone', label: 'même téléphone', points: 40 });
    }
    if (a.contact.email !== null && a.contact.email === b.contact.email) {
      push({ code: 'email', label: 'même e-mail', points: 35 });
    }
  }

  // La référence d'agence n'est comparée qu'entre sources différentes : au sein
  // d'une même source, elle est déjà l'identifiant, la comparaison serait vaine.
  const refA = a.contact.reference;
  const refB = b.contact.reference;
  if (refA !== null && refB !== null && comparable(refA) === comparable(refB) && refA.length >= 4) {
    push({ code: 'reference', label: 'même référence', points: 35 });
  }

  if (a.address !== null && b.address !== null && comparable(a.address) === comparable(b.address)) {
    push({ code: 'address', label: 'même adresse', points: 30 });
  }

  if (a.latitude !== null && a.longitude !== null && b.latitude !== null && b.longitude !== null) {
    const distance = haversineKm(
      { latitude: a.latitude, longitude: a.longitude },
      { latitude: b.latitude, longitude: b.longitude },
    );
    if (distance <= GPS_SAME_BUILDING_KM) {
      push({ code: 'gps', label: 'coordonnées quasi identiques', points: 30 });
    }
  }
}

/** Signaux forts : concordants, ils ne suffisent pas seuls mais s'additionnent. */
function collectMediumSignals(
  a: NormalizedListing,
  b: NormalizedListing,
  push: (signal: SimilaritySignal) => void,
): void {
  if (
    a.price !== null &&
    b.price !== null &&
    withinTolerance(a.price, b.price, PRICE_TOLERANCE_EUR, PRICE_TOLERANCE_RATIO)
  ) {
    push({ code: 'price', label: 'loyer équivalent', points: 18 });
  }

  if (
    a.area !== null &&
    b.area !== null &&
    withinTolerance(a.area, b.area, AREA_TOLERANCE_M2, AREA_TOLERANCE_RATIO)
  ) {
    push({ code: 'area', label: 'surface équivalente', points: 18 });
  }

  if (a.rooms !== null && a.rooms === b.rooms) {
    push({ code: 'rooms', label: 'même nombre de pièces', points: 6 });
  }

  const agencyA = a.contact.agencyName;
  const agencyB = b.contact.agencyName;
  if (agencyA !== null && agencyB !== null && comparable(agencyA) === comparable(agencyB)) {
    push({ code: 'agency', label: 'même agence', points: 12 });
  }

  if (a.postalCode !== null && a.postalCode === b.postalCode) {
    push({ code: 'postalCode', label: 'même code postal', points: 4 });
  }

  // Le QUARTIER situe bien plus finement que la commune : à Nice, « Gambetta »
  // vaut mieux que « Nice ». Il n'était pas exploité du tout. On le lit aussi
  // dans le titre de l'autre annonce (« STUDIO GAMBETTA »), les portails le
  // mettant souvent là plutôt que dans un champ dédié.
  const districtA = a.district;
  const districtB = b.district;
  if (districtA !== null && districtB !== null && comparable(districtA) === comparable(districtB)) {
    push({ code: 'district', label: `même quartier (${districtA})`, points: 12 });
  } else if (
    (districtA !== null && tokenize(b.title).includes(comparable(districtA))) ||
    (districtB !== null && tokenize(a.title).includes(comparable(districtB)))
  ) {
    push({ code: 'district', label: 'quartier nommé dans le titre', points: 8 });
  }

  const titleScore = jaccard(tokenize(a.title), tokenize(b.title));
  if (titleScore > 0.4) {
    push({
      code: 'title',
      label: `titres proches (${Math.round(titleScore * 100)} %)`,
      points: Math.round(titleScore * 15),
    });
  }

  const descriptionScore = jaccard(tokenize(a.description), tokenize(b.description));
  if (descriptionScore > 0.5) {
    push({
      code: 'description',
      label: `descriptions proches (${Math.round(descriptionScore * 100)} %)`,
      points: Math.round(descriptionScore * 12),
    });
  }
}

/**
 * Compare deux occurrences et rend un verdict motivé.
 *
 * @param relaysListings dit si une source RELAIE des annonces publiées ailleurs
 *   (`SourceDescriptor.relaysListings`). Par défaut « non » : sans registre
 *   sous la main — dans un test unitaire, par exemple — on retient l'hypothèse
 *   prudente, celle qui fusionne le moins (§14).
 */
export function similarity(
  a: NormalizedListing,
  b: NormalizedListing,
  relaysListings: (sourceId: string) => boolean = () => false,
): SimilarityResult {
  // Identité : la même annonce, sur la même source.
  if (a.id === b.id) {
    return {
      score: 100,
      verdict: 'duplicate',
      signals: [{ code: 'identity', label: 'même occurrence', points: 100 }],
      blocker: null,
    };
  }

  const blocker = findBlocker(a, b);
  if (blocker !== null) {
    return { score: 0, verdict: 'distinct', signals: [], blocker };
  }

  const signals: SimilaritySignal[] = [];
  const push = (signal: SimilaritySignal): void => {
    signals.push(signal);
  };

  collectStrongSignals(a, b, push, relaysListings);
  collectMediumSignals(a, b, push);

  const score = Math.min(
    100,
    signals.reduce((total, signal) => total + signal.points, 0),
  );

  let verdict: SimilarityVerdict = 'distinct';
  if (score >= DUPLICATE_THRESHOLD) verdict = 'duplicate';
  else if (score >= AMBIGUOUS_THRESHOLD) verdict = 'ambiguous';

  return { score, verdict, signals, blocker: null };
}
