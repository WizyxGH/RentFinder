/**
 * Le magasin de pièces, adossé au stockage clé-valeur des Workers (§25, §28).
 *
 * POURQUOI KV ET NON R2. R2 est le stockage de fichiers naturel de Cloudflare,
 * et le premier choix de ce projet. Mais il exige d'enregistrer une carte
 * bancaire avant de créer le moindre seau, y compris pour son propre palier
 * gratuit : déployer imposait donc de donner des coordonnées bancaires pour une
 * fonctionnalité annexe. KV est inclus dans le plan gratuit des Workers, sans
 * carte.
 *
 * CE QUE ÇA COÛTE EN CONTREPARTIE, et qu'il faut savoir :
 *
 *   - KV est ÉVENTUELLEMENT COHÉRENT. Une pièce tout juste déposée peut ne pas
 *     figurer dans la liste pendant quelques secondes. L'écran ajoute donc la
 *     pièce à sa liste sans attendre de relire — ce qu'il faisait déjà.
 *   - mille écritures par jour. Un dossier se dépose une fois et se complète
 *     rarement : on est à deux ordres de grandeur de la limite.
 *   - vingt-cinq méga-octets par valeur, contre dix imposés par ce module.
 *
 * LA TAILLE ET LE TYPE VIVENT DANS LES MÉTADONNÉES, parce que KV ne les connaît
 * pas de lui-même : il ne stocke que des octets. Sans elles, dresser la liste
 * demanderait de TÉLÉCHARGER chaque pièce pour en mesurer le poids.
 */

import type { DocumentStore, StoredMeta } from './documents.js';

/** Ce que ce module utilise d'un espace KV. Décrit ici, donc testable. */
export interface KeyValueNamespace {
  list(options: {
    prefix: string;
  }): Promise<{ keys: readonly { name: string; metadata?: unknown }[] }>;
  put(key: string, value: ArrayBuffer, options?: { metadata?: unknown }): Promise<void>;
  getWithMetadata(
    key: string,
    type: 'arrayBuffer',
  ): Promise<{ value: ArrayBuffer | null; metadata: unknown }>;
  delete(key: string): Promise<void>;
}

/**
 * Relit des métadonnées sans rien supposer.
 *
 * Une pièce déposée par une version antérieure peut n'en avoir aucune, ou des
 * incomplètes. On rend alors des valeurs neutres plutôt que de faire tomber la
 * liste entière pour une entrée abîmée (§69).
 */
function readMeta(raw: unknown): StoredMeta {
  const node = (raw ?? {}) as Record<string, unknown>;
  return {
    contentType:
      typeof node['contentType'] === 'string' ? node['contentType'] : 'application/octet-stream',
    size: typeof node['size'] === 'number' ? node['size'] : 0,
    uploadedAt:
      typeof node['uploadedAt'] === 'string' ? node['uploadedAt'] : new Date(0).toISOString(),
  };
}

/** Adapte un espace KV à l'interface que le module des pièces attend. */
export function kvDocumentStore(namespace: KeyValueNamespace): DocumentStore {
  return {
    async list(prefix) {
      const listed = await namespace.list({ prefix });
      return listed.keys.map((key) => ({ key: key.name, meta: readMeta(key.metadata) }));
    },

    async put(key, bytes, meta) {
      await namespace.put(key, bytes, { metadata: meta });
    },

    async get(key) {
      const { value, metadata } = await namespace.getWithMetadata(key, 'arrayBuffer');
      return value === null ? null : { body: value, meta: readMeta(metadata) };
    },

    async delete(key) {
      await namespace.delete(key);
    },
  };
}
