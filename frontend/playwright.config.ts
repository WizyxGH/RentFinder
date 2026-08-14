import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration Playwright (§53, §54).
 *
 * Les scénarios tournent en MODE DÉMONSTRATION : `VITE_API_URL` n'est pas
 * défini, donc l'application utilise les données fictives. Aucun accès réseau,
 * aucune base, aucun secret — les tests sont reproductibles partout (§59).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['html'], ['github']] : 'list',

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },

  projects: [
    // Mobile d'abord : c'est le contexte d'usage réel de l'outil (§36).
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    // `--host 127.0.0.1` est indispensable : sans lui, `vite preview` écoute
    // sur `localhost`, que Node ≥ 17 peut résoudre en IPv6 (::1) sous Windows,
    // tandis que Playwright interroge l'IPv4 — le démarrage semble alors ne
    // jamais aboutir.
    command: 'pnpm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
