// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-local/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
      /**
       * §75 : garde-fous contre les fonctions monolithiques.
       *
       * Le seuil de complexité est fixé à 25 et non à 10 : les moteurs de
       * scoring et de similarité sont des SUITES DE RÈGLES INDÉPENDANTES
       * (« si le prix est bas, +40 ; si l'agence est identifiée, +0 … »).
       * Leur complexité cyclomatique est mécaniquement élevée alors que
       * chaque branche est triviale et se lit isolément. Un seuil bas y
       * pousserait à un découpage artificiel qui nuirait à la lisibilité.
       * `max-depth` reste bas : c'est l'imbrication, pas le nombre de
       * branches, qui rend un code réellement difficile à suivre.
       */
      complexity: ['warn', 25],
      'max-depth': ['warn', 4],
    },
  },

  // Le frontend tourne dans le navigateur, pas dans Node.
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Le Worker Cloudflare a ses propres globals.
  {
    files: ['packages/api/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
  },

  prettier,
);
