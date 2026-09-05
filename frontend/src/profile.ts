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

import type { Guarantor, GuarantorKind, TenantProfile } from '@rentfinder/shared';

const PROFILE_STORAGE_KEY = 'rentfinder.tenantProfile';

/** Profil vide, servant de base au formulaire de configuration. */
export const EMPTY_PROFILE: TenantProfile = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  situation: '',
  monthlyIncome: null,
  guarantors: [],
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
  /** L'intitulé attend un nom à côté (dispositif, ou lien de parenté). */
  readonly namePlaceholder?: string;
}

export const GUARANTOR_OPTIONS: readonly GuarantorOption[] = [
  {
    kind: 'physical',
    label: 'Un garant (une personne)',
    hint: 'Un proche qui se porte caution. Il fournit son propre dossier complet, plus l’acte de cautionnement.',
    namePlaceholder: 'Mon père, ma sœur…',
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
    namePlaceholder: 'Loca-Pass, Cautioneo…',
  },
];

/** L'intitulé d'une garantie, nom compris quand il y en a un. */
export function guarantorLabel(guarantor: Guarantor): string {
  const option = GUARANTOR_OPTIONS.find((one) => one.kind === guarantor.kind);
  const base = option?.label ?? 'Une garantie';
  const name = guarantor.name?.trim() ?? '';
  if (name === '') return base;
  return guarantor.kind === 'physical' ? `Garant : ${name}` : name;
}

/** Le récapitulatif de toutes les garanties, ou « Aucune ». */
export function guarantorsLabel(profile: TenantProfile): string {
  if (profile.guarantors.length === 0) return 'Aucune';
  return profile.guarantors.map(guarantorLabel).join(' · ');
}

/**
 * Rattrape les profils enregistrés avant que les garanties ne soient une liste.
 *
 * Le profil vit dans ce navigateur, et rien ne le met à jour : un profil écrit
 * il y a six mois est lu tel quel. Sans cette reprise, un utilisateur se
 * retrouverait déclaré SANS garantie — son message perdrait l'argument, en
 * silence, et il n'aurait aucune raison de rouvrir le formulaire pour s'en
 * apercevoir.
 *
 * DEUX ÉTATS ANCIENS À REPRENDRE : le booléen `hasGuarantor` des tout premiers
 * profils, puis le choix unique `guarantor` + `guarantorName`. Rien n'est
 * deviné au-delà de ce que chacun disait à son époque.
 */
type LegacyProfile = Partial<TenantProfile> & {
  hasGuarantor?: boolean;
  guarantor?: GuarantorKind | 'none';
  guarantorName?: string;
};

function migrateGuarantors(parsed: LegacyProfile): Pick<TenantProfile, 'guarantors'> | object {
  if (Array.isArray(parsed.guarantors)) return {};
  if (parsed.guarantor !== undefined && parsed.guarantor !== 'none') {
    const name = parsed.guarantorName?.trim() ?? '';
    return { guarantors: [{ kind: parsed.guarantor, ...(name === '' ? {} : { name }) }] };
  }
  // Une case cochée valait « personne physique », le seul sens qu'elle ait eu.
  if (parsed.hasGuarantor === true) return { guarantors: [{ kind: 'physical' as const }] };
  return {};
}

export function loadProfile(): TenantProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as LegacyProfile;
    // Un profil sans nom ne permet pas de composer un message crédible.
    if (!parsed.firstName || !parsed.lastName) return null;
    return { ...EMPTY_PROFILE, ...parsed, ...migrateGuarantors(parsed) };
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
