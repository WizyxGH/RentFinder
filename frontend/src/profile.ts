/**
 * Profil locataire côté navigateur (§25, §26).
 *
 * CHOIX DE CONCEPTION. Le profil est stocké dans le `localStorage` du
 * navigateur, et nulle part ailleurs. Il ne transite ni par l'API, ni par la
 * base. Le message de contact est composé localement, sur l'appareil de
 * l'utilisateur.
 *
 * Conséquence assumée : le profil doit être ressaisi sur chaque appareil.
 * C'est le prix d'une garantie simple à vérifier — un dépôt public ne peut pas
 * divulguer une donnée qu'aucun de ses composants ne reçoit.
 */

import type { GuarantorKind, TenantProfile } from '@rentfinder/shared';

const PROFILE_STORAGE_KEY = 'rentfinder.tenantProfile';

/** Profil vide, servant de base au formulaire de configuration. */
export const EMPTY_PROFILE: TenantProfile = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  situation: '',
  monthlyIncome: null,
  guarantor: 'none',
  moveInDate: null,
};

/**
 * Les garanties proposées au choix, avec ce qu'il faut savoir de chacune.
 *
 * L'INDICATION COMPTE AUTANT QUE L'INTITULÉ. « Visale » ne dit rien à qui ne
 * connaît pas le dispositif — et c'est précisément le candidat qui en aurait le
 * plus besoin : celui qui n'a pas de proche en mesure de se porter caution.
 * Chaque ligne dit donc à quoi elle engage et où l'obtenir.
 *
 * Aucune démarche n'est faite ici : ces dispositifs se demandent sur leur
 * propre site, et nous ne transmettons rien à personne (§24).
 */
export interface GuarantorOption {
  readonly kind: GuarantorKind;
  readonly label: string;
  readonly hint: string;
}

export const GUARANTOR_OPTIONS: readonly GuarantorOption[] = [
  { kind: 'none', label: 'Aucune', hint: 'Le dossier repose sur vos seuls revenus.' },
  {
    kind: 'physical',
    label: 'Un garant (une personne)',
    hint: 'Un proche qui se porte caution. Il fournit son propre dossier complet, plus l’acte de cautionnement.',
  },
  {
    kind: 'visale',
    label: 'Garantie Visale',
    hint: 'Gratuite, portée par Action Logement. Elle se demande sur visale.fr AVANT de candidater : le visa obtenu tient lieu de garant, et une seule attestation remplace tout le dossier d’une caution.',
  },
  {
    kind: 'garantme',
    label: 'Garantie Garantme',
    hint: 'Caution payante délivrée par un organisme privé. Le certificat obtenu tient lieu de garant.',
  },
  {
    kind: 'other',
    label: 'Une autre garantie',
    hint: 'Loca-Pass, Cautioneo, garantie d’une école… Nommez-la : elle sera citée telle quelle dans vos messages.',
  },
];

/** L'intitulé d'une garantie, tel qu'il s'affiche dans le récapitulatif. */
export function guarantorLabel(profile: TenantProfile): string {
  if (profile.guarantor === 'other') {
    const name = profile.guarantorName?.trim() ?? '';
    return name === '' ? 'Une autre garantie' : name;
  }
  return GUARANTOR_OPTIONS.find((option) => option.kind === profile.guarantor)?.label ?? 'Aucune';
}

/**
 * Rattrape les profils enregistrés du temps du booléen « j'ai un garant ».
 *
 * Le profil vit dans ce navigateur, et rien ne le met à jour : un profil écrit
 * il y a six mois est lu tel quel. Sans cette reprise, un utilisateur qui avait
 * coché la case se retrouverait déclaré SANS garant — son message perdrait
 * l'argument, en silence, et il n'aurait aucune raison de rouvrir le
 * formulaire pour s'en apercevoir.
 *
 * Une case cochée devient « personne physique » : c'est ce qu'elle voulait dire
 * à l'époque où Visale n'était pas proposée ici. Rien n'est deviné au-delà.
 */
function migrateGuarantor(
  parsed: Partial<TenantProfile> & { hasGuarantor?: boolean },
): Pick<TenantProfile, 'guarantor'> | Record<string, never> {
  if (parsed.guarantor !== undefined) return {};
  return parsed.hasGuarantor === true ? { guarantor: 'physical' } : {};
}

export function loadProfile(): TenantProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<TenantProfile> & { hasGuarantor?: boolean };
    // Un profil sans nom ne permet pas de composer un message crédible.
    if (!parsed.firstName || !parsed.lastName) return null;
    return { ...EMPTY_PROFILE, ...parsed, ...migrateGuarantor(parsed) };
  } catch {
    return null;
  }
}

export function saveProfile(profile: TenantProfile): void {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* stockage indisponible — le profil vaudra pour la session courante */
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
  } catch {
    /* rien à faire */
  }
}
