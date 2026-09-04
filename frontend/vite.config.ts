import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** GitHub Pages sert depuis `/<repo>/` ; `BASE_PATH` vient du workflow. */
const base = process.env['BASE_PATH'] ?? '/';

export default defineConfig(() => {
  return {
    base,
    plugins: [react(), tailwindcss()],
    resolve: {
      // Alias shadcn/ui standard — permet `npx shadcn add <composant>`.
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    define: {
      // Figé à la compilation : `false` rend les branches de démonstration
      // mortes, donc `mock-data.ts` n'entre pas dans le bundle.
      __DEMO__: JSON.stringify(process.env['VITE_DEMO'] === 'true'),
      // Clé PUBLIQUE du serveur de push : ce n'est pas un secret, elle doit
      // se retrouver dans le bundle pour que le navigateur puisse s'abonner.
      'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify(
        process.env['VAPID_PUBLIC_KEY'] ?? '',
      ),
    },
    build: {
      // §39 : le frontend doit rester léger. Un dépassement signale une
      // dépendance lourde ajoutée sans y penser.
      chunkSizeWarningLimit: 300,
      sourcemap: false,
    },
  };
});
