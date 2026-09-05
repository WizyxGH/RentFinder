/**
 * Pièces du dossier de location (§25).
 *
 * La liste vient du décret n° 2015-1437 du 5 novembre 2015, pris pour la loi
 * ALUR. Elle est LIMITATIVE : un bailleur ne peut légalement exiger aucune
 * autre pièce. C'est utile à savoir au moment de constituer le dossier, d'où
 * le rappel affiché sous la liste.
 *
 * Les pièces ne quittent jamais la machine. Ce module ne décrit que des
 * intitulés — il ne lit, n'envoie et ne stocke rien.
 */

import { MAX_GUARANTORS, type Guarantor } from '@rentfinder/shared';

export interface DossierSlot {
  /** Identifiant court, préfixé au nom du fichier pour le ranger. */
  readonly id: string;
  readonly label: string;
  /** Ce qui est accepté, dans les termes du décret. */
  readonly hint: string;
  readonly forGuarantor: boolean;
}

/**
 * Le garant fournit les mêmes justificatifs que le locataire, plus l'acte de
 * cautionnement : les intitulés sont donc dérivés plutôt que recopiés.
 */
const CORE: readonly (readonly [string, string, string])[] = [
  [
    'identite',
    'Pièce d’identité',
    'Carte nationale d’identité, passeport ou titre de séjour, en cours de validité.',
  ],
  [
    'domicile',
    'Justificatif de domicile',
    'Trois dernières quittances de loyer, ou attestation d’hébergement, ou dernier avis de taxe foncière.',
  ],
  [
    'situation',
    'Situation professionnelle',
    'Contrat de travail ou attestation de l’employeur ; carte d’étudiant ; extrait K bis pour un indépendant.',
  ],
  [
    'ressources',
    'Ressources',
    'Trois derniers bulletins de salaire, dernier ou avant-dernier avis d’imposition, attestations de versement (France Travail, CAF), justificatifs de pensions ou de revenus fonciers.',
  ],
];

/** Les pièces du candidat lui-même : toujours les mêmes, quelle que soit la garantie. */
const TENANT_SLOTS: readonly DossierSlot[] = CORE.map(([id, label, hint]) => ({
  id,
  label,
  hint,
  forGuarantor: false,
}));

/**
 * Les pièces d'une caution PERSONNE PHYSIQUE : son dossier entier, plus l'acte.
 *
 * Le préfixe porte le RANG du garant — `garant2-identite` — parce qu'ils sont
 * plusieurs et que leurs pièces ne se mélangent pas. Le premier garde les
 * identifiants historiques, sans rang : les pièces déjà déposées du temps où
 * l'on n'en déclarait qu'un doivent rester à leur place.
 */
function physicalGuarantorSlots(rank: number, who: string): DossierSlot[] {
  const prefix = rank === 0 ? 'garant' : `garant${rank + 1}`;
  const suffix = who === '' ? '' : ` — ${who}`;
  return [
    ...CORE.map(([id, label, hint]) => ({
      id: `${prefix}-${id}`,
      label: `${label}${suffix}`,
      hint,
      forGuarantor: true,
    })),
    {
      id: `${prefix}-caution`,
      label: `Acte de cautionnement${suffix}`,
      hint: 'Engagement signé du garant, portant le montant du loyer et la mention de la durée.',
      forGuarantor: true,
    },
  ];
}

const VISALE_SLOT: DossierSlot = {
  id: 'garant-visale',
  label: 'Visa Visale',
  hint: 'Attestation de visa délivrée sur visale.fr, à obtenir AVANT de candidater. Elle tient lieu de garant à elle seule : le bailleur n’a pas à réclamer les pièces d’une caution.',
  forGuarantor: true,
};

const CERTIFICATE_SLOT: DossierSlot = {
  id: 'garant-certificat',
  label: 'Certificat de garantie',
  hint: 'Le certificat délivré par l’organisme, portant votre nom et le montant couvert. Il tient lieu de garant.',
  forGuarantor: true,
};

/**
 * TOUS les emplacements existants, garanties confondues.
 *
 * Sert au RANGEMENT, pas à l'affichage : une pièce déposée du temps où l'on
 * déclarait un garant physique doit rester reconnue après un passage à Visale,
 * sinon elle bascule dans « Non classées » sans que rien ne l'explique. Les
 * rangs vont jusqu'au maximum autorisé, pour la même raison : retirer un garant
 * ne doit pas égarer ses pièces.
 */
export const DOSSIER_SLOTS: readonly DossierSlot[] = [
  ...TENANT_SLOTS,
  ...Array.from({ length: MAX_GUARANTORS }, (_one, rank) =>
    physicalGuarantorSlots(rank, ''),
  ).flat(),
  VISALE_SLOT,
  CERTIFICATE_SLOT,
];

/**
 * Les emplacements À REMPLIR, selon les garanties déclarées.
 *
 * Neuf emplacements étaient affichés à tout le monde, dont cinq pour un garant
 * que la plupart n'ont pas : le dossier semblait perpétuellement incomplet, et
 * le compteur « 0/5 » ne pouvait jamais atteindre son total. Une garantie
 * Visale n'appelle qu'une seule pièce ; l'absence de garantie, aucune.
 *
 * Deux garanties de même nature ne demandent pas deux fois les mêmes pièces —
 * un seul visa Visale suffit —, mais DEUX GARANTS PHYSIQUES ont chacun leur
 * dossier, et c'est bien ce que le bailleur réclamera.
 */
export function dossierSlots(guarantors: readonly Guarantor[]): readonly DossierSlot[] {
  const slots: DossierSlot[] = [...TENANT_SLOTS];
  let physicalRank = 0;
  let visale = false;
  let certificate = false;

  for (const guarantor of guarantors) {
    if (guarantor.kind === 'physical') {
      slots.push(...physicalGuarantorSlots(physicalRank, guarantor.name?.trim() ?? ''));
      physicalRank += 1;
    } else if (guarantor.kind === 'visale') {
      if (!visale) slots.push(VISALE_SLOT);
      visale = true;
    } else {
      if (!certificate) slots.push(CERTIFICATE_SLOT);
      certificate = true;
    }
  }
  return slots;
}

/**
 * Pièces COURAMMENT demandées et pourtant interdites par le décret.
 *
 * Les connaître évite de fournir plus que nécessaire — c'est la raison d'être
 * de ce rappel, et il n'y en a pas de plus juste que la liste elle-même.
 */
export const FORBIDDEN_PIECES: readonly string[] = [
  'relevé de compte bancaire',
  'attestation d’absence de crédit',
  'autorisation de prélèvement automatique',
  'photographie d’identité',
  'carte Vitale',
  'dossier médical',
  'extrait de casier judiciaire',
  'attestation de l’ancien bailleur disant que le locataire est à jour',
  'chèque de réservation',
];

/** Préfixe rangeant un fichier dans son emplacement, sans base de données. */
export function slotPrefix(slotId: string): string {
  return `${slotId}__`;
}

/** Emplacement auquel un fichier appartient, ou `null` s'il n'en porte pas. */
export function slotOf(fileName: string): string | null {
  const separator = fileName.indexOf('__');
  if (separator <= 0) return null;
  const id = fileName.slice(0, separator);
  return DOSSIER_SLOTS.some((slot) => slot.id === id) ? id : null;
}

/** Nom lisible d'un fichier, débarrassé de son préfixe de rangement. */
export function displayName(fileName: string): string {
  const separator = fileName.indexOf('__');
  return separator > 0 && slotOf(fileName) !== null ? fileName.slice(separator + 2) : fileName;
}
