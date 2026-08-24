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

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
const SEARCH_CONFIG_URL = new URL('../../../config/search.json', import.meta.url);

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
}

/** Lit les filtres courants (fichier + défauts) pour les présenter à l'UI. */
export function readSearchFilters(): EditableFilters {
  const c = loadPublicConfig().criteria;
  return {
    cities: c.cities,
    maxPrice: c.maxPrice,
    minArea: c.minArea,
    ...(c.minPrice !== undefined ? { minPrice: c.minPrice } : {}),
    ...(c.maxCommuteMinutes !== undefined ? { maxCommuteMinutes: c.maxCommuteMinutes } : {}),
    ...(c.excludeFlatShare !== undefined ? { excludeFlatShare: c.excludeFlatShare } : {}),
    ...(c.excludeStudent !== undefined ? { excludeStudent: c.excludeStudent } : {}),
    landlordFilter: c.landlordFilter ?? 'all',
  };
}

/**
 * Écrit les filtres dans `config/search.json`, en préservant les clés non
 * éditables du fichier (ex. `referencePricePerSqm`, `_commentaire`). Valide les
 * types ; lève sur entrée aberrante. Écriture atomique-ish (une seule passe).
 */
export function writeSearchFilters(input: unknown): EditableFilters {
  const filters = validateFilters(input);

  // Repartir du fichier existant pour ne pas perdre les autres réglages.
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(fileURLToPath(SEARCH_CONFIG_URL), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    /* fichier absent ou illisible : on repart de zéro */
  }

  const merged = { ...existing, ...filters };
  writeFileSync(fileURLToPath(SEARCH_CONFIG_URL), `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return filters;
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
  };
}

/**
 * Charge la configuration publique en fusionnant `config/search.json` (s'il
 * existe) par-dessus les défauts. C'est le fichier que l'utilisateur édite
 * pour régler SES filtres sans toucher au code (§66).
 *
 * Tolérant par conception : fichier absent → défauts ; JSON invalide → défauts
 * + avertissement. Une faute de frappe dans la config ne doit jamais casser la
 * collecte, seulement être signalée.
 *
 * @param onWarn rappel optionnel pour journaliser une config illisible.
 */
export function loadPublicConfig(onWarn?: (message: string) => void): PublicConfig {
  let raw: string;
  try {
    raw = readFileSync(fileURLToPath(SEARCH_CONFIG_URL), 'utf8');
  } catch {
    // Fichier absent : comportement par défaut, sans bruit.
    return PUBLIC_CONFIG;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SearchCriteria> & Partial<PublicConfig>;
    // Les champs de critères connus sont fusionnés ; les clés inconnues (dont
    // le « _commentaire » d'aide) sont ignorées sans dommage.
    const criteria: SearchCriteria = {
      ...MVP_CRITERIA,
      ...(parsed.cities !== undefined ? { cities: parsed.cities } : {}),
      ...(parsed.maxPrice !== undefined ? { maxPrice: parsed.maxPrice } : {}),
      ...(parsed.minArea !== undefined ? { minArea: parsed.minArea } : {}),
      ...(parsed.excludeFlatShare !== undefined
        ? { excludeFlatShare: parsed.excludeFlatShare }
        : {}),
      ...(parsed.minPrice !== undefined ? { minPrice: parsed.minPrice } : {}),
      ...(parsed.excludeStudent !== undefined ? { excludeStudent: parsed.excludeStudent } : {}),
      ...(parsed.furnished !== undefined ? { furnished: parsed.furnished } : {}),
      ...(parsed.propertyTypes !== undefined ? { propertyTypes: parsed.propertyTypes } : {}),
      ...(parsed.minRooms !== undefined ? { minRooms: parsed.minRooms } : {}),
      ...(parsed.landlordFilter !== undefined ? { landlordFilter: parsed.landlordFilter } : {}),
      ...(parsed.maxCommuteMinutes !== undefined
        ? { maxCommuteMinutes: parsed.maxCommuteMinutes }
        : {}),
      ...(parsed.energyClasses !== undefined ? { energyClasses: parsed.energyClasses } : {}),
    };

    return {
      ...PUBLIC_CONFIG,
      criteria,
      ...(typeof parsed.maxSourcesPerRun === 'number'
        ? { maxSourcesPerRun: parsed.maxSourcesPerRun }
        : {}),
      ...(typeof parsed.referencePricePerSqm === 'number'
        ? { referencePricePerSqm: parsed.referencePricePerSqm }
        : {}),
    };
  } catch {
    onWarn?.('config/search.json illisible (JSON invalide) — filtres par défaut appliqués');
    return PUBLIC_CONFIG;
  }
}

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

/** Réglages du notifieur Telegram (§29) — PRIVÉ. */
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

export interface TelegramConfig {
  readonly botToken: string;
  readonly chatId: string;
  /** Ne notifier qu'au-delà de cette priorité d'action (0 = toutes). */
  readonly minPriority: number;
  /**
   * Nb max de notifications individuelles par run avant de résumer.
   * `Infinity` par défaut : chaque annonce a sa propre notification —
   * `TELEGRAM_MAX_PER_RUN` permet de rétablir un plafond si ça devient trop.
   */
  readonly maxPerRun: number;
}

/**
 * Charge la configuration Telegram depuis l'environnement.
 *
 * Le jeton du bot et l'identifiant de conversation sont PRIVÉS : ils vivent
 * dans `.env`/secrets, jamais dans le dépôt, jamais dans les logs (§26, §66).
 * `null` si non configuré → le notifieur est simplement désactivé (le
 * collecteur tourne sans, la CI aussi).
 */
export function loadTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const botToken = env['TELEGRAM_BOT_TOKEN'];
  const chatId = env['TELEGRAM_CHAT_ID'];
  if (
    botToken === undefined ||
    botToken.trim() === '' ||
    chatId === undefined ||
    chatId.trim() === ''
  ) {
    return null;
  }
  const minPriority = Number.parseInt(env['TELEGRAM_MIN_PRIORITY'] ?? '', 10);
  const maxPerRun = Number.parseInt(env['TELEGRAM_MAX_PER_RUN'] ?? '', 10);
  return {
    botToken,
    chatId,
    minPriority: Number.isFinite(minPriority) ? minPriority : 0,
    // Sans réglage : pas de limite — une notification par annonce.
    maxPerRun: Number.isFinite(maxPerRun) && maxPerRun > 0 ? maxPerRun : Infinity,
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
