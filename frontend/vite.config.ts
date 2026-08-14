import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Le site est publié sur GitHub Pages, servi depuis `/<repo>/`.
 * `BASE_PATH` est fourni par le workflow de déploiement ; en local, la racine
 * suffit.
 */
const base = process.env['BASE_PATH'] ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    // §39 : le frontend doit rester léger. Un dépassement signale une
    // dépendance lourde ajoutée sans y penser.
    chunkSizeWarningLimit: 300,
    sourcemap: false,
  },
});
