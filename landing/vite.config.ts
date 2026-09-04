/**
 * Site de présentation de Maïoun.
 *
 * SÉPARÉ DE L'APPLICATION, et c'est le but : la web app rejoindra un
 * sous-domaine, cette page restera à la racine. Deux publics, deux rythmes de
 * publication, deux poids — un visiteur qui découvre le projet n'a aucune
 * raison de télécharger React, Leaflet et quarante écrans.
 *
 * AUCUN JAVASCRIPT APPLICATIF. Ce que fait cette page — lire, dérouler, cliquer
 * un lien — le HTML le fait seul. Vite ne sert qu'à compiler la feuille de
 * style Tailwind et à empreindre les fichiers.
 */

import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: process.env['BASE_PATH'] ?? '/',
  plugins: [tailwindcss()],
  build: { sourcemap: false },
});
