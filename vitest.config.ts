import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Configuration Vitest racine — couvre les paquets Node (shared, collector, api).
 * Le frontend possède sa propre configuration (environnement jsdom).
 *
 * §59 : les tests doivent être déterministes. Aucun accès réseau n'est autorisé
 * dans la suite ; les scrapers sont testés contre des fixtures locales (§50).
 */
export default defineConfig({
  resolve: {
    // `tests/` n'est pas un paquet du workspace : sans ces alias, ses fichiers
    // ne sauraient pas résoudre les paquets internes. Pointer vers les sources
    // plutôt que vers `dist/` évite aussi de tester un build périmé.
    alias: {
      '@rentfinder/shared': fromRoot('./packages/shared/src/index.ts'),
      '@rentfinder/collector': fromRoot('./packages/collector/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'frontend/**'],
    globals: false,
    // Horloge et aléatoire sont figés au cas par cas dans les tests concernés.
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/types.ts'],
      // §58 : seuils volontairement centrés sur les parties critiques.
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
});
