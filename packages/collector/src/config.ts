/**
 * Configuration du collecteur (§66).
 *
 * Séparation stricte et intentionnelle :
 *
 *   - PUBLIQUE  : critères, seuils, fréquences. Versionnée dans le dépôt.
 *   - PRIVÉE    : profil locataire, points de référence, credentials. Lue
 *                 exclusivement depuis l'environnement, jamais écrite sur
 *                 disque, jamais journalisée, jamais versionnée (§20, §25, §26).
 *
 * Toute valeur privée absente est traitée comme « non configurée » et
 * désactive proprement la fonctionnalité concernée. Le collecteur doit pouvoir
 * tourner sans aucun secret : c'est ce qui rend la CI possible sur un dépôt
 * public.
 */

import type { AutoContactLimits, SearchCriteria, TenantProfile } from '@rentfinder/shared';
import { MVP_CRITERIA } from '@rentfinder/shared';
import type { TravelMode } from './core/geo.js';

// Le profil locataire est défini dans `shared` : le frontend l'utilise aussi
// pour composer les messages en mode manuel (§22, §25).
export type { TenantProfile };

// ---------------------------------------------------------------------------
// Configuration publique
// ---------------------------------------------------------------------------

export interface PublicConfig {
  readonly criteria: SearchCriteria;
  /** Sources exécutées au maximum par run GitHub Actions (§29, §30). */
  readonly maxSourcesPerRun: number;
  /** Loyer de référence au m² servant à la détection de risque (§19). */
  readonly referencePricePerSqm: number;
  /**
   * Nombre de runs consécutifs sans revoir une annonce avant de la passer en
   * `possiblyInactive`, puis en `inactive` (§32).
   */
  readonly missingRunsBeforePossiblyInactive: number;
  readonly missingRunsBeforeInactive: number;
}

export const PUBLIC_CONFIG: PublicConfig = {
  criteria: MVP_CRITERIA,
  maxSourcesPerRun: 6,
  referencePricePerSqm: 20,
  missingRunsBeforePossiblyInactive: 2,
  missingRunsBeforeInactive: 6,
};

/**
 * Garde-fous du contact automatique (§23).
 * L'interrupteur global est piloté par `AUTO_CONTACT_ENABLED` et vaut `false`
 * tant qu'il n'est pas explicitement mis à `true`.
 */
export function autoContactLimits(env: NodeJS.ProcessEnv = process.env): AutoContactLimits {
  return {
    enabled: env['AUTO_CONTACT_ENABLED'] === 'true',
    maxPerHour: 3,
    maxPerDay: 10,
    maxPerSourcePerDay: 5,
    cooldownSeconds: 600,
    thresholds: {
      minMatch: 90,
      minOpportunity: 90,
      minVisitProbability: 80,
      maxRisk: 20,
    },
  };
}

// ---------------------------------------------------------------------------
// Configuration privée
// ---------------------------------------------------------------------------

/** Point de référence pour le calcul des distances (§20). */
export interface ReferencePoint {
  /** Libellé neutre affiché dans l'interface, ex. « Travail ». */
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly mode: TravelMode;
}

/**
 * Charge les points de référence depuis l'environnement.
 *
 * Ces coordonnées révèlent le lieu de travail et le domicile : elles ne
 * figurent JAMAIS dans le dépôt (§20, §26). Renvoie un tableau vide si rien
 * n'est configuré, auquel cas l'interface n'affiche simplement aucune distance.
 */
export function loadReferencePoints(env: NodeJS.ProcessEnv = process.env): ReferencePoint[] {
  const points: ReferencePoint[] = [];

  const definitions = [
    { prefix: 'REFERENCE_WORK', fallbackLabel: 'Travail', mode: 'transit' as TravelMode },
    { prefix: 'REFERENCE_STATION', fallbackLabel: 'Gare', mode: 'walking' as TravelMode },
  ];

  for (const { prefix, fallbackLabel, mode } of definitions) {
    const lat = Number.parseFloat(env[`${prefix}_LAT`] ?? '');
    const lon = Number.parseFloat(env[`${prefix}_LON`] ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    points.push({
      label: env[`${prefix}_LABEL`] ?? fallbackLabel,
      latitude: lat,
      longitude: lon,
      mode,
    });
  }

  return points;
}

/**
 * Charge le profil locataire depuis l'environnement.
 * @returns `null` si le profil n'est pas configuré — la génération de message
 *          est alors désactivée plutôt que de produire un texte à trous.
 */
export function loadTenantProfile(env: NodeJS.ProcessEnv = process.env): TenantProfile | null {
  const firstName = env['TENANT_FIRST_NAME'];
  const lastName = env['TENANT_LAST_NAME'];
  if (firstName === undefined || lastName === undefined) return null;

  const income = Number.parseFloat(env['TENANT_MONTHLY_INCOME'] ?? '');

  return {
    firstName,
    lastName,
    email: env['TENANT_EMAIL'] ?? '',
    phone: env['TENANT_PHONE'] ?? '',
    situation: env['TENANT_SITUATION'] ?? '',
    monthlyIncome: Number.isFinite(income) ? income : null,
    hasGuarantor: env['TENANT_HAS_GUARANTOR'] === 'true',
    moveInDate: env['TENANT_MOVE_IN_DATE'] ?? null,
  };
}

/** User-Agent du collecteur — honnête et identifiable, jamais un faux navigateur (§10). */
export function collectorUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  return env['COLLECTOR_USER_AGENT'] ?? 'RentFinderBot/0.1 (+https://github.com/)';
}

/** Mode backfill, désactivé par défaut (§8). */
export function backfillEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['BACKFILL_ENABLED'] === 'true';
}
