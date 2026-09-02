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

export const DOSSIER_SLOTS: readonly DossierSlot[] = [
  ...CORE.map(([id, label, hint]) => ({ id, label, hint, forGuarantor: false })),
  ...CORE.map(([id, label, hint]) => ({
    id: `garant-${id}`,
    label,
    hint,
    forGuarantor: true,
  })),
  {
    id: 'garant-caution',
    label: 'Acte de cautionnement',
    hint: 'Engagement signé du garant, portant le montant du loyer et la mention de la durée.',
    forGuarantor: true,
  },
];

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
