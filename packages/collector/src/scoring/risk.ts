/**
 * RISK SCORE — « cette annonce est-elle suspecte ? » (§19).
 *
 * Le score n'est jamais bloquant : une annonce à risque élevé reste visible et
 * consultable, accompagnée de ses raisons. §19 l'exige explicitement — un
 * signal inhabituel n'est pas une preuve, et masquer une annonce légitime
 * coûterait une visite.
 *
 * Les raisons sont affichées telles quelles dans l'interface, avec leur signe :
 *   ⚠ Prix inhabituellement faible
 *   ⚠ Informations contradictoires entre sources
 *   ✓ Agence identifiable
 */

import type {
  AggregatedListing,
  ExplainedScore,
  MergedField,
  ScoreReason,
} from '@rentfinder/shared';
import { clampScore } from '@rentfinder/shared';
import { comparable } from '../normalization/text.js';

/**
 * Un conflit entre sources n'est pas nécessairement suspect.
 *
 * La fusion enregistre fidèlement toute divergence (§15), y compris celles qui
 * s'expliquent trivialement : un portail affiche le loyer charges comprises,
 * l'autre hors charges. Seuls les écarts DISPROPORTIONNÉS méritent d'alimenter
 * le score de risque — sinon presque toute annonce multi-diffusée serait
 * signalée, et le score perdrait tout pouvoir discriminant.
 */
function hasSignificantConflict(
  field: MergedField<number | null>,
  relativeTolerance: number,
): boolean {
  const reference = field.value;
  if (reference === null || reference === 0) return false;

  return field.conflicts.some((conflict) => {
    if (conflict.value === null) return false;
    return Math.abs(conflict.value - reference) / Math.abs(reference) > relativeTolerance;
  });
}

/** Pour du texte, toute divergence non triviale compte. */
function hasTextConflict(field: MergedField<string | null>): boolean {
  const reference = field.value;
  if (reference === null) return false;
  return field.conflicts.some(
    (conflict) => conflict.value !== null && comparable(conflict.value) !== comparable(reference),
  );
}

export interface RiskOptions {
  /**
   * Loyer de référence au m² pour la zone, en €/m²/mois.
   *
   * ATTENTION : cette valeur est une hypothèse de travail, pas une donnée
   * officielle. Elle sert uniquement à repérer les écarts grossiers (un T2 à
   * 200 € dans une ville où le marché tourne autour de 20 €/m²). Elle est
   * configurable et doit être ajustée à partir d'observations réelles — voir
   * `docs/risk-detection.md`. Ne jamais la présenter à l'utilisateur comme un
   * prix de marché constaté (§17).
   */
  readonly referencePricePerSqm: number;
}

/**
 * Valeur de départ pour Nice, à affiner.
 *
 * Choisie volontairement basse pour éviter les faux positifs : mieux vaut ne
 * pas signaler une annonce douteuse que d'en signaler dix légitimes.
 */
export const DEFAULT_REFERENCE_PRICE_PER_SQM = 20;

/**
 * Formulations relevées dans les arnaques locatives courantes.
 * Leur présence est un signal, jamais une preuve.
 */
const SUSPICIOUS_PATTERNS: readonly { pattern: RegExp; label: string; points: number }[] = [
  {
    pattern: /\b(western union|mandat cash|mandat postal|paypal ami)\b/,
    label: 'Moyen de paiement inhabituel mentionné',
    points: 35,
  },
  {
    pattern:
      /\b(je suis a l etranger|actuellement a l etranger|expatrie|en mission a l etranger)\b/,
    label: 'Le bailleur déclare être à l’étranger',
    points: 30,
  },
  {
    pattern: /\b(sans visite|avant la visite|caution avant|virement avant|reservation avant)\b/,
    label: 'Paiement demandé avant toute visite',
    points: 35,
  },
  {
    pattern:
      /\b(envoyez? (?:vos |une )?(?:copie|photo)s? (?:de |du )?(?:passeport|carte d identite))\b/,
    label: 'Demande de pièce d’identité dès le premier contact',
    points: 20,
  },
  {
    // Formulation libre : « les clés vous seront envoyées par courrier »,
    // « remise des clés par la poste »… On accepte jusqu'à quarante caractères
    // entre le mot « clé » et le mode d'acheminement, sans franchir une phrase.
    pattern: /\bcles?\b[^.]{0,40}\b(par courrier|par la poste|par colis|par envoi postal)\b/,
    label: 'Remise des clés par courrier',
    points: 30,
  },
];

/**
 * `true` si le bien est un LOGEMENT, au sens où son loyer au mètre carré se
 * compare à celui du marché résidentiel. Un parking, un garage ou un local
 * n'entrent pas dans cette comparaison.
 */
function isDwelling(listing: AggregatedListing): boolean {
  const type = listing.propertyType.value;
  return type === 'apartment' || type === 'house' || type === 'studio' || type === 'loft';
}

/** Évalue le risque d'une annonce et énumère ses raisons. */
export function scoreRisk(listing: AggregatedListing, options: RiskOptions): ExplainedScore {
  const reasons: ScoreReason[] = [];
  const unknownSignals: string[] = [];
  let total = 0;

  const price = listing.price.value;
  const area = listing.area.value;

  // --- Loyer anormalement faible -------------------------------------------
  //
  // LA RÈGLE NE VAUT PAS PARTOUT, et l'ignorer coûtait cher. Mesuré sur
  // l'inventaire du 2026-09-02 : sur 57 annonces « à risque », 46 étaient des
  // COLOCATIONS, et pas une seule arnaque. Le calcul divisait le loyer d'UNE
  // CHAMBRE par la surface de TOUT l'appartement — « 780 € / 135 m² » donne
  // 5,8 €/m², et l'annonce partait en bas de liste comme suspecte.
  //
  // Même chose pour ce qui n'est pas un logement : un box à 100 € pour 15 m²
  // n'a pas de prix au mètre carré comparable à celui d'un appartement.
  //
  // Dans les deux cas on ne conclut RIEN plutôt que de conclure faux : le
  // signal rejoint les angles morts déclarés (§17, §19).
  const wholeDwelling = listing.flatShare.value !== true && isDwelling(listing);
  if (!wholeDwelling) {
    unknownSignals.push(
      listing.flatShare.value === true
        ? 'loyer au m² (colocation : la surface est celle du logement entier)'
        : 'loyer au m² (bien non résidentiel)',
    );
  } else if (price === null || area === null) {
    unknownSignals.push(price === null ? 'loyer' : 'surface');
  } else if (area > 0) {
    const pricePerSqm = price / area;
    const ratio = pricePerSqm / options.referencePricePerSqm;
    if (ratio < 0.4) {
      total += 40;
      reasons.push({
        code: 'price.veryLow',
        label: `Loyer très inférieur au marché (${pricePerSqm.toFixed(1)} €/m²)`,
        delta: 40,
      });
    } else if (ratio < 0.6) {
      total += 20;
      reasons.push({
        code: 'price.low',
        label: `Loyer nettement sous le marché (${pricePerSqm.toFixed(1)} €/m²)`,
        delta: 20,
      });
    } else {
      reasons.push({ code: 'price.normal', label: 'Loyer cohérent avec le marché', delta: 0 });
    }
  }

  // --- Incohérences internes ------------------------------------------------
  const rooms = listing.rooms.value;
  if (rooms !== null && area !== null) {
    // Moins de 9 m² par pièce est physiquement improbable pour un logement.
    if (area / rooms < 9) {
      total += 15;
      reasons.push({
        code: 'inconsistent.roomsArea',
        label: `${rooms} pièces annoncées pour ${area} m² — incohérent`,
        delta: 15,
      });
    }
  }

  // --- Contradictions entre sources (§15) ----------------------------------
  // La fusion a relevé tous les désaccords ; on ne retient ici que ceux qui
  // dépassent l'explication ordinaire (charges comprises ou non, arrondi).
  const conflictingFields: string[] = [];
  // 15 % d'écart sur un loyer dépasse largement l'effet des charges.
  if (hasSignificantConflict(listing.price, 0.15)) conflictingFields.push('loyer');
  // 10 % d'écart sur une surface ne s'explique pas par un arrondi.
  if (hasSignificantConflict(listing.area, 0.1)) conflictingFields.push('surface');
  if (hasTextConflict(listing.address)) conflictingFields.push('adresse');
  if (conflictingFields.length > 0) {
    const points = conflictingFields.length * 10;
    total += points;
    reasons.push({
      code: 'inconsistent.sources',
      label: `Informations contradictoires entre sources : ${conflictingFields.join(', ')}`,
      delta: points,
    });
  }

  // --- Identité vérifiable --------------------------------------------------
  const { agencyName, phone, email } = listing.contact;
  if (agencyName !== null) {
    reasons.push({
      code: 'identity.agency',
      label: `Agence identifiable (${agencyName})`,
      delta: 0,
    });
  } else if (phone === null && email === null) {
    total += 15;
    reasons.push({
      code: 'identity.none',
      label: 'Aucune identité ni coordonnée vérifiable',
      delta: 15,
    });
  } else {
    total += 5;
    reasons.push({ code: 'identity.partial', label: 'Bailleur non identifié nommément', delta: 5 });
  }

  // --- Formulations suspectes dans la description ---------------------------
  const description = listing.description.value;
  if (description === null) {
    unknownSignals.push('description');
  } else {
    const haystack = comparable(description);
    for (const { pattern, label, points } of SUSPICIOUS_PATTERNS) {
      if (pattern.test(haystack)) {
        total += points;
        reasons.push({ code: 'suspicious.wording', label, delta: points });
      }
    }
  }

  // --- Adresse absente sur une annonce par ailleurs très détaillée ----------
  if (listing.address.value === null && listing.latitude.value === null) {
    unknownSignals.push('localisation précise');
  }

  const optionalSignals = 4;
  const missing = Math.min(optionalSignals, unknownSignals.length);

  return {
    value: clampScore(total),
    reasons,
    unknownSignals,
    confidence: (optionalSignals - missing) / optionalSignals,
  };
}
