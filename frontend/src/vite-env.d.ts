/// <reference types="vite/client" />

/**
 * Variables d'environnement injectées à la compilation.
 *
 * ATTENTION : tout ce qui est préfixé `VITE_` est INLINÉ dans le bundle
 * JavaScript publié sur GitHub Pages, donc publiquement lisible. N'y placer
 * jamais un jeton, une clé ou une URL de base (§26).
 *
 * Le jeton d'accès à l'API est saisi par l'utilisateur et conservé dans
 * `localStorage` — voir `src/api/client.ts`.
 */
interface ImportMetaEnv {
  /** URL publique du Worker Cloudflare. Vide = mode démonstration. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
