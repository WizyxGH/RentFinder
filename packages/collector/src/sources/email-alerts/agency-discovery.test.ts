import { describe, expect, it } from 'vitest';
import { extractContactedAgencies, findUndiscoveredAgencies } from './agency-discovery.js';

const CONFIRMATIONS = [
  '<div>Votre message a été envoyé à BEAUMONT IMMOBILIER Proposé par une agence immobilière</div>',
  '<div>Votre message a été envoyé à Foncia Nice Résidences. Merci.</div>',
  '<div>Proposé par AGENCE WINTER, Votre demande…</div>',
  '<div>message a été envoyé à LOCSERVICE, plateforme.</div>',
];

describe('extractContactedAgencies', () => {
  it('extrait les noms cités, sans les formules génériques', () => {
    const names = extractContactedAgencies(CONFIRMATIONS);
    expect(names).toContain('BEAUMONT IMMOBILIER');
    expect(names).toContain('Foncia Nice Résidences');
    expect(names).toContain('AGENCE WINTER');
    expect(names.some((n) => /une agence/i.test(n))).toBe(false);
  });
});

describe('findUndiscoveredAgencies', () => {
  const known = ['Foncia', 'Beaumont Immobilier', 'Citya Immobilier'];

  it('ne garde que les agences absentes des sources connues', () => {
    const found = findUndiscoveredAgencies(CONFIRMATIONS, known);
    // Foncia et Beaumont sont déjà des sources → écartées.
    expect(found.some((n) => /foncia|beaumont/i.test(n))).toBe(false);
    // Winter n'est pas une source → signalée.
    expect(found.some((n) => /winter/i.test(n))).toBe(true);
    // LocService est volontairement ignorée (portail, non conforme).
    expect(found.some((n) => /locservice/i.test(n))).toBe(false);
  });

  it('n’affirme rien quand aucun mot distinctif (que du générique)', () => {
    const found = findUndiscoveredAgencies(['message a été envoyé à AGENCE IMMOBILIERE'], known);
    expect(found).toEqual([]);
  });
});
