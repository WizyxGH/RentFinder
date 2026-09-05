/**
 * Pièces du dossier de candidature (§25), hébergées dans R2.
 *
 * ELLES ÉTAIENT SUR UN DISQUE, ce qui condamnait la fonctionnalité le jour où
 * le serveur local a été retiré : une page hébergée ne peut pas lire votre
 * ordinateur. Elles vivent maintenant à côté de l'API — ce qui les rend surtout
 * ATTEIGNABLES DEPUIS LE TÉLÉPHONE, et donc joignables à une candidature
 * envoyée d'où que ce soit.
 *
 * DANS KV, ET NON DANS R2, POUR UNE RAISON DE FACTURATION. R2 est le stockage
 * de fichiers naturel de Cloudflare, mais il exige d'enregistrer une carte
 * bancaire avant de créer le moindre seau — y compris pour son palier gratuit.
 * KV est inclus dans le plan gratuit des Workers, sans carte : 1 Go, cent mille
 * lectures et mille écritures par jour, vingt-cinq méga-octets par valeur. Un
 * dossier de candidature en compte une dizaine de dix méga-octets au plus : on
 * est à deux ordres de grandeur des limites.
 *
 * CHACUN LES SIENNES. La clé est préfixée par l'identifiant du compte :
 * `<utilisateur>/<nom de fichier>`. Un dossier de candidature contient une
 * fiche de paie et une pièce d'identité — il n'y a pas de pièces « communes ».
 *
 * RIEN N'EST ENVOYÉ AUTOMATIQUEMENT (§24). Ce module stocke, liste, rend et
 * supprime ; c'est vous qui décidez de joindre.
 */

/** Ce qu'on sait d'une pièce sans la lire : de quoi dresser la liste. */
export interface StoredMeta {
  readonly contentType: string;
  readonly size: number;
  readonly uploadedAt: string;
}

/**
 * Les quatre opérations dont ce module a besoin, et rien de plus.
 *
 * NEUTRE VIS-À-VIS DU STOCKAGE, volontairement. La première version épousait
 * la forme de R2 ; passer à KV aurait alors demandé de réécrire chaque
 * fonction. Décrite ainsi, la bascule n'a touché qu'un adaptateur de trente
 * lignes — et le jour où le stockage changera encore, ce sera pareil.
 *
 * Le module se teste avec un faux magasin, sans quoi rien de ce fichier ne
 * serait couvert. L'adaptateur réel, lui, est vérifié par TypeScript à
 * l'endroit où `index.ts` le construit.
 */
export interface DocumentStore {
  list(prefix: string): Promise<readonly { key: string; meta: StoredMeta }[]>;
  put(key: string, bytes: ArrayBuffer, meta: StoredMeta): Promise<void>;
  get(key: string): Promise<{ body: ArrayBuffer; meta: StoredMeta | null } | null>;
  delete(key: string): Promise<void>;
}

/** Ce qu'on accepte de recevoir. Tout le reste est refusé sans discuter. */
const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic']);

/** Longueur maximale d'un nom de fichier, extension comprise. */
const MAX_NAME_LENGTH = 120;

/** Dix méga-octets : une fiche de paie scannée en pèse un ou deux. */
const MAX_BYTES = 10 * 1024 * 1024;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

/**
 * Nettoie un nom de fichier, ou refuse.
 *
 * Le nom vient du navigateur, donc de l'utilisateur, donc potentiellement de
 * n'importe où. On ne garde que le DERNIER composant — un « ../ » ne peut donc
 * pas remonter — et seulement des caractères de nom de fichier. L'extension
 * doit être connue : c'est elle qui décide du type servi plus tard, et servir
 * un type qu'on n'a pas voulu est une façon classique de faire exécuter du
 * contenu par un navigateur.
 */
export function sanitizeDocumentName(input: string): string | null {
  const base = input.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[. ]+|[. ]+$/g, '');
  if (cleaned === '') return null;

  const extension = cleaned.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(extension)) return null;

  // On raccourcit le NOM, jamais l'extension : une troncature brute la
  // mangeait, et un fichier parfaitement valide se voyait refuser pour un
  // format qu'il avait pourtant.
  const stem = cleaned.slice(0, cleaned.length - extension.length - 1);
  return `${stem.slice(0, MAX_NAME_LENGTH - extension.length - 1)}.${extension}`;
}

function contentTypeOf(name: string): string {
  return CONTENT_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** La clé d'une pièce dans le seau. Le préfixe est ce qui sépare les comptes. */
function keyOf(userId: string, name: string): string {
  return `${userId}/${name}`;
}

export interface DocumentInfo {
  readonly name: string;
  readonly size: number;
  readonly uploadedAt: string;
}

export async function listDocuments(
  store: DocumentStore,
  userId: string,
): Promise<readonly DocumentInfo[]> {
  const prefix = `${userId}/`;
  const entries = await store.list(prefix);
  return entries.map((entry) => ({
    name: entry.key.slice(prefix.length),
    size: entry.meta.size,
    uploadedAt: entry.meta.uploadedAt,
  }));
}

export async function saveDocument(
  store: DocumentStore,
  userId: string,
  rawName: string,
  bytes: ArrayBuffer,
): Promise<{ ok: true; document: DocumentInfo } | { ok: false; error: string }> {
  const name = sanitizeDocumentName(rawName);
  if (name === null) {
    return { ok: false, error: 'Nom de fichier ou format refusé (PDF et images uniquement).' };
  }
  if (bytes.byteLength === 0) return { ok: false, error: 'Fichier vide.' };
  if (bytes.byteLength > MAX_BYTES) return { ok: false, error: 'Fichier trop lourd (10 Mo max).' };

  const meta: StoredMeta = {
    contentType: contentTypeOf(name),
    size: bytes.byteLength,
    uploadedAt: new Date().toISOString(),
  };
  await store.put(keyOf(userId, name), bytes, meta);
  return { ok: true, document: { name, size: meta.size, uploadedAt: meta.uploadedAt } };
}

export async function readDocument(
  store: DocumentStore,
  userId: string,
  rawName: string,
): Promise<Response | null> {
  const name = sanitizeDocumentName(rawName);
  if (name === null) return null;
  const found = await store.get(keyOf(userId, name));
  if (found === null) return null;

  return new Response(found.body, {
    headers: {
      'Content-Type': found.meta?.contentType ?? contentTypeOf(name),
      // `inline` : une fiche de paie se relit d'un coup d'œil avant de la
      // joindre ; forcer le téléchargement obligerait à ouvrir un fichier pour
      // vérifier qu'on a pris le bon.
      'Content-Disposition': `inline; filename="${encodeURIComponent(name)}"`,
      // Ces fichiers ne sont à personne d'autre : aucun cache partagé.
      'Cache-Control': 'private, max-age=60',
    },
  });
}

export async function deleteDocument(
  store: DocumentStore,
  userId: string,
  rawName: string,
): Promise<boolean> {
  const name = sanitizeDocumentName(rawName);
  if (name === null) return false;
  await store.delete(keyOf(userId, name));
  return true;
}
