/**
 * Profil locataire côté navigateur (§25, §26).
 *
 * CHOIX DE CONCEPTION. Le profil est stocké dans le `localStorage` du
 * navigateur, et nulle part ailleurs. Il ne transite ni par l'API, ni par
 * Turso, ni par GitHub. Le message de contact est composé localement, sur
 * l'appareil de l'utilisateur.
 *
 * Conséquence assumée : le profil doit être ressaisi sur chaque appareil.
 * C'est le prix d'une garantie simple à vérifier — un dépôt public ne peut pas
 * divulguer une donnée qu'aucun de ses composants ne reçoit.
 */

import type { TenantProfile } from '@rentfinder/shared';

const PROFILE_STORAGE_KEY = 'rentfinder.tenantProfile';

/** Profil vide, servant de base au formulaire de configuration. */
export const EMPTY_PROFILE: TenantProfile = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  situation: '',
  monthlyIncome: null,
  hasGuarantor: false,
  moveInDate: null,
};

export function loadProfile(): TenantProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<TenantProfile>;
    // Un profil sans nom ne permet pas de composer un message crédible.
    if (!parsed.firstName || !parsed.lastName) return null;
    return { ...EMPTY_PROFILE, ...parsed };
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
