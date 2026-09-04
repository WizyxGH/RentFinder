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

// ---------------------------------------------------------------------------
// Sortie humaine (terminal)
// ---------------------------------------------------------------------------

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: 'DBG ',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR ',
};
const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: '[90m',
  info: '[36m',
  warn: '[33m',
  error: '[31m',
};
const DIM = '[90m';
const RESET = '[0m';

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Formate un événement pour un humain : `HH:MM:SS NIVEAU event · clé=valeur…`.
 * Les valeurs sont déjà expurgées en amont (§62). `color` ajoute des couleurs
 * ANSI (désactivées hors terminal).
 */
export function formatPretty(event: LogEvent, color: boolean): string {
  const time = event.at.slice(11, 19); // HH:MM:SS de l'ISO
  const label = LEVEL_LABEL[event.level];
  const fields = Object.entries(event.fields)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');

  if (!color) {
    return `${time} ${label} ${event.event}${fields === '' ? '' : ` · ${fields}`}`;
  }
  const c = LEVEL_COLOR[event.level];
  const sep = fields === '' ? '' : ` ${DIM}·${RESET} ${fields}`;
  return `${DIM}${time}${RESET} ${c}${label}${RESET} ${event.event}${sep}`;
}

/**
 * Sink lisible pour le terminal. Couleurs activées si la sortie est un TTY.
 * Les erreurs partent sur stderr.
 */
export function prettySink(event: LogEvent): void {
  const line = formatPretty(event, process.stdout.isTTY === true);
  if (event.level === 'error') console.error(line);
  else console.log(line);
}

// ---------------------------------------------------------------------------
// Narration humaine de la collecte (`pnpm collect`)
// ---------------------------------------------------------------------------

const BOLD = '[1m';
const GREEN = '[32m';
const CYAN = '[36m';

function paint(text: string, code: string, color: boolean): string {
  return color ? `${code}${text}${RESET}` : text;
}

/** Rend une liste courte : « a, b, c » ; tronquée au-delà de 8 éléments. */
function shortList(value: unknown): string {
  if (!Array.isArray(value)) return formatValue(value);
  const items = value.map(String);
  if (items.length <= 8) return items.join(', ');
  return `${items.slice(0, 8).join(', ')} +${items.length - 8}`;
}

const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);

/**
 * Traductions humaines des événements de collecte. Chaque entrée rend une
 * phrase claire (avec icône) ; `null` = laisser le format technique par défaut.
 * `f` sont les champs déjà expurgés de l'événement.
 */
const NARRATION: Record<string, (f: Record<string, unknown>, c: boolean) => string | null> = {
  'config.loaded': (f) =>
    `⚙️  Critères : ${shortList(f['cities'])} · ≤ ${f['maxPrice']} € · ≥ ${f['minArea']} m²` +
    (f['excludeFlatShare'] ? ' · sans colocation' : ''),
  'scheduler.plan': (f, c) => {
    const selected = Array.isArray(f['selected']) ? f['selected'] : [];
    const skipped = num(f['skipped']);
    return `🗓️  ${paint(String(selected.length), BOLD, c)} source(s) ce cycle : ${shortList(
      f['selected'],
    )}${skipped > 0 ? ` ${paint(`(${skipped} en attente)`, DIM, c)}` : ''}`;
  },
  'source.completed': (f, c) => {
    const src = paint(String(f['source'] ?? '?'), BOLD, c);
    const listings = num(f['listings']);
    const warn = num(f['warnings']);
    const badge = paint('✓', GREEN, c);
    return (
      `  ${badge} ${src} — ${listings} annonce(s) ` +
      paint(`(${num(f['requests'])} req, ${f['stopReason']})`, DIM, c) +
      (warn > 0 ? paint(` ⚠ ${warn}`, LEVEL_COLOR.warn, c) : '')
    );
  },
  'source.failed': (f, c) =>
    `  ${paint('✗', LEVEL_COLOR.error, c)} ${paint(String(f['source'] ?? '?'), BOLD, c)} — ` +
    `échec : ${f['error']}`,
  'pipeline.normalized': (f) => `🔧 ${num(f['count'])} annonce(s) collectée(s), normalisées`,
  'pipeline.occurrences_written': (f) =>
    `   occurrences → +${num(f['inserted'])} nouvelles · ~${num(f['updated'])} maj · =${num(
      f['unchanged'],
    )} inchangées`,
  'pipeline.deduplicated': (f) =>
    `🔗 ${num(f['groups'])} fiche(s) après dédoublonnage ` +
    `(${num(f['comparisons'])} comparaisons)`,
  'pipeline.geocoded': (f) =>
    `📍 ${num(f['resolved'])}/${num(f['attempted'])} adresse(s) géocodée(s)`,
  'pipeline.listings_written': (f, c) =>
    `💾 Fiches → ${paint(`+${num(f['inserted'])} nouvelles`, GREEN, c)} · ~${num(
      f['updated'],
    )} maj · =${num(f['unchanged'])} inchangées`,
  'pipeline.done': (f, c) => {
    const written = (f['written'] ?? {}) as Record<string, unknown>;
    const secs = (num(f['durationMs']) / 1000).toFixed(0);
    return (
      `\n${paint('━━━ Collecte terminée ━━━', BOLD, c)}\n` +
      `   ${paint(String(num(written['inserted'])), BOLD, c)} nouvelle(s) annonce(s) · ` +
      `${num(written['updated'])} mise(s) à jour · ${num(f['groups'])} fiches au total\n` +
      `   ${paint(`${secs} s`, CYAN, c)} · sources : ${shortList(f['sourcesRun'])}`
    );
  },
  'agencies.undiscovered': (f, c) => {
    const agencies = Array.isArray(f['agencies']) ? f['agencies'] : [];
    if (agencies.length === 0) return '';
    return paint(
      `🔎 Agences repérées dans les mails, non scrapées : ${shortList(agencies)}`,
      CYAN,
      c,
    );
  },
  'pipeline.partial_failure': (f, c) =>
    paint(
      `⚠ Sources en échec : ${shortList(f['sources'])} (les autres ont continué)`,
      LEVEL_COLOR.warn,
      c,
    ),
  // Bruit de démarrage : on ne montre que si des migrations sont appliquées.
  'db.migration.up_to_date': () => '',
  'db.migration.done': (f) => {
    const applied = Array.isArray(f['applied']) ? f['applied'] : [];
    return applied.length === 0 ? '' : `🗃️  Migrations appliquées : ${shortList(f['applied'])}`;
  },
};

/**
 * Sink « narratif » pour `pnpm collect` : traduit les événements connus en
 * phrases claires, et retombe sur le format technique pour le reste (utile en
 * `--verbose`). Erreurs sur stderr.
 */
export function narratorSink(event: LogEvent): void {
  const color = process.stdout.isTTY === true;
  const narrate = NARRATION[event.event];
  const line = narrate?.(event.fields, color) ?? formatPretty(event, color);
  if (line === '') return; // événement volontairement tu
  if (event.level === 'error') console.error(line);
  else console.log(line);
}
