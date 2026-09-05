/**
 * Génération des messages de premier contact (§24).
 *
 * Ce module vit dans `shared` parce que DEUX composants en ont besoin :
 *   - le frontend, qui prépare le message que l'utilisateur enverra lui-même
 *     en mode manuel (§22) ;
 *   - le collecteur, qui compose le message du mode automatique (§23).
 * Les dupliquer garantirait qu'ils divergent (§75).
 *
 * PRINCIPE DE MINIMISATION (§24). Le premier message contient le strict
 * nécessaire pour obtenir une réponse : qui je suis, ce que je vise, ma
 * solvabilité en une ligne, ma disponibilité. Le dossier locataire complet —
 * bulletins de salaire, avis d'imposition, pièce d'identité — n'est JAMAIS
 * joint ni détaillé au premier contact.
 */

import type { Contact } from './contact.js';
import type { PropertyType } from './listing.js';

/**
 * Profil locataire (§25).
 *
 * PRIVÉ. Ces données ne sont jamais versionnées ni transmises à un tiers :
 * elles vivent dans l'environnement du collecteur ou dans le `localStorage` du
 * navigateur, selon le mode d'usage (§26).
 */
/**
 * La forme que prend la garantie de paiement, quand il y en a une.
 *
 * UN BOOLÉEN NE SUFFISAIT PAS. « J'ai un garant » recouvrait trois situations
 * que les bailleurs ne traitent pas du tout pareil : une personne physique qui
 * se porte caution, la garantie Visale — gratuite, adossée à Action Logement,
 * et à ce titre l'argument le plus fort qu'un candidat sans garant puisse
 * avancer —, et les cautions payantes du type Garantme. Les annoncer par le
 * même mot revenait à taire ce qui distingue une candidature.
 *
 * La distinction ne change pas que la phrase du message : elle change les
 * PIÈCES à fournir. Une caution physique remet son propre dossier complet ;
 * une garantie institutionnelle le remplace par une attestation unique.
 */
export type GuarantorKind = 'none' | 'physical' | 'visale' | 'garantme' | 'other';

export interface TenantProfile {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  /** Situation professionnelle, ex. « CDI », « fonctionnaire », « étudiant ». */
  readonly situation: string;
  readonly monthlyIncome: number | null;
  readonly guarantor: GuarantorKind;
  /**
   * Le nom du dispositif quand `guarantor` vaut `other` — « Loca-Pass »,
   * « Cautioneo »… Ailleurs, il est ignoré : on ne nomme pas une garantie que
   * l'utilisateur n'a pas déclarée (§17).
   */
  readonly guarantorName?: string;
  /** Date d'entrée souhaitée, au format `AAAA-MM-JJ`. */
  readonly moveInDate: string | null;
  /**
   * Message de candidature UNIQUE, écrit une fois et envoyé tel quel pour
   * TOUTES les annonces (§22, §24 : l'utilisateur reste seul à l'envoyer). Vide
   * ou absent → on retombe sur le modèle personnalisé par annonce.
   */
  readonly applicationMessage?: string;
  /** Objet de l'e-mail de candidature ; vide → objet par défaut (avec réf.). */
  readonly applicationSubject?: string;
}

/**
 * Le minimum dont un modèle a besoin pour décrire un logement.
 *
 * Volontairement structurel : `ScoredListing` côté collecteur et `ListingView`
 * côté frontend le satisfont tous deux sans conversion.
 */
export interface MessageListing {
  readonly propertyType: { readonly value: PropertyType };
  readonly area: { readonly value: number | null };
  readonly city: { readonly value: string | null };
  readonly price: { readonly value: number | null };
  readonly contact: Contact;
  /** Lien direct de l'annonce, inséré dans le message pour lever l'ambiguïté. */
  readonly sourceUrl?: string | null;
}

const TYPE_LABELS: Record<PropertyType, string> = {
  apartment: 'l’appartement',
  house: 'la maison',
  studio: 'le studio',
  room: 'la chambre',
  loft: 'le loft',
  parking: 'le stationnement',
  other: 'le bien',
  unknown: 'le bien',
};

/** Description courte du bien, telle qu'elle apparaîtra dans le message. */
function describeListing(listing: MessageListing): string {
  const parts: string[] = [TYPE_LABELS[listing.propertyType.value]];

  const area = listing.area.value;
  if (area !== null) parts.push(`de ${area} m²`);

  const city = listing.city.value;
  if (city !== null && city !== '') {
    parts.push(`à ${city.charAt(0).toUpperCase()}${city.slice(1)}`);
  }

  const price = listing.price.value;
  if (price !== null) parts.push(`à ${Math.round(price)} €`);

  return parts.join(' ');
}

/**
 * Formule la solvabilité en une phrase.
 * Aucune pièce justificative, aucun détail superflu : juste de quoi rassurer
 * assez pour décrocher une visite (§24).
 */
function describeSolvency(profile: TenantProfile): string {
  const parts: string[] = [];
  if (profile.situation !== '') parts.push(`en ${profile.situation}`);
  if (profile.monthlyIncome !== null) {
    parts.push(`avec des revenus mensuels de ${Math.round(profile.monthlyIncome)} €`);
  }
  const guarantee = describeGuarantee(profile);
  if (guarantee !== '') parts.push(guarantee);
  return parts.length === 0 ? '' : `Je suis ${parts.join(' ')}.`;
}

/**
 * La garantie, dite dans les termes qu'un bailleur reconnaît.
 *
 * Visale est NOMMÉE : c'est un dispositif identifié, et le bailleur qui le
 * connaît sait qu'il couvre les loyers impayés sans lui coûter un centime. Le
 * taire pour dire « un garant » perdrait tout ce qui fait la force du dossier.
 *
 * Un dispositif « autre » n'est nommé que s'il a été nommé (§17) : sinon on
 * s'en tient à « une garantie de loyer », qui reste vrai.
 */
function describeGuarantee(profile: TenantProfile): string {
  switch (profile.guarantor) {
    case 'physical':
      return 'et un garant';
    case 'visale':
      return 'et couvert par la garantie Visale';
    case 'garantme':
      return 'et couvert par la garantie Garantme';
    case 'other': {
      const name = profile.guarantorName?.trim() ?? '';
      return name === '' ? 'et couvert par une garantie de loyer' : `et couvert par ${name}`;
    }
    case 'none':
      return '';
  }
}

/** Formate une date ISO en date française lisible. */
function formatFrenchDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export interface TemplateContext {
  readonly listing: MessageListing;
  readonly profile: TenantProfile;
}

export interface MessageTemplate {
  readonly id: string;
  readonly label: string;
  readonly subject: (context: TemplateContext) => string;
  readonly body: (context: TemplateContext) => string;
}

/** Ligne « lien de l'annonce », vide si l'URL n'est pas connue (§17). */
function listingLink(listing: MessageListing): string {
  const url = listing.sourceUrl;
  return url !== undefined && url !== null && url !== '' ? `Lien de l’annonce : ${url}` : '';
}

/** Nom complet du candidat, « Prénom NOM », vide si non renseigné. */
function applicantName(profile: TenantProfile): string {
  return [profile.firstName, profile.lastName]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ');
}

/** Objet « {base} - {Nom} » ; sans le «  - Nom » si le nom n'est pas renseigné. */
function subjectWithName(base: string, profile: TenantProfile): string {
  const name = applicantName(profile);
  return name !== '' ? `${base} - ${name}` : base;
}

/** Supprime les lignes vides consécutives laissées par un champ absent. */
const tidy = (lines: readonly string[]): string =>
  lines.filter((line, index) => !(line === '' && lines[index - 1] === '')).join('\n');

/** Modèle sobre, adapté à une agence. */
export const AGENCY_TEMPLATE: MessageTemplate = {
  id: 'agency-first-contact',
  label: 'Premier contact — agence',
  subject: ({ profile }) => subjectWithName('Demande de visite', profile),
  body: ({ listing, profile }) => {
    const availability =
      profile.moveInDate !== null
        ? ` Je suis disponible à partir du ${formatFrenchDate(profile.moveInDate)}.`
        : '';

    return tidy([
      'Bonjour,',
      '',
      `Votre annonce concernant ${describeListing(listing)} m’intéresse.`,
      listingLink(listing),
      `${describeSolvency(profile)}${availability}`.trim(),
      '',
      'Serait-il possible de convenir d’une visite ? Je suis disponible rapidement, ' +
        'y compris en fin de journée.',
      '',
      'Vous en remerciant par avance,',
      `${profile.firstName} ${profile.lastName}`,
      profile.phone,
    ]);
  },
};

/** Modèle plus direct, adapté à un particulier. */
export const PRIVATE_TEMPLATE: MessageTemplate = {
  id: 'private-first-contact',
  label: 'Premier contact — particulier',
  subject: ({ profile }) => subjectWithName('Votre annonce de location', profile),
  body: ({ listing, profile }) => {
    const availability =
      profile.moveInDate !== null
        ? ` Je peux emménager dès le ${formatFrenchDate(profile.moveInDate)}.`
        : '';

    return tidy([
      'Bonjour,',
      '',
      `Je vous contacte au sujet de ${describeListing(listing)}, qui correspond à ma recherche.`,
      listingLink(listing),
      `${describeSolvency(profile)}${availability}`.trim(),
      '',
      'Seriez-vous disponible pour une visite prochainement ?',
      '',
      'Bien cordialement,',
      `${profile.firstName} ${profile.lastName}`,
      profile.phone,
    ]);
  },
};

/** Modèle de relance, volontairement bref (§34). */
export const FOLLOW_UP_TEMPLATE: MessageTemplate = {
  id: 'follow-up',
  label: 'Relance',
  subject: ({ profile }) => subjectWithName('Relance — demande de visite', profile),
  body: ({ listing, profile }) =>
    tidy([
      'Bonjour,',
      '',
      `Je me permets de revenir vers vous concernant ${describeListing(listing)}.`,
      'Le bien est-il toujours disponible ? Je reste très intéressé et disponible pour une visite.',
      '',
      'Bien cordialement,',
      `${profile.firstName} ${profile.lastName}`,
      profile.phone,
    ]),
};

export const TEMPLATES: readonly MessageTemplate[] = [
  AGENCY_TEMPLATE,
  PRIVATE_TEMPLATE,
  FOLLOW_UP_TEMPLATE,
];

/** Canal par lequel le message peut partir, déduit des coordonnées disponibles. */
export type PreparedChannel = 'email' | 'phone' | 'form' | 'manual';

export interface PreparedMessage {
  readonly templateId: string;
  readonly subject: string;
  readonly body: string;
  readonly channel: PreparedChannel;
  /** Adresse, numéro ou URL selon le canal. `null` si aucune coordonnée. */
  readonly recipient: string | null;
}

/**
 * Prépare un message SANS l'envoyer.
 *
 * §22 : en mode manuel — le mode par défaut — cette fonction se contente de
 * produire le texte. Aucun envoi n'a lieu ici, quel que soit le score.
 */
export function prepareMessage(
  listing: MessageListing,
  profile: TenantProfile,
  template?: MessageTemplate,
): PreparedMessage {
  const chosen =
    template ?? (listing.contact.kind === 'private' ? PRIVATE_TEMPLATE : AGENCY_TEMPLATE);
  const context: TemplateContext = { listing, profile };

  // Message UNIQUE : quand l'utilisateur en a défini un et qu'aucun modèle
  // spécifique n'est imposé (ex. relance), on l'utilise tel quel pour toutes les
  // annonces. L'objet garde la référence du bien (routage), le corps reste
  // exactement celui écrit par l'utilisateur (§24).
  const fixedBody = profile.applicationMessage?.trim() ?? '';
  const useFixed = template === undefined && fixedBody !== '';
  const subject = useFixed
    ? profile.applicationSubject?.trim() || AGENCY_TEMPLATE.subject(context)
    : chosen.subject(context);
  // Message fixe : on le garde tel quel mais on annexe le LIEN de l'annonce en
  // pied (demande utilisateur) — utile au destinataire pour identifier le bien.
  const link = listingLink(listing);
  const body = useFixed
    ? link !== ''
      ? `${fixedBody}\n\n${link}`
      : fixedBody
    : chosen.body(context);

  const { email, phone, formUrl } = listing.contact;
  let channel: PreparedChannel = 'manual';
  let recipient: string | null = null;

  // Ordre de préférence : l'e-mail laisse une trace écrite et permet de
  // détailler ; le formulaire est le canal prévu par l'agence ; le téléphone
  // est le plus rapide mais ne transporte pas de message.
  if (email !== null) {
    channel = 'email';
    recipient = email;
  } else if (formUrl !== null) {
    channel = 'form';
    recipient = formUrl;
  } else if (phone !== null) {
    channel = 'phone';
    recipient = phone;
  }

  return {
    templateId: useFixed ? 'fixed' : chosen.id,
    subject,
    body,
    channel,
    recipient,
  };
}
