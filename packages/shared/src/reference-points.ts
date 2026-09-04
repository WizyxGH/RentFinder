/**
 * Points de référence réglables depuis le site (§20).
 *
 * Le lieu de travail et la gare décident du temps de trajet affiché sur chaque
 * annonce — donc, en pratique, de ce qu'on regarde en premier. Ils vivaient
 * dans `.env` et dans les secrets GitHub : les changer demandait d'éditer un
 * fichier sur la machine de collecte, ou de retrouver un écran de réglages
 * GitHub. Un déménagement ou un changement d'employeur devenait une opération
 * technique.
 *
 * Ils vivent maintenant dans `app_settings`, comme les critères, et se règlent
 * depuis l'écran Paramètres. `.env` reste la valeur de départ : tant que rien
 * n'a été réglé depuis le site, rien ne change.
 *
 * ON Y GARDE L'ADRESSE, PAS LES COORDONNÉES. Une adresse se relit, se corrige
 * et se reconnaît ; une paire de coordonnées ne dit rien à personne. Le
 * géocodage a lieu à la collecte suivante, une fois, puis reste en cache.
 *
 * CES ADRESSES SONT PRIVÉES (§26) : elles désignent un lieu de travail et un
 * domicile. Elles vivent dans une base à jeton, jamais dans le dépôt.
 */

/** Moyen de transport, pour convertir une distance en durée. */
export type ReferenceTravelMode = 'walking' | 'cycling' | 'transit' | 'train' | 'driving';

/**
 * Dans l'ordre du plus lent au plus rapide, qui est aussi celui du plus
 * quotidien au plus exceptionnel.
 *
 * LE TRAIN A SA PLACE À PART. Le ranger sous « transports en commun » le
 * comptait à 18 km/h : sur la Côte d'Azur, une commune desservie par le TER
 * paraissait alors plus loin qu'un quartier voisin, alors qu'elle est souvent
 * plus proche en temps.
 */
export const REFERENCE_TRAVEL_MODES: readonly ReferenceTravelMode[] = [
  'walking',
  'cycling',
  'transit',
  'train',
  'driving',
];

/** Un point de référence tel qu'on le règle : un nom, une adresse, un mode. */
export interface StoredReferencePoint {
  /** Libellé affiché sur la fiche, ex. « Travail ». */
  readonly label: string;
  /** Adresse en clair, géocodée à la collecte suivante. */
  readonly address: string;
  readonly mode: ReferenceTravelMode;
}

/**
 * Clé des points de référence dans `app_settings`.
 *
 * CONTRAT INTER-PROCESSUS, comme les critères : la collecte la lit, le site
 * l'écrit, et ils n'ont aucun autre point de rencontre.
 */
export const REFERENCE_POINTS_SETTING = 'referencePoints';

function isTravelMode(value: unknown): value is ReferenceTravelMode {
  return REFERENCE_TRAVEL_MODES.includes(value as ReferenceTravelMode);
}

/**
 * Valide ce qui sort de la base ou d'un formulaire.
 *
 * Renvoie `null` quand rien d'exploitable n'est stocké — et non un tableau
 * vide : « l'utilisateur n'a rien réglé » (on retombe sur `.env`) et
 * « l'utilisateur a tout retiré » (aucune distance, volontairement) sont deux
 * intentions différentes, et les confondre rallumerait un point de référence
 * qu'on vient d'effacer.
 */
export function parseReferencePoints(value: unknown): StoredReferencePoint[] | null {
  if (!Array.isArray(value)) return null;

  const points: StoredReferencePoint[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const label = typeof candidate['label'] === 'string' ? candidate['label'].trim() : '';
    const address = typeof candidate['address'] === 'string' ? candidate['address'].trim() : '';
    // Une adresse vide ne se géocode pas : le point serait déclaré sans jamais
    // produire de distance, ce qui se lirait comme une panne.
    if (label === '' || address === '') continue;
    points.push({
      label,
      address,
      mode: isTravelMode(candidate['mode']) ? candidate['mode'] : 'transit',
    });
  }
  return points;
}
