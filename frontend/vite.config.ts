import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Le site est publié sur GitHub Pages, servi depuis `/<repo>/`.
 * `BASE_PATH` est fourni par le workflow de déploiement ; en local, la racine
 * suffit.
 */
const base = process.env['BASE_PATH'] ?? '/';

export default defineConfig(({ mode }) => {
  /**
   * Mode `selfhost` : build destiné au serveur local du mode zéro-cloud
   * (`pnpm local`). L'API est servie par la même origine (`/`), aucun jeton
   * n'est demandé — le serveur n'écoute que sur 127.0.0.1. La sortie va dans
   * `dist-local` pour ne jamais être confondue avec le bundle GitHub Pages.
   */
  const selfhost = mode === 'selfhost';

  return {
    base: selfhost ? '/' : base,
    plugins: [react(), tailwindcss()],
    resolve: {
      // Alias shadcn/ui standard — permet `npx shadcn add <composant>`.
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    define: {
      // Figé à la compilation : dans un build applicatif, `__DEMO__` vaut
      // `false`, la branche des données fictives devient du code mort et le
      // fichier `mock-data.ts` n'entre pas dans le bundle. Seuls les tests, qui
      // ne passent pas par ce build, le chargent.
      __DEMO__: JSON.stringify(process.env['VITE_DEMO'] === 'true'),
      ...(selfhost ? { 'import.meta.env.VITE_API_URL': JSON.stringify('/') } : {}),
    },
    build: {
      // §39 : le frontend doit rester léger. Un dépassement signale une
      // dépendance lourde ajoutée sans y penser.
      chunkSizeWarningLimit: 300,
      sourcemap: false,
      ...(selfhost ? { outDir: 'dist-local' } : {}),
    },
  };
});
