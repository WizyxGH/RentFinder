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
  guarantors: [{ kind: 'physical' }],
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

describe('garanties de loyer', () => {
  /**
   * Visale est le seul argument dont dispose un candidat sans proche capable de
   * se porter caution ; le dire « un garant » l'effacerait alors qu'il porte le
   * dossier. Le bailleur qui connaît le dispositif sait qu'il ne lui coûte rien.
   */
  it('nomme Visale plutôt que de dire « un garant »', () => {
    const { body } = prepareMessage(listing('agency'), {
      ...PROFILE,
      guarantors: [{ kind: 'visale' }],
    });
    expect(body).toContain('garantie Visale');
  });

  it('cite le dispositif nommé par l’utilisateur, et rien d’autre (§17)', () => {
    const named = prepareMessage(listing('agency'), {
      ...PROFILE,
      guarantors: [{ kind: 'other', name: 'Loca-Pass' }],
    }).body;
    expect(named).toContain('Loca-Pass');

    // Sans nom, on n'en invente pas un : « une garantie de loyer » reste vrai.
    const unnamed = prepareMessage(listing('agency'), {
      ...PROFILE,
      guarantors: [{ kind: 'other' }],
    }).body;
    expect(unnamed).toContain('une garantie de loyer');
  });

  it('ne promet aucune garantie quand il n’y en a pas', () => {
    const { body } = prepareMessage(listing('agency'), { ...PROFILE, guarantors: [] });
    expect(body).not.toContain('garant');
  });

  /**
   * DEUX PARENTS QUI SE PORTENT CAUTION ENSEMBLE est le cas courant, et le
   * champ unique d'avant obligeait à n'en annoncer qu'un. Taire le second
   * affaiblit un dossier qui en a deux.
   */
  it('compte les garants physiques plutôt que d’en répéter la mention', () => {
    const { body } = prepareMessage(listing('agency'), {
      ...PROFILE,
      guarantors: [{ kind: 'physical', name: 'mon père' }, { kind: 'physical' }],
    });
    expect(body).toContain('2 garants');
    expect(body).not.toContain('un garant et un garant');
  });

  it('énumère un garant ET une garantie institutionnelle', () => {
    const { body } = prepareMessage(listing('agency'), {
      ...PROFILE,
      guarantors: [{ kind: 'physical' }, { kind: 'visale' }],
    });
    expect(body).toContain('un garant');
    expect(body).toContain('garantie Visale');
    // L'énumération française : pas de virgule avant le « et ».
    expect(body).toContain('un garant et la garantie Visale');
  });
});

describe('situation professionnelle', () => {
  /**
   * Le message dit « Je suis {situation} ». Le champ libre produisait « Je suis
   * en fonctionnaire » — et « fonctionnaire » était l'exemple donné à
   * l'utilisateur. Chaque situation connue porte donc sa propre tournure.
   */
  it('accorde la phrase à la situation choisie', () => {
    const cdi = prepareMessage(listing('agency'), { ...PROFILE, situation: 'cdi' }).body;
    expect(cdi).toContain('Je suis en CDI');

    const agent = prepareMessage(listing('agency'), {
      ...PROFILE,
      situation: 'fonctionnaire',
    }).body;
    expect(agent).toContain('Je suis fonctionnaire');
    expect(agent).not.toContain('en fonctionnaire');
  });

  /** Un profil ancien porte du texte libre : on ne réécrit pas ce qu'il a écrit. */
  it('laisse passer une situation libre, précédée de « en »', () => {
    const { body } = prepareMessage(listing('agency'), {
      ...PROFILE,
      situation: 'intermittent du spectacle',
    });
    expect(body).toContain('Je suis en intermittent du spectacle');
  });
});
