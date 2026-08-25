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
  it('utilise le message fixe pour toute annonce, avec le lien de l’annonce en pied', () => {
    const fixed = 'Bonjour, je suis intéressé. Cordialement, Jean.';
    const prepared = prepareMessage(listing('agency'), { ...PROFILE, applicationMessage: fixed });
    // Le message reste intact ; seul le lien de l'annonce est annexé en pied.
    expect(prepared.body).toBe(
      `${fixed}\n\nLien de l’annonce : https://exemple.invalid/annonce/123`,
    );
    expect(prepared.templateId).toBe('fixed');
    // L'objet porte le nom du candidat, sans référence d'annonce.
    expect(prepared.subject).toBe('Demande de visite - Jean Dupont');
    expect(prepared.subject).not.toMatch(/réf/i);
    // Canal e-mail détecté.
    expect(prepared.channel).toBe('email');
    expect(prepared.recipient).toBe('contact@example.invalid');
  });

  it('message fixe sans lien quand l’annonce n’a pas d’URL (verbatim strict)', () => {
    const fixed = 'Bonjour, je suis intéressé. Cordialement, Jean.';
    const prepared = prepareMessage(
      { ...listing('agency'), sourceUrl: null },
      { ...PROFILE, applicationMessage: fixed },
    );
    expect(prepared.body).toBe(fixed);
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
