import { describe, expect, it } from 'vitest';
import { EMPTY_CONTACT } from './contact.js';
import {
  AGENCY_TEMPLATE,
  FOLLOW_UP_TEMPLATE,
  prepareMessage,
  type MessageListing,
  type TenantProfile,
} from './message.js';

const PROFILE: TenantProfile = {
  firstName: 'Jean',
  lastName: 'Dupont',
  email: 'jean@example.invalid',
  phone: '06 00 00 00 00',
  situation: 'CDI',
  monthlyIncome: 2400,
  hasGuarantor: true,
  moveInDate: null,
};

const listing = (kind: 'agency' | 'private'): MessageListing => ({
  propertyType: { value: 'apartment' },
  area: { value: 30 },
  city: { value: 'nice' },
  price: { value: 650 },
  contact: { ...EMPTY_CONTACT, kind, email: 'contact@example.invalid', reference: 'REF123' },
  sourceUrl: 'https://exemple.invalid/annonce/123',
});

describe('prepareMessage — message unique', () => {
  it('utilise le message fixe VERBATIM pour toute annonce quand il est défini', () => {
    const fixed = 'Bonjour, je suis intéressé. Cordialement, Jean.';
    const prepared = prepareMessage(listing('agency'), { ...PROFILE, applicationMessage: fixed });
    expect(prepared.body).toBe(fixed);
    expect(prepared.templateId).toBe('fixed');
    // L'objet garde la référence du bien pour le routage.
    expect(prepared.subject).toContain('REF123');
    // Canal e-mail détecté.
    expect(prepared.channel).toBe('email');
    expect(prepared.recipient).toBe('contact@example.invalid');
  });

  it('insère le lien de l’annonce dans le brouillon (modèle agence)', () => {
    const prepared = prepareMessage(listing('agency'), PROFILE, AGENCY_TEMPLATE);
    expect(prepared.body).toContain('Lien de l’annonce : https://exemple.invalid/annonce/123');
  });

  it('n’insère pas de ligne « lien » quand l’URL est absente (§17)', () => {
    const prepared = prepareMessage(
      { ...listing('agency'), sourceUrl: null },
      PROFILE,
      AGENCY_TEMPLATE,
    );
    expect(prepared.body).not.toContain('Lien de l’annonce');
  });

  it('respecte un objet personnalisé quand il est fourni', () => {
    const prepared = prepareMessage(listing('agency'), {
      ...PROFILE,
      applicationMessage: 'Mon message',
      applicationSubject: 'Candidature location',
    });
    expect(prepared.subject).toBe('Candidature location');
  });

  it('retombe sur le modèle par annonce si le message fixe est vide', () => {
    const prepared = prepareMessage(listing('agency'), { ...PROFILE, applicationMessage: '  ' });
    expect(prepared.templateId).toBe(AGENCY_TEMPLATE.id);
    expect(prepared.body).toContain('Bonjour');
  });

  it('un modèle explicite (relance) prime sur le message fixe', () => {
    const prepared = prepareMessage(
      listing('agency'),
      { ...PROFILE, applicationMessage: 'Mon message' },
      FOLLOW_UP_TEMPLATE,
    );
    expect(prepared.templateId).toBe(FOLLOW_UP_TEMPLATE.id);
  });
});
