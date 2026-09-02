import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** GitHub Pages sert depuis `/<repo>/` ; `BASE_PATH` vient du workflow. */
const base = process.env['BASE_PATH'] ?? '/';

export default defineConfig(({ mode }) => {
  // Mode `selfhost` : build du serveur local (`pnpm local`). API sur la même
  // origine, sans jeton — il n'écoute que sur 127.0.0.1. Sortie séparée.
  const selfhost = mode === 'selfhost';

  return {
    base: selfhost ? '/' : base,
    plugins: [react(), tailwindcss()],
    resolve: {
      // Alias shadcn/ui standard — permet `npx shadcn add <composant>`.
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    define: {
      // Figé à la compilation : `false` rend les branches de démonstration
      // mortes, donc `mock-data.ts` n'entre pas dans le bundle.
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
