/**
 * Parsers de champs d'annonce : prix, charges, surface, pièces, type, meublé,
 * code postal, téléphone, dates relatives.
 *
 * Chaque parser rend `null` dès qu'il n'est pas certain. Une valeur inventée
 * est bien plus coûteuse qu'une valeur absente : elle fausse silencieusement
 * les filtres et les scores (§17).
 */

import type { PropertyType } from '@rentfinder/shared';
import { cleanText, comparable } from './text.js';
import { extractNumber, parseFrenchNumber } from './parse-number.js';

/**
 * Bornes de plausibilité d'un loyer mensuel, en euros.
 * En dessous de 50 € il s'agit presque toujours d'un prix au m² ou d'un
 * fragment de référence ; au-dessus de 20 000 € d'un prix de vente.
 */
const PRICE_BOUNDS = { min: 50, max: 20_000 };

/** Bornes de plausibilité d'une surface habitable, en m². */
const AREA_BOUNDS = { min: 5, max: 1_000 };

/** Bornes de plausibilité des charges mensuelles, en euros. */
const CHARGES_BOUNDS = { min: 1, max: 2_000 };

export interface ParsedPrice {
  /** Loyer mensuel en euros, ou `null` si illisible. */
  readonly amount: number | null;
  /**
   * `true` si le texte indique explicitement « charges comprises »,
   * `false` s'il indique « hors charges », `null` s'il ne dit rien (§17).
   */
  readonly chargesIncluded: boolean | null;
}

/**
 * Extrait un loyer mensuel.
 *
 * Le texte est d'abord coupé avant toute mention de charges, pour éviter que
 * « 690 € + 50 € de charges » ne rende 50. On ne retient ensuite que le premier
 * nombre plausible.
 */
export function parsePrice(text: string | null | undefined): ParsedPrice {
  const cleaned = cleanText(text);
  if (cleaned === '') return { amount: null, chargesIncluded: null };

  const lower = comparable(cleaned);

  let chargesIncluded: boolean | null = null;
  if (/\bcharges comprises\b|\bcc\b|\btoutes charges comprises\b|\btcc\b/.test(lower)) {
    chargesIncluded = true;
  } else if (/\bhors charges\b|\bhc\b|\bcharges en sus\b/.test(lower)) {
    chargesIncluded = false;
  }

  // Tronque avant la mention des charges pour ne pas capturer leur montant.
  const separatorIndex = cleaned.search(/\+|\bdont\b|\bcharges\b/i);
  const priceSegment = separatorIndex > 0 ? cleaned.slice(0, separatorIndex) : cleaned;

  const amount = extractNumber(priceSegment, PRICE_BOUNDS) ?? extractNumber(cleaned, PRICE_BOUNDS);
  return { amount, chargesIncluded };
}

/**
 * Extrait un montant de charges.
 * Ne rend une valeur que si le texte mentionne effectivement des charges :
 * sans cette mention, tout nombre trouvé serait une supposition.
 */
export function parseCharges(text: string | null | undefined): number | null {
  const cleaned = cleanText(text);
  if (cleaned === '' || !/charge/i.test(cleaned)) return null;

  // Cherche un montant à proximité immédiate du mot « charges ».
  const match = cleaned.match(/([\d\s.,]+)\s*€?\s*(?:de\s+)?charges|charges\s*:?\s*([\d\s.,]+)/i);
  if (match) {
    const fragment = match[1] ?? match[2];
    if (fragment !== undefined) {
      const value = parseFrenchNumber(fragment);
      if (value !== null && value >= CHARGES_BOUNDS.min && value <= CHARGES_BOUNDS.max) {
        return value;
      }
    }
  }
  return null;
}

/**
 * Extrait une surface habitable en m².
 * On exige la présence d'une unité (`m2`, `m²`) : un nombre nu dans une
 * description n'est pas une surface.
 */
export function parseArea(text: string | null | undefined): number | null {
  const cleaned = cleanText(text);
  if (cleaned === '') return null;

  // `(?!\d)` et non `\b` : « ² » n'étant pas un caractère de mot, `\b` ne peut
  // jamais matcher entre « ² » et l'espace suivant, ce qui rendait toutes les
  // surfaces en m² illisibles. La négation de chiffre suffit à éviter qu'un
  // « 34 m25 » soit lu comme 34 m².
  const match = cleaned.match(/([\d\s.,]+)\s*m\s*(?:²|2|\^2)(?!\d)/i);
  if (match?.[1] === undefined) return null;

  const value = parseFrenchNumber(match[1]);
  if (value === null) return null;
  return value >= AREA_BOUNDS.min && value <= AREA_BOUNDS.max ? value : null;
}

/** Extrait un nombre de pièces (« 3 pièces », « T2 », « studio »). */
export function parseRooms(text: string | null | undefined): number | null {
  const cleaned = cleanText(text);
  if (cleaned === '') return null;
  const lower = comparable(cleaned);

  if (/\bstudio\b|\bstudette\b/.test(lower)) return 1;

  const explicit = lower.match(/(\d+)\s*(?:pieces?|p\b)/);
  if (explicit?.[1] !== undefined) {
    const value = Number.parseInt(explicit[1], 10);
    if (value >= 1 && value <= 20) return value;
  }

  // Notations « T3 » et « F3 ».
  const shorthand = lower.match(/\b[tf](\d+)\b/);
  if (shorthand?.[1] !== undefined) {
    const value = Number.parseInt(shorthand[1], 10);
    if (value >= 1 && value <= 20) return value;
  }

  return null;
}

/** Extrait un nombre de chambres. */
export function parseBedrooms(text: string | null | undefined): number | null {
  const lower = comparable(text);
  const match = lower.match(/(\d+)\s*chambres?/);
  if (match?.[1] === undefined) return null;
  const value = Number.parseInt(match[1], 10);
  return value >= 0 && value <= 20 ? value : null;
}

/** Déduit le type de bien. Rend `unknown` plutôt que de supposer (§17). */
export function parsePropertyType(text: string | null | undefined): PropertyType {
  const lower = comparable(text);
  if (lower === '') return 'unknown';

  // Non résidentiel d'abord : « Location Stationnement », box, garage…
  if (/\bstationnement\b|\bparking\b|\bgarage\b|\bbox\b|\bemplacement\b/.test(lower)) {
    return 'parking';
  }
  if (/\bstudio\b|\bstudette\b/.test(lower)) return 'studio';
  if (/\bloft\b/.test(lower)) return 'loft';
  if (/\bchambre\b/.test(lower) && !/\bappartement\b/.test(lower)) return 'room';
  if (/\bappartement\b|\bappart\b|\bduplex\b|\bt\d\b|\bf\d\b/.test(lower)) return 'apartment';
  if (/\bmaison\b|\bvilla\b|\bpavillon\b/.test(lower)) return 'house';
  return 'other';
}

/**
 * Détermine si le bien est meublé.
 * `null` quand le texte ne le dit pas : un logement non mentionné comme meublé
 * n'est pas nécessairement vide.
 */
export function parseFurnished(text: string | null | undefined): boolean | null {
  const lower = comparable(text);
  if (lower === '') return null;
  if (/\bnon meuble\b|\bvide\b|\bnon meublee\b/.test(lower)) return false;
  if (/\bmeuble\b|\bmeublee\b/.test(lower)) return true;
  return null;
}

/**
 * Détermine si le bien est proposé en colocation.
 *
 * « colocation possible/acceptée » décrit un logement ENTIER dont le bailleur
 * accepte des colocataires → `false`. « en colocation » / « chambre en
 * colocation » décrit une place dans un logement partagé → `true`.
 * `null` quand le texte ne dit rien (§17).
 */
export function parseFlatShare(text: string | null | undefined): boolean | null {
  const lower = comparable(text);
  if (lower === '') return null;
  if (/colocation (possible|acceptee|envisageable)|possibilite de colocation/.test(lower)) {
    return false;
  }
  if (/\bcolocation\b|\bcoloc\b/.test(lower)) return true;
  return null;
}

/**
 * Extrait la classe énergétique (DPE) : « A » à « G ». On accepte les formes
 * « DPE : D », « DPE D », « classe énergie C », « étiquette énergétique B ».
 * `null` si rien de fiable (§17) — jamais deviné, jamais « vierge → G ».
 */
export function parseDpe(text: string | null | undefined): string | null {
  if (text === null || text === undefined || text === '') return null;

  // Valeur brute d'un attribut structuré : une seule lettre A–G.
  const trimmed = text.trim();
  if (/^[A-Ga-g]$/.test(trimmed)) return trimmed.toUpperCase();

  // Texte libre : on retire les accents (« énergétique » → « energetique »)
  // pour une détection robuste, puis on cherche la lettre qui SUIT le mot-clé.
  const flat = comparable(text);
  const match = flat.match(/\b(?:dpe|classe\s+energ\w*|etiquette\s+energ\w*)\b\W*\b([a-g])\b/);
  return match?.[1] !== undefined ? match[1].toUpperCase() : null;
}

/**
 * Construit la liste d'atouts affichables à partir du texte de l'annonce et
 * d'attributs déjà extraits. Chaque atout n'est ajouté que s'il est mentionné
 * (§17). Résultat dédoublonné, ordre stable.
 *
 * @param text texte libre (titre + description + caractéristiques)
 * @param extra attributs structurés éventuels (Orpi : etage, ascenseur…)
 */
export function extractFeatures(
  text: string | null | undefined,
  extra?: Readonly<Record<string, string>>,
): string[] {
  const lower = comparable(text);
  const features: string[] = [];
  const add = (value: string): void => {
    if (!features.includes(value)) features.push(value);
  };

  // Étage : d'abord l'attribut structuré, sinon le texte (« au 3e étage »).
  const floorAttr = extra?.['etage'];
  if (floorAttr !== undefined && floorAttr !== '' && floorAttr !== '0') {
    add(`${floorAttr}e étage`);
  } else if (floorAttr === '0') {
    add('Rez-de-chaussée');
  } else {
    const floor = lower.match(/\b(\d{1,2})\s*(?:e|er|eme|ème)?\s*etage/);
    if (floor?.[1] !== undefined) add(`${floor[1]}e étage`);
    else if (/rez.de.chaussee|\brdc\b/.test(lower)) add('Rez-de-chaussée');
  }

  const flags: Array<[boolean, string]> = [
    [extra?.['ascenseur'] === '1' || /\bascenseur\b/.test(lower), 'Ascenseur'],
    [/\bbalcon/.test(lower) || numericAttr(extra?.['nbBalcons']) > 0, 'Balcon'],
    [/\bterrasse/.test(lower) || numericAttr(extra?.['nbTerrasses']) > 0, 'Terrasse'],
    [/\bjardin/.test(lower), 'Jardin'],
    [
      /\bparking|stationnement|place de parking/.test(lower) ||
        numericAttr(extra?.['nbParking']) > 0,
      'Parking',
    ],
    [/\bgarage/.test(lower), 'Garage'],
    [/\bcave\b/.test(lower), 'Cave'],
    [/\bpiscine/.test(lower), 'Piscine'],
    [/\bclimatisation|\bclim\b|climatise/.test(lower), 'Climatisation'],
    [/\bmeuble/.test(lower), 'Meublé'],
    [/\bneuf\b|\brenove|refait a neuf/.test(lower), 'Rénové / neuf'],
  ];
  for (const [present, label] of flags) if (present) add(label);

  return features;
}

function numericAttr(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Extrait un code postal français à cinq chiffres. */
export function parsePostalCode(text: string | null | undefined): string | null {
  const cleaned = cleanText(text);
  const match = cleaned.match(/\b(\d{5})\b/);
  return match?.[1] ?? null;
}

/**
 * Normalise un numéro de téléphone français au format E.164 (`+33...`).
 *
 * Le format canonique est indispensable au dédoublonnage : un même numéro écrit
 * « 06 00 00 00 12 » sur un portail et « +33600000012 » sur un autre doit
 * produire la même clé, sans quoi le doublon passe inaperçu (§14).
 */
export function parsePhone(text: string | null | undefined): string | null {
  const cleaned = cleanText(text);
  if (cleaned === '') return null;

  const digitsOnly = cleaned.replace(/[^\d+]/g, '');

  if (/^\+33[1-9]\d{8}$/.test(digitsOnly)) return digitsOnly;
  if (/^0033[1-9]\d{8}$/.test(digitsOnly)) return `+33${digitsOnly.slice(4)}`;
  if (/^0[1-9]\d{8}$/.test(digitsOnly)) return `+33${digitsOnly.slice(1)}`;
  // « +33-0493… » : indicatif accolé au 0 national — rencontré tel quel dans
  // le JSON-LD de sites d'agences (BEP Logement, plateforme Apimo).
  if (/^\+330[1-9]\d{8}$/.test(digitsOnly)) return `+33${digitsOnly.slice(4)}`;

  return null;
}

/** Extrait une adresse e-mail. */
export function parseEmail(text: string | null | undefined): string | null {
  const cleaned = cleanText(text);
  const match = cleaned.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Interprète une date de publication, absolue ou relative.
 *
 * Les sites français écrivent aussi bien « 14/08/2026 » que « il y a 4 min ».
 * `nowMs` est injecté pour que les tests soient déterministes (§59).
 *
 * @returns une date ISO 8601, ou `null` si le texte n'est pas interprétable.
 */
export function parsePublishedAt(text: string | null | undefined, nowMs: number): string | null {
  const cleaned = cleanText(text);
  if (cleaned === '') return null;
  const lower = comparable(cleaned);

  if (/\b(aujourd hui|maintenant|a l instant)\b/.test(lower)) {
    return new Date(nowMs).toISOString();
  }
  if (/\bhier\b/.test(lower)) {
    return new Date(nowMs - 86_400_000).toISOString();
  }

  const relative = lower.match(
    /il y a\s+(\d+)\s*(min|minute|minutes|h|heure|heures|j|jour|jours|semaine|semaines|mois)/,
  );
  if (relative?.[1] !== undefined && relative[2] !== undefined) {
    const amount = Number.parseInt(relative[1], 10);
    const unit = relative[2];
    const msPerUnit: Record<string, number> = {
      min: 60_000,
      minute: 60_000,
      minutes: 60_000,
      h: 3_600_000,
      heure: 3_600_000,
      heures: 3_600_000,
      j: 86_400_000,
      jour: 86_400_000,
      jours: 86_400_000,
      semaine: 604_800_000,
      semaines: 604_800_000,
      mois: 2_592_000_000,
    };
    const factor = msPerUnit[unit];
    if (factor !== undefined) return new Date(nowMs - amount * factor).toISOString();
  }

  // Formats absolus JJ/MM/AAAA et AAAA-MM-JJ.
  const french = cleaned.match(/\b(\d{2})[/.-](\d{2})[/.-](\d{4})\b/);
  if (french?.[1] && french[2] && french[3]) {
    const date = new Date(Date.UTC(+french[3], +french[2] - 1, +french[1]));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const iso = cleaned.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso?.[0]) {
    const date = new Date(`${iso[0]}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return null;
}

/**
 * Voies françaises reconnues pour l'extraction d'adresse depuis un texte libre.
 */
const STREET_KINDS =
  'avenue|av\\.?|boulevard|bd\\.?|rue|place|chemin|impasse|all[ée]e|promenade|quai|route|mont[ée]e|traverse|square|passage|corniche';

const STREET_ADDRESS = new RegExp(
  `\\b(\\d{1,4}(?:[-/]\\d{1,4})?\\s*(?:bis|ter)?[,]?\\s+(?:${STREET_KINDS})\\s+[^,;.:()!?0-9]{2,45})`,
  'i',
);

/**
 * Extrait une adresse de rue (« 22-24 Avenue de la Californie ») du DÉBUT d'une
 * description — beaucoup d'agences l'y placent en première ligne.
 *
 * Volontairement restreint aux ~80 premiers caractères : plus loin dans le
 * texte, une adresse est souvent celle d'un commerce voisin ou de l'agence
 * (« proche de l'avenue Jean Médecin ») — mieux vaut rien qu'une adresse
 * fausse (§17, §20).
 */
export function extractStreetAddress(text: string | null | undefined): string | null {
  const cleaned = cleanText(text);
  if (cleaned === '') return null;
  const match = STREET_ADDRESS.exec(cleaned.slice(0, 80));
  if (match?.[1] === undefined) return null;
  return cleanText(match[1]);
}

/** Mois français (forme comparable, sans accent) → numéro 1-12. */
const FRENCH_MONTHS: Readonly<Record<string, number>> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

/**
 * Date de disponibilité d'un logement (§17).
 *
 * Comprend, en plus des formats de `parsePublishedAt` :
 *   - « immédiatement », « de suite », « disponible » seul → maintenant ;
 *   - les dates textuelles françaises « 1er septembre 2027 », « 15 mars » —
 *     sans année, on prend la PROCHAINE occurrence (une disponibilité est
 *     toujours dans le futur, contrairement à une date de publication).
 */
export function parseAvailableAt(text: string | null | undefined, nowMs: number): string | null {
  const cleaned = cleanText(text);
  if (cleaned === '') return null;
  const lower = comparable(cleaned);

  if (/\b(immediat\w*|de suite|des maintenant|libre)\b/.test(lower)) {
    return new Date(nowMs).toISOString();
  }

  const textual = lower.match(
    /\b(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(\d{4}))?\b/,
  );
  if (textual?.[1] !== undefined && textual[2] !== undefined) {
    const day = Number.parseInt(textual[1], 10);
    const month = FRENCH_MONTHS[textual[2]];
    if (month !== undefined && day >= 1 && day <= 31) {
      let year =
        textual[3] !== undefined
          ? Number.parseInt(textual[3], 10)
          : new Date(nowMs).getUTCFullYear();
      let date = new Date(Date.UTC(year, month - 1, day));
      // Sans année explicite, une date déjà passée désigne l'année prochaine.
      if (textual[3] === undefined && date.getTime() < nowMs - 86_400_000) {
        year += 1;
        date = new Date(Date.UTC(year, month - 1, day));
      }
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  // Formats numériques et relatifs communs avec la date de publication.
  return parsePublishedAt(text, nowMs);
}
