/**
 * Scénario 5 — contact automatique (§53).
 *
 * Le mode automatique est la fonctionnalité la plus risquée du projet : un
 * défaut y envoie de vrais messages à de vraies personnes. Ces tests vérifient
 * que CHAQUE garde-fou du §23 bloque effectivement, et que l'interrupteur
 * global prime sur tout le reste.
 */

import { describe, expect, it } from 'vitest';
import type { AutoContactLimits, ContactAttempt, SourceDescriptor } from '@rentfinder/shared';
import { MVP_CRITERIA } from '@rentfinder/shared';
import { evaluateAutoContact, scoreListing, budgetFor, scheduleFor } from '@rentfinder/collector';
import { makeAggregated, makeContact, makeOccurrence, TEST_NOW } from '../helpers/factories.js';

const LIMITS: AutoContactLimits = {
  enabled: true,
  maxPerHour: 3,
  maxPerDay: 10,
  maxPerSourcePerDay: 5,
  cooldownSeconds: 600,
  thresholds: { minMatch: 90, minOpportunity: 90, minVisitProbability: 80, maxRisk: 20 },
};

const descriptor = (overrides: Partial<SourceDescriptor> = {}): SourceDescriptor => ({
  id: 'demo',
  name: 'Demo',
  domain: 'example.invalid',
  kind: 'portal',
  method: 'html',
  priority: 1,
  schedule: scheduleFor('portal'),
  budget: budgetFor('portal'),
  enabled: true,
  manualOnly: false,
  allowedPaths: [],
  notes: '',
  ...overrides,
});

/** Annonce excellente sur tous les critères, avec un e-mail joignable. */
function perfectListing() {
  const base = makeAggregated({
    price: 600,
    area: 30,
    city: 'nice',
    publishedAt: new Date(TEST_NOW - 5 * 60_000).toISOString(),
    contact: makeContact({ phone: '+33600000012', email: 'contact@example.invalid' }),
    occurrences: [makeOccurrence({ id: 'demo:1', sourceId: 'demo' })],
  });

  const scored = scoreListing(base, {
    criteria: MVP_CRITERIA,
    nowMs: TEST_NOW,
    referencePricePerSqm: 20,
    referencePoints: [],
  });

  // On force les scores au-delà des seuils : ce test porte sur les garde-fous,
  // pas sur le calibrage du scoring.
  return {
    ...scored,
    scores: {
      match: { ...scored.scores.match, value: 95 },
      opportunity: { ...scored.scores.opportunity, value: 95 },
      visitProbability: { ...scored.scores.visitProbability, value: 85 },
      risk: { ...scored.scores.risk, value: 5 },
    },
  };
}

const attempt = (overrides: Partial<ContactAttempt> = {}): ContactAttempt => ({
  id: 'a1',
  listingId: 'autre:1',
  sourceId: 'demo',
  channel: 'email',
  trigger: 'automatic',
  sentAt: new Date(TEST_NOW - 30 * 60_000).toISOString(),
  message: '',
  followUpIndex: 0,
  outcome: 'pending',
  ...overrides,
});

describe('interrupteur global (§23)', () => {
  it('bloque tout envoi quand il est sur OFF, même sur une annonce parfaite', () => {
    const decision = evaluateAutoContact({
      listing: perfectListing(),
      limits: { ...LIMITS, enabled: false },
      descriptors: [descriptor()],
      history: [],
      nowMs: TEST_NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/désactivé globalement/);
  });

  it('est le comportement par défaut du projet', () => {
    // §23 : AUTO_CONTACT_ENABLED vaut false tant qu'on ne l'active pas.
    const decision = evaluateAutoContact({
      listing: perfectListing(),
      limits: { ...LIMITS, enabled: false },
      descriptors: [descriptor()],
      history: [],
      nowMs: TEST_NOW,
    });
    expect(decision.allowed).toBe(false);
  });
});

describe('conditions d’autorisation', () => {
  it('autorise une annonce parfaite quand tout est réuni', () => {
    const decision = evaluateAutoContact({
      listing: perfectListing(),
      limits: LIMITS,
      descriptors: [descriptor()],
      history: [],
      nowMs: TEST_NOW,
    });

    expect(decision.allowed).toBe(true);
  });

  it('refuse une source déclarée manualOnly', () => {
    const decision = evaluateAutoContact({
      listing: perfectListing(),
      limits: LIMITS,
      descriptors: [descriptor({ manualOnly: true })],
      history: [],
      nowMs: TEST_NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/manualOnly/);
  });

  it('refuse un second contact sur la même annonce', () => {
    const listing = perfectListing();
    const decision = evaluateAutoContact({
      listing,
      limits: LIMITS,
      descriptors: [descriptor()],
      history: [attempt({ listingId: listing.id })],
      nowMs: TEST_NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/déjà contactée/);
  });
});

describe('seuils de score (§23)', () => {
  const belowThreshold = (
    key: 'match' | 'opportunity' | 'visitProbability' | 'risk',
    value: number,
  ) => {
    const listing = perfectListing();
    return evaluateAutoContact({
      listing: {
        ...listing,
        scores: { ...listing.scores, [key]: { ...listing.scores[key], value } },
      },
      limits: LIMITS,
      descriptors: [descriptor()],
      history: [],
      nowMs: TEST_NOW,
    });
  };

  it('refuse un match insuffisant', () => {
    expect(belowThreshold('match', 89).allowed).toBe(false);
  });

  it('refuse une opportunité insuffisante', () => {
    expect(belowThreshold('opportunity', 89).allowed).toBe(false);
  });

  it('refuse une probabilité de visite insuffisante', () => {
    expect(belowThreshold('visitProbability', 79).allowed).toBe(false);
  });

  it('refuse un risque trop élevé', () => {
    const decision = belowThreshold('risk', 21);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/risque/);
  });
});

describe('quotas et cooldown (§23)', () => {
  it('refuse au-delà du quota horaire', () => {
    const history = Array.from({ length: 3 }, (_unused, index) =>
      attempt({ id: `a${index}`, sentAt: new Date(TEST_NOW - 10 * 60_000).toISOString() }),
    );

    const decision = evaluateAutoContact({
      listing: perfectListing(),
      limits: LIMITS,
      descriptors: [descriptor()],
      history,
      nowMs: TEST_NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/quota horaire/);
  });

  it('refuse au-delà du quota journalier', () => {
    const history = Array.from({ length: 10 }, (_unused, index) =>
      attempt({ id: `a${index}`, sentAt: new Date(TEST_NOW - 5 * 3_600_000).toISOString() }),
    );

    const decision = evaluateAutoContact({
      listing: perfectListing(),
      limits: LIMITS,
      descriptors: [descriptor()],
      history,
      nowMs: TEST_NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/quota journalier atteint \(10/);
  });

  it('refuse au-delà du quota par source', () => {
    const history = Array.from({ length: 5 }, (_unused, index) =>
      attempt({
        id: `a${index}`,
        sourceId: 'demo',
        sentAt: new Date(TEST_NOW - 5 * 3_600_000).toISOString(),
      }),
    );

    const decision = evaluateAutoContact({
      listing: perfectListing(),
      limits: { ...LIMITS, maxPerDay: 100 },
      descriptors: [descriptor()],
      history,
      nowMs: TEST_NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/pour demo/);
  });

  it('refuse pendant le cooldown entre deux envois', () => {
    const decision = evaluateAutoContact({
      listing: perfectListing(),
      limits: LIMITS,
      descriptors: [descriptor()],
      history: [attempt({ sentAt: new Date(TEST_NOW - 60_000).toISOString() })],
      nowMs: TEST_NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/cooldown/);
  });

  it('autorise une fois le cooldown écoulé', () => {
    const decision = evaluateAutoContact({
      listing: perfectListing(),
      limits: LIMITS,
      descriptors: [descriptor()],
      history: [attempt({ sentAt: new Date(TEST_NOW - 3_600_000).toISOString() })],
      nowMs: TEST_NOW,
    });

    expect(decision.allowed).toBe(true);
  });
});

describe('canal disponible', () => {
  it('refuse s’il n’existe aucun canal automatisable', () => {
    const listing = perfectListing();
    const decision = evaluateAutoContact({
      listing: {
        ...listing,
        // Un téléphone seul ne permet pas d'envoyer un message.
        contact: { ...listing.contact, email: null, formUrl: null },
      },
      limits: LIMITS,
      descriptors: [descriptor()],
      history: [],
      nowMs: TEST_NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/aucun canal automatisable/);
  });
});
