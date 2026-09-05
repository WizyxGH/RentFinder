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
export type GuarantorKind = 'physical' | 'visale' | 'garantme' | 'other';

/**
 * Une garantie déclarée : sa nature, et son nom quand il en faut un.
 *
 * `name` ne sert qu'à deux choses : nommer un dispositif « autre » (Loca-Pass,
 * Cautioneo…), et distinguer DEUX GARANTS PHYSIQUES l'un de l'autre — « mon
 * père », « ma mère » — dans l'écran du dossier, où chacun a ses propres
 * pièces à fournir. Vide, on n'invente rien (§17).
 */
export interface Guarantor {
  readonly kind: GuarantorKind;
  readonly name?: string;
}

/**
 * Combien de garanties au plus.
 *
 * DEUX PARENTS QUI SE PORTENT CAUTION ENSEMBLE est le cas courant, trois se
 * voit, au-delà aucun bailleur ne suit. La borne existe surtout pour le
 * dossier : chaque garant physique ajoute cinq emplacements de pièces, et une
 * liste sans fin y deviendrait ingérable.
 */
export const MAX_GUARANTORS = 4;

/**
 * Les situations professionnelles proposées au choix.
 *
 * C'ÉTAIT UN CHAMP LIBRE, et il produisait des phrases fausses. Le message dit
 * « Je suis {situation} » : « en CDI » se lit bien, « en fonctionnaire » non
 * — et « fonctionnaire » figurait dans l'exemple donné à l'utilisateur. Chaque
 * entrée porte donc sa PROPRE tournure, plutôt qu'un « en » collé devant tout.
 *
 * La liste reprend les situations que les bailleurs et les organismes de
 * caution distinguent réellement : c'est sur elles qu'un dossier est jugé.
 * `other` garde le champ libre pour ce qui n'y figure pas — la liste ne
 * prétend pas à l'exhaustivité (§17).
 */
export interface TenantSituation {
  /** Valeur stockée dans le profil. */
  readonly value: string;
  /** Intitulé du menu. */
  readonly label: string;
  /** Ce qui suit « Je suis » dans le message. */
  readonly phrase: string;
}

export const TENANT_SITUATIONS: readonly TenantSituation[] = [
  { value: 'cdi', label: 'CDI', phrase: 'en CDI' },
  {
    value: 'cdi-essai',
    label: 'CDI en période d’essai',
    phrase: 'en CDI, en période d’essai',
  },
  { value: 'cdd', label: 'CDD', phrase: 'en CDD' },
  { value: 'interim', label: 'Intérim', phrase: 'en intérim' },
  { value: 'fonctionnaire', label: 'Fonctionnaire', phrase: 'fonctionnaire' },
  { value: 'independant', label: 'Indépendant ou freelance', phrase: 'à mon compte' },
  { value: 'liberal', label: 'Profession libérale', phrase: 'en profession libérale' },
  { value: 'dirigeant', label: 'Chef d’entreprise', phrase: 'chef d’entreprise' },
  { value: 'etudiant', label: 'Étudiant', phrase: 'étudiant' },
  { value: 'alternance', label: 'Alternance ou apprentissage', phrase: 'en alternance' },
  { value: 'stage', label: 'Stage', phrase: 'en stage' },
  { value: 'retraite', label: 'Retraité', phrase: 'retraité' },
  { value: 'recherche', label: 'En recherche d’emploi', phrase: 'en recherche d’emploi' },
  { value: 'other', label: 'Autre', phrase: '' },
];

/**
 * La tournure à mettre après « Je suis ».
 *
 * Une valeur inconnue est rendue telle quelle, précédée de « en » : c'est le
 * comportement d'avant la liste, et il fait vivre les profils saisis à la main
 * comme ceux venus d'un `.env`. On ne réécrit pas ce que l'utilisateur a écrit.
 */
export function situationPhrase(situation: string): string {
  const trimmed = situation.trim();
  if (trimmed === '') return '';
  const known = TENANT_SITUATIONS.find(
    (one) => one.value === trimmed || one.label.toLowerCase() === trimmed.toLowerCase(),
  );
  if (known !== undefined) return known.phrase === '' ? trimmed : known.phrase;
  return `en ${trimmed}`;
}

export interface TenantProfile {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  /**
   * Situation professionnelle : une valeur de `TENANT_SITUATIONS`, ou un texte
   * libre pour ce qui n'y figure pas. `situationPhrase` sait rendre les deux.
   */
  readonly situation: string;
  readonly monthlyIncome: number | null;
  /**
   * Les garanties de paiement, dans l'ordre où on les annonce. Vide = aucune.
   *
   * UNE LISTE ET NON UN CHOIX UNIQUE : deux parents se portent souvent caution
   * ensemble, et l'on cumule volontiers un garant physique avec une garantie
   * Visale — c'est même ce qui fait la force d'un dossier. Un champ unique
   * obligeait à taire la moitié de ce qu'on a.
   */
  readonly guarantors: readonly Guarantor[];
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
  const situation = situationPhrase(profile.situation);
  if (situation !== '') parts.push(situation);
  if (profile.monthlyIncome !== null) {
    parts.push(`avec des revenus mensuels de ${Math.round(profile.monthlyIncome)} €`);
  }
  const guarantee = describeGuarantees(profile.guarantors);
  if (guarantee !== '') parts.push(guarantee);
  return parts.length === 0 ? '' : `Je suis ${parts.join(' ')}.`;
}

/**
 * Toutes les garanties en une seule proposition.
 *
 * ON LES ÉNUMÈRE TOUTES : chacune compte pour le bailleur, et taire la seconde
 * affaiblirait un dossier qui en a deux. Les doublons sont écartés — « et deux
 * garants et un garant » ne veut rien dire — mais deux garants PHYSIQUES se
 * disent bien « deux garants ».
 */
function describeGuarantees(guarantors: readonly Guarantor[]): string {
  const physical = guarantors.filter((one) => one.kind === 'physical').length;
  const parts: string[] = [];
  if (physical === 1) parts.push('un garant');
  else if (physical > 1) parts.push(`${physical} garants`);

  for (const guarantor of guarantors) {
    if (guarantor.kind === 'physical') continue;
    const phrase = describeGuarantee(guarantor);
    if (phrase !== '' && !parts.includes(phrase)) parts.push(phrase);
  }

  if (parts.length === 0) return '';
  return `et couvert par ${joinWithAnd(parts)}`;
}

/** « a, b et c » — l'énumération française, sans virgule avant le « et ». */
function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
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
function describeGuarantee(guarantor: Guarantor): string {
  switch (guarantor.kind) {
    case 'physical':
      return 'un garant';
    case 'visale':
      return 'la garantie Visale';
    case 'garantme':
      return 'la garantie Garantme';
    case 'other': {
      const name = guarantor.name?.trim() ?? '';
      return name === '' ? 'une garantie de loyer' : name;
    }
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
