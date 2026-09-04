/**
 * Pièces du dossier de candidature (§25), hébergées dans R2.
 *
 * ELLES ÉTAIENT SUR UN DISQUE, ce qui condamnait la fonctionnalité le jour où
 * le serveur local a été retiré : une page hébergée ne peut pas lire votre
 * ordinateur. Elles vivent maintenant à côté de l'API, dans un espace de
 * fichiers Cloudflare — ce qui les rend surtout ATTEIGNABLES DEPUIS LE
 * TÉLÉPHONE, et donc joignables à une candidature envoyée d'où que ce soit.
 *
 * CHACUN LES SIENNES. La clé est préfixée par l'identifiant du compte :
 * `<utilisateur>/<nom de fichier>`. Un dossier de candidature contient une
 * fiche de paie et une pièce d'identité — il n'y a pas de pièces « communes ».
 *
 * RIEN N'EST ENVOYÉ AUTOMATIQUEMENT (§24). Ce module stocke, liste, rend et
 * supprime ; c'est vous qui décidez de joindre.
 */

/**
 * Ce que ce module utilise VRAIMENT d'un seau R2 : quatre opérations.
 *
 * Le décrire ici plutôt que de dépendre du type ambiant de Cloudflare a deux
 * effets. Le module se teste avec un faux seau — sans quoi rien de ce fichier
 * ne serait couvert. Et il reste vérifié : `index.ts` lui passe le vrai
 * binding, et c'est là que TypeScript contrôle que la forme correspond
 * toujours.
 */
export interface DocumentStore {
  list(options: { prefix: string }): Promise<{
    objects: readonly { key: string; size: number; uploaded: Date }[];
  }>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
  } | null>;
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
  bucket: DocumentStore,
  userId: string,
): Promise<readonly DocumentInfo[]> {
  const prefix = `${userId}/`;
  const listed = await bucket.list({ prefix });
  return listed.objects.map((object) => ({
    name: object.key.slice(prefix.length),
    size: object.size,
    uploadedAt: object.uploaded.toISOString(),
  }));
}

export async function saveDocument(
  bucket: DocumentStore,
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

  await bucket.put(keyOf(userId, name), bytes, {
    httpMetadata: { contentType: contentTypeOf(name) },
  });
  return {
    ok: true,
    document: { name, size: bytes.byteLength, uploadedAt: new Date().toISOString() },
  };
}

export async function readDocument(
  bucket: DocumentStore,
  userId: string,
  rawName: string,
): Promise<Response | null> {
  const name = sanitizeDocumentName(rawName);
  if (name === null) return null;
  const object = await bucket.get(keyOf(userId, name));
  if (object === null) return null;

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? contentTypeOf(name),
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
  bucket: DocumentStore,
  userId: string,
  rawName: string,
): Promise<boolean> {
  const name = sanitizeDocumentName(rawName);
  if (name === null) return false;
  await bucket.delete(keyOf(userId, name));
  return true;
}
