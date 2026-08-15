/**
 * Tests des quatre scores (§16 à §19).
 *
 * L'exigence la plus surveillée ici : ne JAMAIS inventer une donnée absente
 * (§17). Un signal manquant ne doit pas être traité comme un signal à zéro,
 * et il doit apparaître dans `unknownSignals`.
 */

import { describe, expect, it } from 'vitest';
import { MVP_CRITERIA } from '@rentfinder/shared';
import {
  makeAggregated,
  makeContact,
  makeOccurrence,
  minutesBefore,
  TEST_NOW,
} from '../../../../tests/helpers/factories.js';
import { scoreMatch } from './match.js';
import { scoreOpportunity } from './opportunity.js';
import { scoreVisitProbability } from './visit-probability.js';
import { scoreRisk } from './risk.js';
import { computeDistances, scoreListing } from './index.js';

describe('scoreMatch (§16)', () => {
  it('valide une annonce dans les critères', () => {
    const { score, matchesCriteria } = scoreMatch(
      makeAggregated({ price: 650, area: 20, city: 'nice' }),
      MVP_CRITERIA,
    );
    expect(matchesCriteria).toBe(true);
    expect(score.value).toBeGreaterThan(80);
  });

  it('rejette une annonce au-dessus du budget (§53 scénario 3)', () => {
    const { score, matchesCriteria } = scoreMatch(
      makeAggregated({ price: 750, area: 20, city: 'nice' }),
      MVP_CRITERIA,
    );
    expect(matchesCriteria).toBe(false);
    expect(score.reasons.some((reason) => reason.code === 'price.over')).toBe(true);
  });

  it('rejette une annonce sous la surface minimale', () => {
    const { matchesCriteria } = scoreMatch(makeAggregated({ price: 400, area: 9 }), MVP_CRITERIA);
    expect(matchesCriteria).toBe(false);
  });

  it('rejette une annonce hors de la zone recherchée', () => {
    const { matchesCriteria } = scoreMatch(makeAggregated({ city: 'cannes' }), MVP_CRITERIA);
    expect(matchesCriteria).toBe(false);
  });

  it('exclut une colocation quand excludeFlatShare est actif', () => {
    const { matchesCriteria } = scoreMatch(makeAggregated({ flatShare: true }), MVP_CRITERIA);
    expect(matchesCriteria).toBe(false);
  });

  it('garde un logement entier et une coloc inconnue (§17)', () => {
    expect(scoreMatch(makeAggregated({ flatShare: false }), MVP_CRITERIA).matchesCriteria).toBe(
      true,
    );
    expect(scoreMatch(makeAggregated({ flatShare: null }), MVP_CRITERIA).matchesCriteria).toBe(
      true,
    );
  });

  it("n'exclut pas les colocations si le critère est désactivé", () => {
    const criteria = { ...MVP_CRITERIA, excludeFlatShare: false };
    expect(scoreMatch(makeAggregated({ flatShare: true }), criteria).matchesCriteria).toBe(true);
  });

  it('favorise un loyer nettement sous le plafond', () => {
    const cheap = scoreMatch(makeAggregated({ price: 500 }), MVP_CRITERIA).score.value;
    const tight = scoreMatch(makeAggregated({ price: 699 }), MVP_CRITERIA).score.value;
    expect(cheap).toBeGreaterThan(tight);
  });

  it('ne pénalise pas une surface inconnue comme une surface trop petite (§17)', () => {
    const unknown = scoreMatch(makeAggregated({ area: null }), MVP_CRITERIA);
    const tooSmall = scoreMatch(makeAggregated({ area: 5 }), MVP_CRITERIA);

    expect(unknown.matchesCriteria).toBe(true);
    expect(tooSmall.matchesCriteria).toBe(false);
    expect(unknown.score.unknownSignals).toContain('surface');
    expect(unknown.score.confidence).toBeLessThan(1);
  });

  it('justifie chaque contribution', () => {
    const { score } = scoreMatch(makeAggregated({ price: 650, area: 20 }), MVP_CRITERIA);
    expect(score.reasons.length).toBeGreaterThan(0);
    for (const reason of score.reasons) {
      expect(reason.label).not.toBe('');
      expect(reason.code).not.toBe('');
    }
  });
});

describe('scoreOpportunity (§17)', () => {
  it('récompense fortement une annonce très fraîche', () => {
    const fresh = scoreOpportunity(makeAggregated({ publishedAt: minutesBefore(4) }), {
      nowMs: TEST_NOW,
    });
    const old = scoreOpportunity(makeAggregated({ publishedAt: minutesBefore(60 * 24 * 5) }), {
      nowMs: TEST_NOW,
    });

    expect(fresh.value).toBeGreaterThan(old.value);
    expect(fresh.reasons.some((reason) => reason.code.startsWith('freshness'))).toBe(true);
  });

  it('valorise la disponibilité d’un téléphone', () => {
    const withPhone = scoreOpportunity(
      makeAggregated({ publishedAt: minutesBefore(30), contact: makeContact() }),
      { nowMs: TEST_NOW },
    );
    const without = scoreOpportunity(makeAggregated({ publishedAt: minutesBefore(30) }), {
      nowMs: TEST_NOW,
    });

    expect(withPhone.value).toBeGreaterThan(without.value);
  });

  it('déclare inconnus les favoris et les vues quand la source ne les publie pas (§17)', () => {
    const score = scoreOpportunity(makeAggregated(), { nowMs: TEST_NOW });

    expect(score.unknownSignals).toContain('nombre de favoris');
    expect(score.unknownSignals).toContain('nombre de vues');
    // Aucune raison ne doit prétendre connaître un chiffre absent.
    expect(score.reasons.some((reason) => reason.code === 'interest.favorites')).toBe(false);
    expect(score.confidence).toBeLessThan(1);
  });

  it('n’assimile jamais un signal absent à un signal nul', () => {
    const unknown = scoreOpportunity(
      makeAggregated({ publishedAt: minutesBefore(30), favorites: null }),
      { nowMs: TEST_NOW },
    );
    const zero = scoreOpportunity(
      makeAggregated({ publishedAt: minutesBefore(30), favorites: 0 }),
      { nowMs: TEST_NOW },
    );

    expect(unknown.unknownSignals).toContain('nombre de favoris');
    expect(zero.unknownSignals).not.toContain('nombre de favoris');
  });

  it('minore la confiance quand la date de publication est déduite', () => {
    const deduced = scoreOpportunity(
      makeAggregated({ publishedAt: null, firstSeenAt: minutesBefore(5) }),
      { nowMs: TEST_NOW },
    );
    expect(deduced.unknownSignals).toContain('date de publication exacte');
    expect(deduced.reasons.some((reason) => reason.code === 'freshness.firstSeen')).toBe(true);
  });

  it('tient compte de la diffusion multi-sources', () => {
    const multi = scoreOpportunity(
      makeAggregated({
        publishedAt: minutesBefore(10),
        occurrences: [
          makeOccurrence({ id: 'leboncoin:1', sourceId: 'leboncoin' }),
          makeOccurrence({ id: 'seloger:1', sourceId: 'seloger' }),
          makeOccurrence({ id: 'bienici:1', sourceId: 'bienici' }),
        ],
      }),
      { nowMs: TEST_NOW },
    );
    expect(multi.reasons.some((reason) => reason.code === 'exposure.multi')).toBe(true);
  });
});

describe('scoreVisitProbability (§18)', () => {
  it('récompense un contact très précoce', () => {
    const early = scoreVisitProbability(
      makeAggregated({ publishedAt: minutesBefore(20), contact: makeContact() }),
      { nowMs: TEST_NOW },
    );
    const late = scoreVisitProbability(
      makeAggregated({ publishedAt: minutesBefore(60 * 24 * 5), contact: makeContact() }),
      { nowMs: TEST_NOW },
    );
    expect(early.value).toBeGreaterThan(late.value);
  });

  it('pénalise l’absence totale de canal de contact', () => {
    const score = scoreVisitProbability(makeAggregated(), { nowMs: TEST_NOW });
    expect(score.reasons.some((reason) => reason.code === 'channel.none')).toBe(true);
  });

  it('signale l’absence de statistiques personnelles plutôt que de les simuler (§18)', () => {
    const score = scoreVisitProbability(makeAggregated(), { nowMs: TEST_NOW });
    expect(score.unknownSignals.join(' ')).toMatch(/statistiques personnelles/);
    expect(score.confidence).toBeLessThan(1);
  });

  it('intègre les statistiques observées lorsqu’elles existent', () => {
    const listing = makeAggregated({
      publishedAt: minutesBefore(20),
      contact: makeContact(),
      occurrences: [makeOccurrence({ id: 'laforet:1', sourceId: 'laforet' })],
    });

    const withStats = scoreVisitProbability(listing, {
      nowMs: TEST_NOW,
      observedStats: { visitRateBySource: { laforet: 0.6 } },
    });

    expect(withStats.reasons.some((reason) => reason.code === 'stats.observed')).toBe(true);
  });

  it('reste borné à [0, 100]', () => {
    const score = scoreVisitProbability(
      makeAggregated({ publishedAt: minutesBefore(60 * 24 * 30) }),
      { nowMs: TEST_NOW },
    );
    expect(score.value).toBeGreaterThanOrEqual(0);
    expect(score.value).toBeLessThanOrEqual(100);
  });
});

describe('scoreRisk (§19)', () => {
  const options = { referencePricePerSqm: 20 };

  it('ne signale rien de particulier sur une annonce normale', () => {
    const score = scoreRisk(
      makeAggregated({ price: 690, area: 34, contact: makeContact() }),
      options,
    );
    expect(score.value).toBeLessThan(20);
  });

  it('signale un loyer anormalement bas', () => {
    // 250 € pour 60 m² à Nice : 4,2 €/m², très en dessous du marché.
    const score = scoreRisk(makeAggregated({ price: 250, area: 60, rooms: 3 }), options);
    expect(score.value).toBeGreaterThan(40);
    expect(score.reasons.some((reason) => reason.code === 'price.veryLow')).toBe(true);
  });

  it('signale une incohérence entre pièces et surface', () => {
    const score = scoreRisk(makeAggregated({ price: 690, area: 20, rooms: 4 }), options);
    expect(score.reasons.some((reason) => reason.code === 'inconsistent.roomsArea')).toBe(true);
  });

  it('signale les formulations typiques d’arnaque', () => {
    const score = scoreRisk(
      makeAggregated({
        description:
          'Je suis actuellement à l’étranger, les clés seront envoyées par courrier après virement.',
        contact: makeContact({ agencyName: null, name: null }),
      }),
      options,
    );
    expect(score.value).toBeGreaterThan(50);
    expect(
      score.reasons.filter((reason) => reason.code === 'suspicious.wording').length,
    ).toBeGreaterThan(0);
  });

  it('crédite une agence identifiable', () => {
    const score = scoreRisk(makeAggregated({ contact: makeContact() }), options);
    expect(score.reasons.some((reason) => reason.code === 'identity.agency')).toBe(true);
  });

  it('signale une identité invérifiable', () => {
    const score = scoreRisk(
      makeAggregated({ contact: makeContact({ agencyName: null, phone: null, email: null }) }),
      options,
    );
    expect(score.reasons.some((reason) => reason.code === 'identity.none')).toBe(true);
  });

  it('ignore un écart de loyer explicable par les charges', () => {
    // 690 € contre 715 € : la fusion conserve les deux valeurs (§15), mais le
    // risque ne s'en émeut pas — sinon toute annonce multi-diffusée serait
    // signalée et le score perdrait tout pouvoir discriminant.
    const listing = makeAggregated({ price: 690, area: 34, contact: makeContact() });
    const withMinorConflict = {
      ...listing,
      price: {
        ...listing.price,
        conflicts: [{ value: 715, sourceId: 'autre', observedAt: listing.price.observedAt }],
      },
    };

    const score = scoreRisk(withMinorConflict, options);
    expect(score.reasons.some((reason) => reason.code === 'inconsistent.sources')).toBe(false);
  });

  it('signale un écart de loyer disproportionné entre sources', () => {
    const listing = makeAggregated({ price: 690, area: 34, contact: makeContact() });
    const withMajorConflict = {
      ...listing,
      price: {
        ...listing.price,
        conflicts: [{ value: 1400, sourceId: 'autre', observedAt: listing.price.observedAt }],
      },
    };

    const score = scoreRisk(withMajorConflict, options);
    expect(score.reasons.some((reason) => reason.code === 'inconsistent.sources')).toBe(true);
  });

  it('n’exclut jamais une annonce : le score reste un signal (§19)', () => {
    const score = scoreRisk(makeAggregated({ price: 100, area: 60 }), options);
    // Un risque élevé se traduit par un score et des raisons, jamais par une
    // exception ni par une suppression.
    expect(score.value).toBeLessThanOrEqual(100);
    expect(score.reasons.length).toBeGreaterThan(0);
  });
});

describe('computeDistances (§20)', () => {
  const points = [
    { label: 'Travail', latitude: 43.7031, longitude: 7.2661, mode: 'transit' as const },
    { label: 'Gare', latitude: 43.7045, longitude: 7.2619, mode: 'walking' as const },
  ];

  it('calcule une distance et une durée pour chaque point de référence', () => {
    const distances = computeDistances(
      makeAggregated({ latitude: 43.6961, longitude: 7.2712 }),
      points,
    );

    expect(distances).toHaveLength(2);
    expect(distances[0]?.label).toBe('Travail');
    expect(distances[0]?.distanceKm).toBeGreaterThan(0);
    expect(distances[0]?.durationMinutes).toBeGreaterThan(0);
  });

  it('ne produit aucune distance sans coordonnées sur l’annonce', () => {
    const distances = computeDistances(makeAggregated({ latitude: null }), points);
    expect(distances).toEqual([]);
  });

  it('ne produit aucune distance si aucun point de référence n’est configuré (§20)', () => {
    const distances = computeDistances(
      makeAggregated({ latitude: 43.6961, longitude: 7.2712 }),
      [],
    );
    expect(distances).toEqual([]);
  });
});

describe('scoreListing — assemblage', () => {
  it('produit les quatre scores et le verdict de correspondance', () => {
    const scored = scoreListing(makeAggregated({ price: 650, area: 20 }), {
      criteria: MVP_CRITERIA,
      nowMs: TEST_NOW,
      referencePricePerSqm: 20,
      referencePoints: [],
    });

    expect(scored.scores.match.value).toBeGreaterThan(0);
    expect(scored.scores.opportunity).toBeDefined();
    expect(scored.scores.visitProbability).toBeDefined();
    expect(scored.scores.risk).toBeDefined();
    expect(scored.matchesCriteria).toBe(true);
    expect(scored.distances).toEqual([]);
  });
});
