/**
 * Journalisation structurée (§62).
 *
 * Deux exigences opposées : les logs doivent être assez riches pour diagnostiquer
 * une source cassée, et ne JAMAIS contenir de secret ni de donnée personnelle.
 * L'expurgation est donc appliquée systématiquement à l'écriture, et non laissée
 * à la vigilance de chaque appelant.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  readonly level: LogLevel;
  readonly event: string;
  readonly at: string;
  readonly fields: Record<string, unknown>;
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** Dérive un logger qui ajoute des champs constants à chaque événement. */
  child(fields: Record<string, unknown>): Logger;
}

/**
 * Clés dont la valeur est systématiquement masquée, quelle que soit la source.
 * La comparaison est insensible à la casse et se fait par inclusion, afin
 * d'attraper `authToken`, `TURSO_AUTH_TOKEN`, `x-api-key`, etc.
 */
const REDACTED_KEY_PATTERNS = [
  'token',
  'secret',
  'password',
  'passwd',
  'authorization',
  'auth',
  'cookie',
  'session',
  'apikey',
  'api_key',
  'credential',
  'bearer',
  'phone',
  'email',
  'tenant',
];

const REDACTED = '[expurgé]';

/** Motifs repérés dans les chaînes libres, au cas où un secret s'y glisse. */
const VALUE_PATTERNS: readonly RegExp[] = [
  // JWT (format utilisé par les tokens Turso).
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Adresse e-mail.
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  // Numéro de téléphone français, avec ou sans séparateurs.
  /\b(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}\b/g,
];

function redactString(value: string): string {
  return VALUE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, REDACTED), value);
}

function isRedactedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Masque récursivement les valeurs sensibles d'un objet de log.
 * Exporté pour être testé directement (§55).
 */
export function redact(input: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (typeof input === 'string') return redactString(input);
  if (input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    output[key] = isRedactedKey(key) ? REDACTED : redact(value, depth + 1);
  }
  return output;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  readonly minLevel?: LogLevel;
  /** Réception des événements. Par défaut, une ligne JSON sur la sortie standard. */
  readonly sink?: (event: LogEvent) => void;
  readonly baseFields?: Record<string, unknown>;
  readonly now?: () => string;
}

/** Crée un logger structuré. Les événements sortent en JSON, une ligne chacun. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = LEVEL_ORDER[options.minLevel ?? 'info'];
  const now = options.now ?? (() => new Date().toISOString());
  const base = options.baseFields ?? {};
  const sink = options.sink ?? ((event: LogEvent) => console.log(JSON.stringify(event)));

  const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < minLevel) return;
    sink({
      level,
      event,
      at: now(),
      fields: redact({ ...base, ...fields }) as Record<string, unknown>,
    });
  };

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (fields) => createLogger({ ...options, baseFields: { ...base, ...fields } }),
  };
}

/** Logger silencieux, pratique dans les tests. */
export const silentLogger: Logger = createLogger({ minLevel: 'error', sink: () => {} });
