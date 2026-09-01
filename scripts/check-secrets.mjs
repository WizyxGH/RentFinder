#!/usr/bin/env node
/**
 * Scanner de secrets et de données personnelles (§26, §55).
 *
 * Le dépôt est PUBLIC. Ce script est le dernier filet avant qu'un secret ou une
 * donnée personnelle ne devienne définitivement consultable — un commit poussé
 * puis supprimé reste accessible dans l'historique et les caches.
 *
 * Il est volontairement conservateur : mieux vaut un faux positif à annoter
 * qu'une fuite. Pour autoriser une occurrence légitime, ajoutez le commentaire
 * `secret-scan-ignore` sur la même ligne, ou étendez ALLOWED_PATTERNS.
 *
 * Usage :
 *   node scripts/check-secrets.mjs
 *   node scripts/check-secrets.mjs --staged   (fichiers indexés uniquement)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { extname, join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/** Répertoires jamais analysés. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-local',
  'build',
  'coverage',
  '.wrangler',
  'playwright-report',
  'test-results',
  '.pnpm-store',
  'dist-types',
  // Données locales collectées (captures, base) : ignorées par git, jamais
  // committées, mais contiennent de vraies coordonnées d'annonces. Rien à y
  // scanner puisqu'elles ne peuvent pas fuiter dans le dépôt (§26).
  'data',
]);

/** Extensions analysées. Le binaire n'a pas à être scanné. */
const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.html',
  '.css',
  '.sql',
  '.toml',
  '.txt',
  '.sh',
  '',
]);

/**
 * Fichiers exemptés.
 *
 * - le scanner lui-même contient tous les motifs par construction ;
 * - `pnpm-lock.yaml` est généré et contient les e-mails des mainteneurs des
 *   dépendances, qui ne sont ni des secrets ni nos données personnelles.
 */
const EXEMPT_FILES = new Set([
  join('scripts', 'check-secrets.mjs'),
  '.gitignore',
  'pnpm-lock.yaml',
]);

/**
 * Motifs recherchés.
 * `severity: 'error'` fait échouer la CI ; `'warn'` informe seulement.
 */
const RULES = [
  {
    id: 'jwt',
    label: 'Jeton JWT (format des tokens Turso)',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    severity: 'error',
  },
  {
    id: 'turso-url',
    label: 'URL de base Turso renseignée',
    pattern: /libsql:\/\/(?!example)[a-z0-9-]+\.turso\.io/gi,
    severity: 'error',
  },
  {
    id: 'aws-key',
    label: 'Clé d’accès AWS',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: 'error',
  },
  {
    id: 'google-api-key',
    // Ces clés-là ne sont pas les nôtres : elles arrivent dans les FIXTURES,
    // capturées avec la page d'un site qui expose la sienne dans son HTML.
    // Republier la clé d'un tiers dans un dépôt public est à éviter — et
    // GitHub alerte dessus. La détection nous évite de le découvrir après coup.
    label: 'Clé d’API Google (souvent celle d’un tiers, via une fixture)',
    pattern: /\bAIza(?!-)[0-9A-Za-z_-]{20,}/g,
    severity: 'error',
  },
  {
    id: 'github-token',
    label: 'Jeton GitHub',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    severity: 'error',
  },
  {
    id: 'private-key',
    label: 'Clé privée',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    severity: 'error',
  },
  {
    id: 'assigned-secret',
    label: 'Affectation d’un secret en clair',
    // Repère `TOKEN = "valeur"` mais tolère les placeholders et les variables.
    pattern:
      /\b(?:api[_-]?key|auth[_-]?token|access[_-]?token|secret|password|passwd)\b\s*[:=]\s*['"`]([^'"`\s]{12,})['"`]/gi,
    severity: 'error',
  },
  {
    id: 'real-email',
    label: 'Adresse e-mail personnelle',
    // Les domaines de test (example.invalid, example.com) sont autorisés.
    pattern:
      /\b[\w.+-]+@(?!example\.(?:invalid|com|org|net)\b)(?!.*\.(?:invalid|example)\b)[\w-]+\.[a-z]{2,}\b/gi,
    severity: 'error',
  },
  {
    id: 'french-phone',
    label: 'Numéro de téléphone français',
    // La plage 06 00 00 00 xx est réservée aux exemples du projet.
    pattern: /\b(?:\+33|0033|0)\s?[1-9](?:[\s.-]?\d{2}){4}\b/g,
    severity: 'error',
  },
];

/**
 * Valeurs explicitement autorisées, malgré un motif déclenché.
 *
 * La plage `06 00 00 00 xx` est la convention du projet pour les numéros
 * fictifs — voir tests/fixtures/README.md. Un vrai numéro n'a statistiquement
 * aucune chance de commencer par six zéros consécutifs.
 */
const ALLOWED_VALUES = [
  /^(?:\+33|0033|0)6?0{5,}/,
  /remplacer/i,
  /example/i,
  /fictif|fictive/i,
  /votre[_-]/i,
  /^x{4,}$/i,
  /EXEMPLE/,
];

/**
 * Une valeur est autorisée si elle correspond telle quelle OU une fois
 * débarrassée de ses séparateurs — « 06 00 00 00 12 » et « 06.00.00.00.12 »
 * désignent le même numéro fictif.
 */
const isAllowedValue = (value) => {
  const compact = value.replace(/[\s.-]/g, '');
  return ALLOWED_VALUES.some((pattern) => pattern.test(value) || pattern.test(compact));
};

function listFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) files.push(...listFiles(fullPath));
    else if (SCANNED_EXTENSIONS.has(extname(entry))) files.push(fullPath);
  }
  return files;
}

function listStagedFiles() {
  const output = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && SCANNED_EXTENSIONS.has(extname(line)))
    .map((line) => join(ROOT, line.split('/').join(sep)));
}

/**
 * Fichiers de secrets LOCAUX (`.env`, `.env.local`, …) : gitignorés par
 * convention, ils ne peuvent pas être committés et contiennent de VRAIES
 * valeurs par nature — les scanner ne ferait que produire des faux positifs
 * (même logique que le dossier `data/`). Seul `.env.example`, versionné et
 * uniquement fictif, reste analysé.
 */
function isLocalSecretFile(relativePath) {
  const base = relativePath.split(sep).pop() ?? '';
  return (base === '.env' || base.startsWith('.env.')) && base !== '.env.example';
}

function scanFile(filePath) {
  const relativePath = relative(ROOT, filePath);
  if (EXEMPT_FILES.has(relativePath) || isLocalSecretFile(relativePath)) return [];

  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const findings = [];
  const lines = content.split('\n');

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(content)) !== null) {
      const value = match[1] ?? match[0];
      if (isAllowedValue(value)) continue;

      const lineNumber = content.slice(0, match.index).split('\n').length;
      const line = lines[lineNumber - 1] ?? '';
      // Échappatoire explicite pour les cas légitimes.
      if (line.includes('secret-scan-ignore')) continue;

      findings.push({
        file: relativePath,
        line: lineNumber,
        rule: rule.id,
        label: rule.label,
        severity: rule.severity,
        // On n'imprime JAMAIS la valeur complète : le journal de CI est public.
        excerpt: `${value.slice(0, 6)}…`,
      });
    }
  }

  return findings;
}

function main() {
  const staged = process.argv.includes('--staged');
  const files = staged ? listStagedFiles() : listFiles(ROOT);

  const findings = files.flatMap(scanFile);
  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warn');

  for (const finding of warnings) {
    console.warn(
      `  avertissement  ${finding.file}:${finding.line}  ${finding.label} (${finding.excerpt})`,
    );
  }

  if (errors.length === 0) {
    console.log(`Analyse de ${files.length} fichiers : aucun secret détecté.`);
    if (warnings.length > 0) console.log(`${warnings.length} avertissement(s).`);
    return;
  }

  console.error('\nSECRETS OU DONNÉES PERSONNELLES DÉTECTÉS — commit interdit :\n');
  for (const finding of errors) {
    console.error(`  ${finding.file}:${finding.line}`);
    console.error(`    ${finding.label} — ${finding.excerpt}`);
  }
  console.error(
    '\nSi une occurrence est légitime, ajoutez `secret-scan-ignore` en fin de ligne,\n' +
      'ou utilisez une valeur d’exemple (domaine example.invalid, téléphone 06 00 00 00 xx).\n' +
      'Voir docs/privacy.md.\n',
  );
  process.exit(1);
}

main();
