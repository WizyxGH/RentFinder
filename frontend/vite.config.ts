import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** GitHub Pages sert depuis `/<repo>/` ; `BASE_PATH` vient du workflow. */
const base = process.env['BASE_PATH'] ?? '/';

/**
 * Le repli des adresses profondes sur GitHub Pages.
 *
 * Pages sert des fichiers : il ne connaît que `index.html`. Ouvrir
 * `/annonce/seloger:123` — un lien collé, un favori, un rafraîchissement —
 * tomberait donc sur une 404, alors que l'application sait très bien afficher
 * cette adresse. Pages sert `404.html` pour tout chemin inconnu : en y mettant
 * la même page, le routeur reprend la main côté navigateur.
 */
function pagesDeepLinkFallback(): Plugin {
  return {
    name: 'rf-404-fallback',
    apply: 'build',
    // `writeBundle` et non `generateBundle` : la page d'entrée est écrite par
    // le greffon HTML de Vite, après la constitution du bundle — à l'étape
    // précédente, elle n'y figure pas encore.
    writeBundle(options) {
      const dir = options.dir ?? 'dist';
      copyFileSync(join(dir, 'index.html'), join(dir, '404.html'));
    },
  };
}

export default defineConfig(() => {
  return {
    base,
    plugins: [react(), tailwindcss(), pagesDeepLinkFallback()],
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
