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
function collectStrongSignals(
  a: NormalizedListing,
  b: NormalizedListing,
  push: (signal: SimilaritySignal) => void,
): void {
  if (a.contact.phone !== null && a.contact.phone === b.contact.phone) {
    push({ code: 'phone', label: 'même téléphone', points: 40 });
  }
  if (a.contact.email !== null && a.contact.email === b.contact.email) {
    push({ code: 'email', label: 'même e-mail', points: 35 });
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

/** Compare deux occurrences et rend un verdict motivé. */
export function similarity(a: NormalizedListing, b: NormalizedListing): SimilarityResult {
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

  collectStrongSignals(a, b, push);
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
