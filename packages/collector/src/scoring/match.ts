/**
 * MATCH SCORE — « cette annonce correspond-elle à mes critères ? » (§16).
 *
 * Le score est construit à partir des critères actifs uniquement. Ajouter un
 * critère (quartier, DPE, balcon…) revient à ajouter une règle ici, sans
 * toucher au reste du système (§2).
 */

import type {
  AggregatedListing,
  ExplainedScore,
  ScoreReason,
  SearchCriteria,
} from '@rentfinder/shared';
import { clampScore } from '@rentfinder/shared';
import { comparable } from '../normalization/text.js';

export interface MatchOutcome {
  readonly score: ExplainedScore;
  /**
   * `false` si l'annonce viole un critère éliminatoire (§53 scénario 3).
   * Elle reste collectée et consultable, mais sort de la liste principale.
   */
  readonly matchesCriteria: boolean;
}

/**
 * Codes postaux des communes cibles connues.
 *
 * Sert à trancher la ville quand la source ne la NOMME pas mais publie un code
 * postal (§17 : on ne devine rien, on recoupe une donnée réellement publiée).
 * Sans cette table, une annonce à Saint-Laurent-du-Var (06700) dont le champ
 * « ville » est vide passait le filtre « Nice ». Étendre si de nouvelles villes
 * cibles sont ajoutées aux critères.
 */
const CITY_POSTAL_CODES: Readonly<Record<string, readonly string[]>> = {
  nice: ['06000', '06100', '06200', '06300'],
};

/**
 * Détection d'une location EXCLUSIVEMENT étudiante (décision utilisateur du
 * 2026-08-16) : on n'exclut QUE les offres réservées aux étudiants — résidences
 * étudiantes, biens « réservés/exclusivement étudiants », CROUS, ou offre
 * dédiée dans l'URL (`location-etudiants`). Un bien qui SEULEMENT accepte des
 * étudiants (« idéal étudiant », « étudiants acceptés ») est conservé.
 */
const STUDENT_EXCLUSIVE =
  /residence etudiante|reserv\w+ aux etudiant|exclusivement (aux |pour )?etudiant|uniquement (pour |aux )?etudiant|(location |bail )?etudiant\w{0,2} uniquement|\bcrous\b/;

function isStudentHousing(listing: AggregatedListing): boolean {
  const text = comparable(`${listing.title.value ?? ''} ${listing.description.value ?? ''}`);
  if (STUDENT_EXCLUSIVE.test(text)) return true;
  // Offre dédiée aux étudiants dans l'URL (ex. /…location-etudiants…/).
  return listing.occurrences.some((occurrence) =>
    /location-etudiant|logement-etudiant/i.test(occurrence.sourceUrl),
  );
}

/** Évalue la correspondance d'un logement aux critères de recherche. */
interface CityOutcome {
  /** `false` si la ville est éliminatoire (hors zone). */
  readonly matches: boolean;
  /** `true` si la ville n'a pas pu être déterminée (§17). */
  readonly unknown: boolean;
  readonly points: number;
  readonly reason: ScoreReason;
}

/**
 * Détermine si la ville de l'annonce est dans la zone recherchée.
 *
 * Ordre : nom de ville quand il est publié ; sinon recoupement par CODE POSTAL
 * (écarte Saint-Laurent-du-Var 06700 d'une recherche « Nice » même si le champ
 * ville est vide) ; sinon on n'élimine pas, faute de signal (§17).
 */
function evaluateCity(listing: AggregatedListing, criteria: SearchCriteria): CityOutcome {
  const postalCode = listing.postalCode.value;
  const targetPostalCodes = criteria.cities.flatMap(
    (wanted) => CITY_POSTAL_CODES[comparable(wanted)] ?? [],
  );

  // Le CODE POSTAL fait AUTORITÉ quand il est connu : une commune voisine
  // (06210 Mandelieu ≠ Nice) ou une mention trompeuse comme « à 33 km de Nice »
  // ne doit pas passer le filtre à cause du seul nom de ville (§16).
  if (postalCode !== null && targetPostalCodes.length > 0) {
    return targetPostalCodes.includes(postalCode)
      ? {
          matches: true,
          unknown: false,
          points: 30,
          reason: cityReason('match', `Code postal ${postalCode}`),
        }
      : {
          matches: false,
          unknown: false,
          points: 0,
          reason: cityReason('mismatch', `Hors zone (code postal ${postalCode})`),
        };
  }

  // Sans code postal : on se rabat sur le nom de ville.
  const city = listing.city.value;
  if (city !== null) {
    const inZone = criteria.cities.some((wanted) => city.includes(comparable(wanted)));
    return inZone
      ? {
          matches: true,
          unknown: false,
          points: 30,
          reason: cityReason('match', `Située à ${city}`),
        }
      : {
          matches: false,
          unknown: false,
          points: 0,
          reason: cityReason('mismatch', `Hors zone recherchée (${city})`),
        };
  }

  // Ni ville ni code postal exploitable : on n'élimine pas (§17).
  return {
    matches: true,
    unknown: true,
    points: 0,
    reason: cityReason('unknown', 'Ville non précisée par la source'),
  };
}

const cityReason = (suffix: string, label: string): ScoreReason => ({
  code: `city.${suffix}`,
  label,
  delta: suffix === 'match' ? 30 : 0,
});

export function scoreMatch(listing: AggregatedListing, criteria: SearchCriteria): MatchOutcome {
  const reasons: ScoreReason[] = [];
  const unknownSignals: string[] = [];
  let matchesCriteria = true;
  let total = 0;
  let maxTotal = 0;

  // --- Ville : critère éliminatoire ----------------------------------------
  maxTotal += 30;
  const cityOutcome = evaluateCity(listing, criteria);
  total += cityOutcome.points;
  if (!cityOutcome.matches) matchesCriteria = false;
  if (cityOutcome.unknown) unknownSignals.push('ville');
  reasons.push(cityOutcome.reason);

  // --- Loyer : critère éliminatoire ----------------------------------------
  maxTotal += 40;
  const price = listing.price.value;
  if (price === null) {
    unknownSignals.push('loyer');
    reasons.push({ code: 'price.unknown', label: 'Loyer non publié', delta: 0 });
  } else if (criteria.minPrice !== undefined && price < criteria.minPrice) {
    // Sous ce plancher, ce n'est presque jamais un logement (parking/box/cave
    // mal étiqueté « appartement »). Éliminatoire, mais l'annonce reste
    // consultable en « hors critères ».
    matchesCriteria = false;
    reasons.push({
      code: 'price.under_floor',
      label: `${price} € sous le plancher de ${criteria.minPrice} € (probable parking/box)`,
      delta: 0,
    });
  } else if (price <= criteria.maxPrice) {
    // Plus le loyer est bas sous le plafond, meilleur est le score : à 30 % du
    // budget sous le plafond, on atteint le maximum.
    const margin = (criteria.maxPrice - price) / criteria.maxPrice;
    const points = Math.round(30 + Math.min(10, margin * 33));
    total += points;
    reasons.push({
      code: 'price.within',
      label: `${price} € ≤ ${criteria.maxPrice} € de budget`,
      delta: points,
    });
  } else {
    matchesCriteria = false;
    reasons.push({
      code: 'price.over',
      label: `${price} € dépasse le budget de ${price - criteria.maxPrice} €`,
      delta: 0,
    });
  }

  // --- Surface : critère éliminatoire --------------------------------------
  maxTotal += 30;
  const area = listing.area.value;
  if (area === null) {
    unknownSignals.push('surface');
    reasons.push({ code: 'area.unknown', label: 'Surface non publiée', delta: 0 });
  } else if (area >= criteria.minArea) {
    // Au-delà du minimum, chaque m² compte de moins en moins.
    const bonus = Math.min(10, (area - criteria.minArea) / 2);
    const points = Math.round(20 + bonus);
    total += points;
    reasons.push({
      code: 'area.within',
      label: `${area} m² ≥ ${criteria.minArea} m²`,
      delta: points,
    });
  } else {
    matchesCriteria = false;
    reasons.push({
      code: 'area.under',
      label: `${area} m² sous le minimum de ${criteria.minArea} m²`,
      delta: 0,
    });
  }

  // --- Parking / box / garage : hors périmètre (bien non résidentiel) -------
  // L'utilisateur cherche un logement, pas une place de stationnement. On
  // exclut de la liste principale sans perdre l'annonce (§16, §53).
  if (listing.propertyType.value === 'parking') {
    matchesCriteria = false;
    reasons.push({
      code: 'type.parking',
      label: 'Stationnement / box — pas un logement',
      delta: 0,
    });
  }

  // --- Location étudiante : filtre éliminatoire quand l'utilisateur l'exclut -
  if (criteria.excludeStudent === true && isStudentHousing(listing)) {
    matchesCriteria = false;
    reasons.push({
      code: 'student.excluded',
      label: 'Location étudiante — exclue de la recherche',
      delta: 0,
    });
  }

  // --- Colocation : filtre éliminatoire quand l'utilisateur l'exclut --------
  // C'est un filtre binaire (dedans/dehors), pas une dimension notée : il
  // n'entre ni dans `total` ni dans `maxTotal`, et un flatShare inconnu
  // n'élimine pas (§17) — inutile donc de le compter en signal manquant, ce
  // qui fausserait le dénominateur pour toutes les annonces silencieuses.
  if (criteria.excludeFlatShare === true && listing.flatShare.value === true) {
    matchesCriteria = false;
    reasons.push({
      code: 'flatshare.excluded',
      label: 'Colocation — exclue de la recherche',
      delta: 0,
    });
  }

  // --- Nature du bailleur : filtre particulier / agence (§17) ---------------
  // Filtre binaire (dedans/dehors), pas une dimension notée. `'private'` masque
  // les agences CONNUES mais garde les bailleurs inconnus (on n'élimine pas sur
  // une donnée absente) ; `'agency'` ne garde que les agences. Les deux modes
  // partitionnent l'ensemble.
  const landlordFilter = criteria.landlordFilter ?? 'all';
  const isAgency = listing.contact.kind === 'agency';
  if (landlordFilter === 'private' && isAgency) {
    matchesCriteria = false;
    reasons.push({
      code: 'landlord.agency',
      label: 'Annonce d’agence — exclue (particuliers seulement)',
      delta: 0,
    });
  } else if (landlordFilter === 'agency' && !isAgency) {
    matchesCriteria = false;
    reasons.push({
      code: 'landlord.notAgency',
      label: 'Hors agence — exclue (agences seulement)',
      delta: 0,
    });
  }

  // --- Meublé / non meublé : filtre éliminatoire, au choix (§17) -------------
  // Un statut meublé INCONNU (null) n'est jamais exclu : on n'élimine pas sur
  // une donnée absente. Les deux modes partitionnent le connu.
  const furnishedFilter = criteria.furnishedFilter ?? 'all';
  const furnished = listing.furnished.value;
  if (furnishedFilter === 'furnished' && furnished === false) {
    matchesCriteria = false;
    reasons.push({
      code: 'furnished.excluded',
      label: 'Non meublé — exclu (meublés seulement)',
      delta: 0,
    });
  } else if (furnishedFilter === 'unfurnished' && furnished === true) {
    matchesCriteria = false;
    reasons.push({
      code: 'unfurnished.excluded',
      label: 'Meublé — exclu (non meublés seulement)',
      delta: 0,
    });
  }

  // --- Critères optionnels, inactifs dans le MVP (§2) -----------------------
  if (criteria.propertyTypes !== undefined && criteria.propertyTypes.length > 0) {
    maxTotal += 10;
    const type = listing.propertyType.value;
    if (criteria.propertyTypes.includes(type)) {
      total += 10;
      reasons.push({ code: 'type.match', label: `Type recherché (${type})`, delta: 10 });
    } else if (type === 'unknown') {
      unknownSignals.push('type de bien');
    }
  }

  if (criteria.furnished !== undefined) {
    maxTotal += 10;
    const furnished = listing.furnished.value;
    if (furnished === null) {
      unknownSignals.push('meublé');
    } else if (furnished === criteria.furnished) {
      total += 10;
      reasons.push({
        code: 'furnished.match',
        label: criteria.furnished ? 'Meublé, comme demandé' : 'Non meublé, comme demandé',
        delta: 10,
      });
    }
  }

  // Le score est rapporté au total réellement évaluable : une annonce dont la
  // surface est inconnue n'est pas pénalisée comme si elle était trop petite.
  const evaluated = maxTotal - unknownSignals.length * 10;
  const normalized = evaluated > 0 ? (total / evaluated) * 100 : 0;

  return {
    matchesCriteria,
    score: {
      value: clampScore(matchesCriteria ? normalized : Math.min(normalized, 40)),
      reasons,
      unknownSignals,
      confidence: maxTotal > 0 ? Math.max(0, evaluated / maxTotal) : 0,
    },
  };
}
