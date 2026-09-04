/**
 * Parsers de champs d'annonce : prix, charges, surface, pièces, type, meublé,
 * code postal, téléphone, dates relatives.
 *
 * Chaque parser rend `null` dès qu'il n'est pas certain. Une valeur inventée
 * est bien plus coûteuse qu'une valeur absente : elle fausse silencieusement
 * les filtres et les scores (§17).
 */

import {
  SHORT_TERM_LEASE_FEATURE,
  STUDENT_HOUSING_FEATURE,
  type PropertyType,
} from '@rentfinder/shared';
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

  // EN TOUTES LETTRES, en dernier recours. Le bulletin abonné de BEP titre
  // « DEUX PIECES MEUBLEES, 30 M² » : cinquante-neuf annonces n’avaient aucun
  // nombre de pièces alors qu’il était écrit. Ce texte-là ne vient que du
  // titre et du champ de pièces, jamais de la description — « une pièce à
  // vivre » y désigne le séjour d’un trois-pièces, pas le logement entier.
  const spelled = /\b(une?|deux|trois|quatre|cinq|six)\s+pieces?\b/.exec(lower);
  const word = spelled?.[1];
  if (word !== undefined) return SPELLED_ROOMS[word] ?? null;

  return null;
}

/** Nombres écrits, en forme `comparable` (minuscules, sans accent). */
const SPELLED_ROOMS: Readonly<Record<string, number>> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
};

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

  // LE LOGEMENT D'ABORD. Le non résidentiel passait en premier, si bien qu'une
  // « Studette de 20 m² avec parking » était classée « parking » — donc écartée
  // de la recherche (§16), sans trace. Un parking mentionné dans un titre est
  // presque toujours un ATOUT du logement ; il ne désigne le bien lui-même que
  // lorsque aucun type d'habitation n'est nommé (22 fiches sur 59 étaient dans
  // ce cas au 2026-09-03).
  //
  // Le vocabulaire ANGLAIS est reconnu ici, au seul endroit qui décide d'un
  // type de bien : plusieurs sources publient en anglais (Rentumo, Lodgis,
  // Studapart). Le parseur Rentumo traduisait « Apartment » en
  // « appartement » pour que cette fonction le retraduise en `apartment` —
  // un aller-retour qui couplait silencieusement les deux fichiers.
  if (/\bstudio\b|\bstudette\b/.test(lower)) return 'studio';
  if (/\bloft\b/.test(lower)) return 'loft';
  if (/\b(chambre|room)\b/.test(lower) && !/\b(appartement|apartment)\b/.test(lower)) {
    return 'room';
  }
  if (/\b(appartement|appart|apartment|flat|duplex|t\d|f\d)\b/.test(lower)) return 'apartment';
  if (/\b(maison|villa|pavillon|house|townhouse)\b/.test(lower)) return 'house';
  if (/\b(pieces?|bedrooms?)\b/.test(lower)) return 'apartment';

  // Aucun logement nommé : « Location Stationnement », box, garage…
  if (/\bstationnement\b|\bparking\b|\bgarage\b|\bbox\b|\bemplacement\b/.test(lower)) {
    return 'parking';
  }
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
  return SHARED_DWELLING.test(lower) ? true : null;
}

/**
 * Logement partagé qui ne dit jamais le mot « colocation ».
 *
 * Relevé du 2026-09-04 sur l'inventaire : « Chambre dans jolie 5 pièces au pied
 * de la Fac » n'était pas signalée, faute du mot-clé. Ce qui la trahit, c'est
 * qu'on loue UNE CHAMBRE *dans* un logement plus grand — ou qu'on distingue des
 * parties communes de parties privatives, ce que seul un logement partagé fait.
 *
 * « Chambre » seule ne suffit pas : une annonce de deux-pièces la mentionne
 * dans sa composition. C'est la préposition qui porte le sens (§17).
 */
// La ponctuation ayant disparu de la forme comparable, « co-living » y arrive
// écrit « co living ».
const SHARED_DWELLING =
  /chambre[^.;]{0,40}\b(?:dans|au sein d)\b[^.;]{0,30}(?:appartement|maison|villa|logement|colocation|t\d|f\d|\d\s*pieces?)|parties? privatives?[\s\S]{0,200}parties? communes?|parties? communes?[\s\S]{0,200}parties? privatives?|\bco ?living\b/;

/**
 * Logement qu'on ne peut PAS garder à l'année parce qu'il est réservé aux
 * étudiants — ou loué sous un bail qui, par construction, s'arrête.
 *
 * ATTENTION À CE QUI N'EN EST PAS. « Idéal étudiant », « à cinq minutes de la
 * fac », « quartier étudiant » sont des arguments de vente : deux cents
 * annonces de l'inventaire les portent, et la plupart sont de vrais logements à
 * l'année. Ne comptent que les formes qui engagent la DURÉE ou l'ÉLIGIBILITÉ :
 *
 *   - « bail étudiant » — bail meublé de neuf mois, par définition scolaire ;
 *   - « bail mobilité » — un à dix mois, réservé par la loi aux étudiants,
 *     stagiaires et personnes en mission, et non renouvelable ;
 *   - résidence étudiante, CROUS, « réservé/exclusivement aux étudiants ».
 *
 * Le texte est comparé en forme `comparable` : minuscules, sans accent.
 */
const STUDENT_ONLY =
  /residence etudiante|logement etudiant|reserv\w+ aux etudiant|exclusivement (aux |pour )?etudiant|uniquement (pour |aux )?etudiant|(location |bail )?etudiant\w{0,2} uniquement|\bcrous\b|bail etudiant|bail (de )?mobilite/;

/** `true` si l'annonce réserve le logement aux étudiants ou à un bail qui s'arrête. */
export function isStudentOnlyHousing(text: string | null | undefined): boolean {
  return STUDENT_ONLY.test(comparable(text));
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
  if (match?.[1] !== undefined) return match[1].toUpperCase();

  // Forme du bulletin BEP : « Classe énergétique (kWh/m²/an) C ». L’unité
  // s’intercale entre le libellé et la lettre, et `comparable` l’aplatit en
  // mots — « kwh m2 an » — que le motif ci-dessus refuse de franchir, à juste
  // titre : sauter des mots quelconques ferait attraper n’importe quelle
  // lettre isolée. On lit donc le texte BRUT, où la parenthèse borne
  // exactement ce qu’on saute. Cinquante-cinq annonces du bulletin abonné
  // n’avaient pas de DPE alors qu’il y figurait.
  const parenthesised = /classe\s+[ée]nerg[ée]tique\s*\([^)]*\)\s*[:-]?\s*([A-G])\b/i.exec(text);
  return parenthesised?.[1] !== undefined ? parenthesised[1].toUpperCase() : null;
}

/**
 * Bail meublé ÉTUDIANT de neuf mois : le bien se loue de septembre à juin, puis
 * repart en location saisonnière l'été. Très répandu à Nice, où plusieurs
 * agences annoncent les deux tarifs dans la même description.
 *
 * Ce n'est PAS un logement à l'année : le locataire doit libérer les lieux pour
 * juillet-août. Le taire reviendrait à proposer un bien qu'on ne peut pas
 * garder — d'où un atout affiché, et l'exclusion « locations étudiantes » (voir
 * `isStudentHousing` dans le score de correspondance).
 *
 * Le texte est comparé en forme `comparable` : minuscules, sans accent.
 */
const SHORT_TERM_LEASE =
  /(?:de |du )?septembre (?:a|au) juin|bail (?:de )?(?:9|neuf) mois|location (?:de )?(?:9|neuf) mois|saisonnier\w* (?:en |de |sur )?(?:juillet|aout)|(?:juillet|aout) en saisonnier/;

/** `true` si le texte annonce un bail de neuf mois interrompu par l'été. */
export function isShortTermStudentLease(text: string | null | undefined): boolean {
  return SHORT_TERM_LEASE.test(comparable(text));
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
    // Contrainte de DURÉE plutôt qu'agrément — mais c'est le fait le plus
    // décisif à voir quand il s'applique : le bien n'est pas louable l'été.
    [SHORT_TERM_LEASE.test(lower), SHORT_TERM_LEASE_FEATURE],
    // Réservé aux étudiants : ce n'est pas un agrément, c'est une condition
    // d'accès. Elle mérite d'être VUE, même quand l'utilisateur n'exclut pas
    // ces locations.
    [STUDENT_ONLY.test(lower), STUDENT_HOUSING_FEATURE],
  ];
  for (const [present, label] of flags) if (present) add(label);

  return features;
}

function numericAttr(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Nombre maximal d'occupants annoncé par la source.
 *
 * Les meublés courte durée le publient en toutes lettres — « peut accueillir
 * jusqu'à 4 personnes », « 2/3 personnes », « pour 2 personnes maximum ». Le
 * chiffre est DÉCISIF quand on cherche à plusieurs, et aucune autre donnée ne
 * le remplace : le nombre de pièces n'en dit rien.
 *
 * On ne lit que ce qui est écrit, jamais une déduction (§17). Une fourchette
 * (« 2/3 personnes ») rend son PLAFOND, qui est la promesse faite.
 */
export function parseMaxOccupants(text: string | null | undefined): number | null {
  const lower = comparable(text);
  if (lower === '') return null;
  // « 4 personnes », « 2 3 personnes » (la barre oblique a sauté au nettoyage),
  // « couchages ». Le dernier nombre d'une fourchette est le plafond.
  const match = /(\d{1,2})(?:\s+(\d{1,2}))?\s+(?:personnes?|couchages?|voyageurs?)\b/.exec(lower);
  if (match?.[1] === undefined) return null;
  const value = Number.parseInt(match[2] ?? match[1], 10);
  // Au-delà de 20, c'est une résidence entière ou un nombre attrapé au vol.
  return Number.isFinite(value) && value >= 1 && value <= 20 ? value : null;
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

/**
 * Adresse AVEC numéro de voie.
 *
 * Deux précautions sur le numéro :
 *   - il ne doit pas être précédé d'un chiffre ni d'un séparateur, sans quoi
 *     « disponible 06/2027 Boulevard Napoléon III » livrait « 2027 Boulevard
 *     Napoléon III » — une date prise pour un numéro ;
 *   - la seconde moitié d'un intervalle (« 22-24 ») tient sur trois chiffres :
 *     au-delà, c'est une année.
 */
const STREET_ADDRESS = new RegExp(
  `(?<![\\d/-])(\\d{1,4}(?:[-/]\\d{1,3})?\\s*(?:bis|ter)?[,]?\\s+(?:${STREET_KINDS})\\s+[^,;.:()!?0-9"«»”„]{2,45})`,
  'i',
);

/**
 * Une adresse qui COMMENCE par un numéro suivi d'un type de voie.
 *
 * Sert à trancher quand une source colle deux voies dans un champ : la
 * moitié numérotée est celle du bien (voir `dedupeStreetAddress`).
 */
export const NUMBERED_STREET = new RegExp(
  `^\\d{1,4}(?:[-/]\\d{1,3})?\\s*(?:bis|ter)?[,]?\\s+(?:${STREET_KINDS})\\b`,
  'i',
);

/**
 * Voie SANS numéro occupant à elle seule un segment (« Rue Smolett, tout proche
 * du port… »). Les agences niçoises situent le bien ainsi bien plus souvent
 * qu'avec un numéro : l'exiger laissait 86 fiches sur 93 sans rue.
 */
const BARE_STREET = new RegExp(`^(?:${STREET_KINDS})\\s+[^,;.:()!?0-9"«»”„]{2,45}$`, 'i');

/**
 * FAUX AMIS : un segment qui commence par un type de voie sans désigner une
 * adresse — « Place de parking », « Passage couvert », « Box fermé ».
 *
 * Ce prédicat juge CE QU'EST le segment. Il vaut donc pour une adresse de
 * n'importe quelle provenance, y compris déjà stockée.
 */
const NOT_A_STREET = /\b(parking|stationnement|garage|box|voiture|moto|velo|vélo|couvert)\b/i;

/**
 * PROSE : les mots qui trahissent une extraction ayant mordu sur la phrase
 * suivante, faute de ponctuation — « rue Dr Barety Dans résidence sécurisée ».
 *
 * Ce prédicat juge OÙ le segment aurait dû s'arrêter, et n'a donc de sens que
 * sur un texte qu'on vient d'extraire. L'appliquer à une adresse publiée par
 * la source effacerait des adresses postales parfaitement valides : « 12 Rue
 * X, Résidence Les Oliviers » est écrit ainsi par plusieurs agences, et
 * `streetAddress` en JSON-LD en contient couramment.
 */
const PROSE_AFTER_STREET =
  /\b(dans|proche|avec|situ[ée]e?|id[ée]ale?|entre|r[ée]sidence|immeuble|appartement|studio|villa|copropri[ée]t[ée])\b/i;

/**
 * ÉQUIPEMENTS : les mots qu'une agence accole au nom de voie dans une accroche
 * composée au tiret — « NICE LE PORT - RUE ARSON GRANDE TERRASSE - CALME ».
 *
 * Le segment commence bien par un type de voie, ne contient aucune prose, et
 * passait donc pour une adresse : « Rue Arson Grande Terrasse » n'existe sur
 * aucune carte. Aucune rue de l'agglomération ne porte l'un de ces mots ; les
 * rejeter perd la rue plutôt que d'en inventer une (§17).
 */
const FEATURE_IN_STREET =
  /\b(terrasse|balcon|ascenseur|meubl[ée]e?|vide|r[ée]nov[ée]e?|climatis[ée]e?|calme|[ée]tage|pi[èe]ces?|vue mer|jardin|cave|piscine)\b/i;

/** `true` si le segment fraîchement extrait est bien une voie, et rien de plus. */
function isCleanStreet(candidate: string): boolean {
  return (
    !NOT_A_STREET.test(candidate) &&
    !PROSE_AFTER_STREET.test(candidate) &&
    !FEATURE_IN_STREET.test(candidate)
  );
}

/**
 * `true` si une adresse DÉJÀ STOCKÉE reste plausible.
 *
 * Sert au rattrapage, et applique les DEUX critères — y compris la prose.
 *
 * LE COMPROMIS EST ASSUMÉ. Une adresse postale peut légitimement contenir
 * « Résidence » ou « Immeuble », et certaines sources la publient ainsi dans
 * un champ structuré : on en perd alors une juste. Mais §17 tranche dans
 * l'autre sens — mieux vaut n'afficher aucune rue qu'une rue introuvable sur
 * une carte. Mesuré sur l'inventaire du 2026-09-03 : 14 adresses écartées, 14
 * réellement fausses, aucune perte légitime (les 203 adresses structurées de
 * Studapart sont intactes).
 */
export function looksLikeStreet(address: string): boolean {
  return isCleanStreet(address);
}

/**
 * Montant des CHARGES lu dans le texte libre.
 *
 * Quatre pour cent des annonces portaient un montant de charges, alors que
 * deux cent trente-quatre descriptions en citent un. Le loyer affiché n'est
 * pas ce qu'on paie : « 630 € + 45 € de charges », c'est 675 €. Taire les
 * charges, c'est comparer des loyers qui ne se comparent pas.
 *
 * TROIS FORMES SEULEMENT, toutes DIRIGÉES — le montant doit être attribué aux
 * charges, jamais simplement voisin du mot :
 *
 *   - « Charges : 75,28 € », « charges locatives : 30 € »
 *   - « + 45 € de charges »
 *   - « 70,00 euros par mois de provision pour charges »
 *
 * CE QU'ON REFUSE, et c'est le piège : « 750,00 € CHARGES COMPRISES ». Le
 * montant y est le LOYER. Une première version, qui acceptait tout nombre
 * proche du mot « charges », se remplissait de loyers — trente relevés d'un
 * coup chez BEP. Une charge ne se laisse pas deviner par proximité (§17).
 */
const CHARGES_IN_TEXT: readonly RegExp[] = [
  /(?:provisions?\s+(?:pour|sur|de)\s+)?charges?(?:\s+(?:locatives?|mensuelles?|r[ée]cup[ée]rables?))?\s*(?:\([^)]*\))?\s*[:=]\s*(\d{1,3}(?:[ .\u00a0]?\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|eur\b|euros?)/i,
  /\+\s*(\d{1,3}(?:[ .\u00a0]?\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|euros?)\s*(?:par mois\s*)?(?:de|d['’])\s*(?:provisions?\s+(?:pour|de)\s+)?charges?/i,
  /(\d{1,3}(?:[ .\u00a0]?\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|euros?)\s*(?:par mois\s*)?(?:de|d['’])\s+(?:provisions?\s+pour\s+)?charges?/i,
];

/**
 * Plafond de vraisemblance. Au-delà, ce n'est plus une provision de charges
 * mais un loyer qu'une tournure a laissé passer.
 */
const MAX_CHARGES = 900;

/**
 * Cherche un montant de charges dans une description.
 *
 * @param maxPlausible loyer de l'annonce, quand il est connu : des charges
 *        supérieures au loyer ne sont pas des charges. `null` si inconnu, la
 *        seule borne restant alors le plafond absolu.
 * @returns le montant, ou `null` — jamais une supposition (§17).
 */
export function parseChargesFromText(
  text: string | null | undefined,
  maxPlausible: number | null = null,
): number | null {
  const cleaned = cleanText(text);
  if (cleaned === '') return null;
  for (const pattern of CHARGES_IN_TEXT) {
    const raw = pattern.exec(cleaned)?.[1];
    if (raw === undefined) continue;
    const value = Number(raw.replace(/[ \u00a0.]/g, '').replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || value >= MAX_CHARGES) continue;
    if (maxPlausible !== null && value >= maxPlausible) continue;
    return value;
  }
  return null;
}
/** Portion de description où l'on accepte de lire une adresse (cf. ci-dessous). */
const ADDRESS_HEAD = 120;

/**
 * Ce qui sépare deux segments d'une description.
 *
 * La virgule ne suffisait pas : les agences niçoises composent leur accroche au
 * TIRET — « NICE CENTRE - RUE DE PARIS - 3 PIÈCES - PROCHE GARE » — ou en
 * phrases — « Pasteur - rue Raoul Lesueur. Au 5ème étage ». Le tiret n'est
 * reconnu qu'ENTOURÉ D'ESPACES, sans quoi « Rue Jean-Jaurès » se couperait en
 * deux ; les trois tirets typographiques sont acceptés, les sites mélangeant
 * les trois.
 *
 * LE DEUX-POINTS EN FAIT PARTIE, et son absence coûtait cher : Citya annonce
 * ses biens « À LOUER : AVENUE JOSEPH RAYBAUD, 06300 NICE ». Sans lui, le
 * premier segment est « À LOUER : AVENUE JOSEPH RAYBAUD », qui ne COMMENCE pas
 * par un type de voie — l'adresse était perdue alors qu'elle était écrite en
 * toutes lettres. En français, le deux-points sépare l'annonce de son contenu :
 * c'est une frontière de segment aussi sûre qu'une virgule.
 */
const SEGMENT_BREAK = /[,;/.:¶]|\s+[-–—]\s+/;

/**
 * Marqueur de fin de ligne, posé avant le nettoyage.
 *
 * Un retour à la ligne sépare deux idées aussi sûrement qu'une virgule, mais
 * `cleanText` l'aplatit en simple espace : sans ce repère, « rue Dr Barety ⏎
 * Dans résidence sécurisée » ne formait qu'un segment, et l'adresse retenue
 * emportait la phrase suivante.
 */
const LINE_BREAK_MARK = ' ¶ ';

/**
 * Extrait une adresse de rue (« 22-24 Avenue de la Californie », « Rue Smolett »)
 * du DÉBUT d'une description — beaucoup d'agences l'y placent en première ligne.
 *
 * Volontairement restreint aux ~80 premiers caractères : plus loin dans le
 * texte, une adresse est souvent celle d'un commerce voisin ou de l'agence
 * (« proche de l'avenue Jean Médecin ») — mieux vaut rien qu'une adresse
 * fausse (§17, §20).
 *
 * Deux formes sont acceptées, dans cet ordre :
 *   1. avec numéro, n'importe où dans cette tête — un numéro de voie est un
 *      signal fort, il ne s'écrit pas par hasard ;
 *   2. sans numéro, mais seulement si la voie occupe TOUT un segment. C'est ce
 *      qui distingue « …, Rue Francis Gallo, … » ou « NICE CENTRE - RUE DE
 *      PARIS - 3 PIÈCES », qui situent le bien, de « proche de l'avenue Jean
 *      Médecin » ou « entre la porte fausse et la place Rossetti », qui
 *      décrivent les alentours : ceux-là ne COMMENCENT pas par un type de voie.
 */
export function extractStreetAddress(text: string | null | undefined): string | null {
  const cleaned = cleanText(text);
  if (cleaned === '') return null;

  const numbered = STREET_ADDRESS.exec(cleaned.slice(0, ADDRESS_HEAD));
  // Le même garde-fou que pour une voie sans numéro : quand la ponctuation
  // manque, l'adresse mordait sur la phrase suivante — « 1 rue de Orestis Très
  // bel appartement de ». Un numéro ne rachète pas une adresse fausse (§17).
  if (numbered?.[1] !== undefined && isCleanStreet(numbered[1])) {
    return cleanText(numbered[1]);
  }

  // Les segments sont découpés sur le texte ENTIER puis bornés par leur position
  // de départ : tronquer d'abord aurait pu couper un nom de voie en son milieu
  // et livrer une adresse incomplète.
  let offset = 0;
  const segmented = cleanText(String(text ?? '').replace(/[\r\n]+/g, LINE_BREAK_MARK));
  for (const segment of segmented.split(SEGMENT_BREAK)) {
    if (offset > ADDRESS_HEAD) break;
    offset += segment.length + 1;
    const trimmed = segment.trim();
    if (BARE_STREET.test(trimmed) && isCleanStreet(trimmed)) return cleanText(trimmed);
  }
  return null;
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
