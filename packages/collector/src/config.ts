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

import { fileURLToPath } from 'node:url';
import type { GuarantorKind, SearchCriteria, TenantProfile } from '@rentfinder/shared';
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

/**
 * Charge le `.env` de la racine du dépôt, s'il existe (mode local, §66).
 * Sans échec si le fichier est absent : la config privée est alors simplement
 * vide. À appeler AVANT toute lecture de `process.env`.
 */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    // Pas de .env : fonctionnement sans configuration privée (CI, démo).
  }
}

export const PUBLIC_CONFIG: PublicConfig = {
  criteria: MVP_CRITERIA,
  maxSourcesPerRun: 6,
  referencePricePerSqm: 20,
  // Réactivité voulue (décision 2026-08-22, seuil assoupli à 2/3 pour éviter les
  // faux « peut-être retirée » sur un simple raté de source) : absente 2
  // collectes → « peut-être plus disponible » ; 3 → retirée de la liste. Une
  // annonce qui réapparaît est automatiquement réactivée.
  missingRunsBeforePossiblyInactive: 2,
  missingRunsBeforeInactive: 3,
};

/**
 * Emplacement du fichier de configuration éditable, à la racine du dépôt.
 * Résolu depuis ce module (dist/config.js) pour être trouvé quel que soit le
 * répertoire d'exécution du CLI.
 */

/** Filtres éditables depuis l'interface (sous-ensemble de SearchCriteria). */
export interface EditableFilters {
  readonly cities: readonly string[];
  readonly maxPrice: number;
  readonly minPrice?: number;
  readonly minArea: number;
  /** Durée maximale du trajet domicile→travail, en minutes (§20). */
  readonly maxCommuteMinutes?: number;
  readonly excludeFlatShare?: boolean;
  readonly excludeStudent?: boolean;
  /** Nature du bailleur : tous, particuliers (hors agences), ou agences. */
  readonly landlordFilter?: 'all' | 'private' | 'agency';
  /** Meublé : tous, meublés seulement, ou non meublés seulement. */
  readonly furnishedFilter?: 'all' | 'furnished' | 'unfurnished';
}

/**
 * Applique par-dessus une configuration les critères enregistrés par le site.
 *
 * Tolérant par conception, comme la lecture du fichier : une valeur illisible
 * est ignorée et la collecte continue sur les critères du fichier (§69).
 */
export function withStoredCriteria(config: PublicConfig, stored: string | null): PublicConfig {
  if (stored === null) return config;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return config;
  }
  let filters: EditableFilters;
  try {
    filters = validateFilters(parsed);
  } catch {
    return config;
  }
  return { ...config, criteria: { ...config.criteria, ...filters } };
}

/** Valide et normalise les filtres reçus de l'interface. */
function validateFilters(input: unknown): EditableFilters {
  if (typeof input !== 'object' || input === null) throw new Error('Filtres invalides');
  const o = input as Record<string, unknown>;

  const cities = Array.isArray(o['cities'])
    ? o['cities'].filter((c): c is string => typeof c === 'string' && c.trim() !== '')
    : MVP_CRITERIA.cities;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;

  const maxPrice = num(o['maxPrice'], MVP_CRITERIA.maxPrice);
  const minPrice = num(o['minPrice'], MVP_CRITERIA.minPrice ?? 0);
  if (minPrice > maxPrice) throw new Error('Le loyer minimum dépasse le maximum');

  return {
    cities: cities.length > 0 ? cities : MVP_CRITERIA.cities,
    maxPrice,
    minPrice,
    minArea: num(o['minArea'], MVP_CRITERIA.minArea),
    maxCommuteMinutes: num(o['maxCommuteMinutes'], MVP_CRITERIA.maxCommuteMinutes ?? 60),
    excludeFlatShare: o['excludeFlatShare'] === true,
    excludeStudent: o['excludeStudent'] === true,
    landlordFilter:
      o['landlordFilter'] === 'private' || o['landlordFilter'] === 'agency'
        ? o['landlordFilter']
        : 'all',
    furnishedFilter:
      o['furnishedFilter'] === 'furnished' || o['furnishedFilter'] === 'unfurnished'
        ? o['furnishedFilter']
        : 'all',
  };
}

/**
 * Configuration publique du projet.
 *
 * ELLE NE VIENT PLUS D'UN FICHIER. `config/search.json` a été retiré : il
 * portait les mêmes réglages que la base, et les deux ne disaient pas toujours
 * la même chose — le fichier vivait sur UNE machine, la base suivait
 * l'utilisateur. Un réglage à deux endroits est un réglage dont personne ne
 * sait lequel fait autorité.
 *
 * Les valeurs ci-dessous sont donc les DÉFAUTS du projet, et les critères
 * réglés depuis le site (table `app_settings`) les remplacent — voir
 * `withStoredCriteria`, appelé juste après par la collecte.
 *
 * Le paramètre `onWarn` est conservé : les appelants le passent, et il servira
 * de nouveau le jour où une valeur invalide viendra de la base.
 */
export function loadPublicConfig(_onWarn?: (message: string) => void): PublicConfig {
  return PUBLIC_CONFIG;
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

/** Point de référence pas encore géocodé (adresse au lieu de coordonnées). */
export interface ReferencePointAddress {
  readonly label: string;
  readonly address: string;
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
 * Points de référence fournis sous forme d'ADRESSE (`REFERENCE_WORK_ADDRESS`…)
 * plutôt que de coordonnées — plus simple pour l'utilisateur. Ils seront
 * géocodés une fois au démarrage de la collecte (§20). Ces adresses sont
 * privées : elles vivent dans `.env`/secrets, jamais dans le dépôt (§26).
 */
export function loadReferenceAddresses(
  env: NodeJS.ProcessEnv = process.env,
): ReferencePointAddress[] {
  const definitions = [
    { prefix: 'REFERENCE_WORK', fallbackLabel: 'Travail', mode: 'transit' as TravelMode },
    { prefix: 'REFERENCE_STATION', fallbackLabel: 'Gare', mode: 'walking' as TravelMode },
  ];

  const points: ReferencePointAddress[] = [];
  for (const { prefix, fallbackLabel, mode } of definitions) {
    // On ne géocode que si l'adresse est fournie ET que les coordonnées ne le
    // sont pas déjà (les coordonnées explicites priment, elles sont exactes).
    const address = env[`${prefix}_ADDRESS`];
    const hasCoords =
      Number.isFinite(Number.parseFloat(env[`${prefix}_LAT`] ?? '')) &&
      Number.isFinite(Number.parseFloat(env[`${prefix}_LON`] ?? ''));
    if (address === undefined || address.trim() === '' || hasCoords) continue;

    points.push({ label: env[`${prefix}_LABEL`] ?? fallbackLabel, address, mode });
  }
  return points;
}

/**
 * Charge le profil locataire depuis l'environnement.
 * @returns `null` si le profil n'est pas configuré — la génération de message
 *          est alors désactivée plutôt que de produire un texte à trous.
 */
/**
 * La garantie de loyer déclarée, `none` si rien de reconnaissable.
 *
 * `TENANT_HAS_GUARANTOR=true` reste compris : c'est ce que les `.env` existants
 * contiennent, et une variable d'environnement ne se met pas à jour toute
 * seule. Elle vaut « personne physique », le seul sens qu'elle ait jamais eu.
 * Une valeur inconnue vaut `none` plutôt que d'inventer une garantie (§17).
 */
function readGuarantor(env: NodeJS.ProcessEnv): GuarantorKind {
  const declared = env['TENANT_GUARANTOR']?.trim().toLowerCase() ?? '';
  const known: readonly GuarantorKind[] = ['none', 'physical', 'visale', 'garantme', 'other'];
  const match = known.find((kind) => kind === declared);
  if (match !== undefined) return match;
  return env['TENANT_HAS_GUARANTOR'] === 'true' ? 'physical' : 'none';
}

export function loadTenantProfile(env: NodeJS.ProcessEnv = process.env): TenantProfile | null {
  const firstName = env['TENANT_FIRST_NAME'];
  const lastName = env['TENANT_LAST_NAME'];
  if (firstName === undefined || lastName === undefined) return null;

  const income = Number.parseFloat(env['TENANT_MONTHLY_INCOME'] ?? '');
  // Message de candidature UNIQUE (identique pour toutes les annonces) : utilisé
  // verbatim s'il est renseigné (§24). Multi-ligne accepté (guillemets dans .env).
  const applicationMessage = env['TENANT_APPLICATION_MESSAGE']?.trim();
  const applicationSubject = env['TENANT_APPLICATION_SUBJECT']?.trim();
  const guarantorName = env['TENANT_GUARANTOR_NAME']?.trim();

  return {
    firstName,
    lastName,
    email: env['TENANT_EMAIL'] ?? '',
    phone: env['TENANT_PHONE'] ?? '',
    situation: env['TENANT_SITUATION'] ?? '',
    monthlyIncome: Number.isFinite(income) ? income : null,
    guarantor: readGuarantor(env),
    moveInDate: env['TENANT_MOVE_IN_DATE'] ?? null,
    ...(applicationMessage !== undefined && applicationMessage !== ''
      ? { applicationMessage }
      : {}),
    ...(applicationSubject !== undefined && applicationSubject !== ''
      ? { applicationSubject }
      : {}),
    ...(guarantorName !== undefined && guarantorName !== '' ? { guarantorName } : {}),
  };
}

/** Identifiants d'un accès abonné PAYÉ (ex. BEP Logement) — PRIVÉ. */
export interface SubscriberCredentials {
  readonly user: string;
  readonly password: string;
}

/**
 * Charge les identifiants de l'espace abonné BEP depuis l'environnement.
 *
 * Accès **payé par l'utilisateur** : s'y connecter est une méthode autorisée
 * (§6), pas un contournement (§10). Les identifiants sont PRIVÉS : ils vivent
 * dans `.env`/secrets, jamais dans le dépôt, jamais dans les logs (§26, §66).
 * `null` si non configurés → la source reste en mode public.
 */
export function loadBepCredentials(
  env: NodeJS.ProcessEnv = process.env,
): SubscriberCredentials | null {
  const user = env['BEP_SUBSCRIBER_USER'];
  const password = env['BEP_SUBSCRIBER_PASSWORD'];
  if (user === undefined || user === '' || password === undefined || password === '') return null;
  return { user, password };
}

/** Réglages du routage en transports en commun (§20) — PRIVÉ. */
export interface TransitConfig {
  /** Jeton Navitia personnel (§26). */
  readonly token: string;
  /** Heure d'arrivée visée au travail, `HH:MM` (défaut `09:00`). */
  readonly arrivalTime: string;
}

/**
 * Charge la configuration du routage transports en commun (§20).
 *
 * Le jeton Navitia est PRIVÉ (`.env`/secrets, jamais dans le dépôt ni les logs,
 * §26). `null` si absent → on reste sur l'estimation vol d'oiseau (§17, §69).
 * `WORK_ARRIVAL_TIME` (défaut `09:00`) fixe l'heure d'arrivée visée.
 */
export function loadTransitConfig(env: NodeJS.ProcessEnv = process.env): TransitConfig | null {
  const token = env['NAVITIA_TOKEN'];
  if (token === undefined || token.trim() === '') return null;
  const arrival = (env['WORK_ARRIVAL_TIME'] ?? '').trim();
  const arrivalTime = /^\d{1,2}:\d{2}$/.test(arrival) ? arrival : '09:00';
  return { token: token.trim(), arrivalTime };
}

export interface ImapConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  /** Mot de passe D'APPLICATION (jamais le mot de passe principal, §26). */
  readonly password: string;
  /** Dossier/libellé à lire (ex. `Alertes`). Défaut `INBOX`. */
  readonly mailbox: string;
}

/**
 * Charge la configuration IMAP pour l'import des alertes e-mail (§6, §10).
 *
 * Voie conforme pour les portails qui interdisent le scraping : on lit la boîte
 * mail de l'utilisateur (lecture seule), on ne se connecte jamais au portail.
 * Le mot de passe d'application est PRIVÉ (`.env`, §26). `null` si non
 * configuré → l'import est simplement désactivé. Gmail par défaut.
 */
export function loadImapConfig(env: NodeJS.ProcessEnv = process.env): ImapConfig | null {
  const user = env['IMAP_USER'];
  const password = env['IMAP_APP_PASSWORD'];
  if (user === undefined || user.trim() === '' || password === undefined || password === '') {
    return null;
  }
  const port = Number.parseInt(env['IMAP_PORT'] ?? '', 10);
  return {
    host: env['IMAP_HOST']?.trim() || 'imap.gmail.com',
    port: Number.isFinite(port) && port > 0 ? port : 993,
    user: user.trim(),
    password,
    mailbox: env['IMAP_MAILBOX']?.trim() || 'INBOX',
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
