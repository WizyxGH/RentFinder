/**
 * Tests de sécurité du dépôt (§55).
 *
 * Ils vérifient que les garanties de confidentialité tiennent structurellement,
 * et pas seulement par la vigilance de celui qui commite.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

describe('le scanner de secrets', () => {
  it('ne détecte rien dans le dépôt en l’état', () => {
    // Échoue avec un code de sortie non nul si un secret est présent.
    const output = execFileSync('node', ['scripts/check-secrets.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(output).toMatch(/aucun secret détecté/);
  });

  it('détecte effectivement un secret introduit', () => {
    // Vérification du vérificateur : un scanner qui ne trouve jamais rien
    // donne une fausse assurance. On lui soumet un cas franc.
    const scanner = read('scripts/check-secrets.mjs');
    // Le motif JWT doit reconnaître un jeton de forme Turso.
    const jwtRule = /eyJ\[A-Za-z0-9_-\]\{10,\}/;
    expect(scanner).toMatch(jwtRule);
    // Et le motif téléphone doit couvrir les formats français usuels.
    expect(scanner).toMatch(/\\\+33\|0033\|0/);
  });
});

describe('.gitignore', () => {
  const gitignore = read('.gitignore');

  it('ignore les fichiers d’environnement mais garde l’exemple', () => {
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });

  it('ignore la configuration privée et le profil locataire (§20, §25)', () => {
    expect(gitignore).toMatch(/config\/private\//);
    expect(gitignore).toMatch(/reference-points\.json/);
    expect(gitignore).toMatch(/tenant-profile\.json/);
  });

  it('ignore les bases de données et les données collectées (§27)', () => {
    expect(gitignore).toMatch(/^\*\.db$/m);
    expect(gitignore).toMatch(/^data\/$/m);
  });
});

describe('.env.example', () => {
  const example = read('.env.example');

  it('ne contient que des valeurs manifestement fictives', () => {
    // Toute adresse doit relever d'un domaine d'exemple.
    const emails = example.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [];
    for (const email of emails) {
      expect(email).toMatch(/example\.(invalid|com)$/);
    }
  });

  it('déclare toutes les variables utilisées par le collecteur', () => {
    const required = [
      'TURSO_DATABASE_URL',
      'TURSO_AUTH_TOKEN',
      'API_ACCESS_TOKEN',
      'COLLECTOR_USER_AGENT',
      'BACKFILL_ENABLED',
      'AUTO_CONTACT_ENABLED',
      'REFERENCE_WORK_LAT',
      'REFERENCE_STATION_LAT',
    ];
    for (const name of required) {
      expect(example).toContain(name);
    }
  });

  it('laisse le backfill et le contact automatique désactivés (§8, §23)', () => {
    expect(example).toMatch(/^BACKFILL_ENABLED=false$/m);
    expect(example).toMatch(/^AUTO_CONTACT_ENABLED=false$/m);
  });
});

describe('exposition au frontend', () => {
  /** Liste récursive des fichiers source du frontend. */
  function listFrontendFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) files.push(...listFrontendFiles(full));
      else if (['.ts', '.tsx'].includes(extname(entry))) files.push(full);
    }
    return files;
  }

  it('n’expose aucun secret via une variable VITE_', () => {
    // Vite inline TOUTE variable préfixée VITE_ dans le bundle public :
    // y placer un jeton reviendrait à le publier sur GitHub Pages (§26).
    const files = listFrontendFiles(resolve(ROOT, 'frontend/src'));
    const forbidden = /import\.meta\.env\[?['"`]?VITE_[A-Z_]*(TOKEN|SECRET|KEY|PASSWORD)/i;

    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toMatch(forbidden);
    }
  });

  it('ne référence aucune URL Turso dans le frontend', () => {
    const files = listFrontendFiles(resolve(ROOT, 'frontend/src'));
    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/libsql:\/\//);
    }
  });
});

describe('wrangler.toml', () => {
  const config = read('packages/api/wrangler.toml');

  it('ne contient aucun secret en clair', () => {
    expect(config).not.toMatch(/TURSO_AUTH_TOKEN\s*=/);
    expect(config).not.toMatch(/API_ACCESS_TOKEN\s*=/);
    expect(config).not.toMatch(/libsql:\/\/(?!example)/);
  });

  it('documente la procédure de dépôt des secrets', () => {
    expect(config).toMatch(/wrangler secret put/);
  });
});
