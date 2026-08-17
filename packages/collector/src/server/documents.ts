/**
 * Documents de candidature (§25, §26).
 *
 * L'utilisateur dépose UNE FOIS ses pièces (CNI, bulletins de salaire, avis
 * d'imposition, garant…) depuis l'onglet Profil ; elles sont conservées pour
 * préparer ses dossiers de candidature.
 *
 * CONFINEMENT — trois garanties, toutes structurelles :
 *   1. Les fichiers vivent dans `data/documents/`, répertoire ignoré par git
 *      (`data/` est dans .gitignore) : ils ne peuvent PAS finir dans le dépôt
 *      public.
 *   2. Ils ne sont servis QUE par le serveur local, qui n'écoute que sur
 *      127.0.0.1 : aucune exposition réseau.
 *   3. RIEN n'est jamais envoyé automatiquement à qui que ce soit (§24) : ce
 *      module ne fait que stocker, lister, restituer et supprimer.
 *
 * Les noms de fichiers sont assainis (pas de traversée de chemin) et le
 * contenu est plafonné en taille et en nombre.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** data/documents/ à la racine du dépôt — data/ est gitignoré (§26). */
const DOCUMENTS_DIR = fileURLToPath(new URL('../../../../data/documents/', import.meta.url));

/** Extensions acceptées : pièces d'un dossier de location, rien d'exécutable. */
const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'doc', 'docx']);

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 Mo par pièce
const MAX_FILES = 40;

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export interface DocumentInfo {
  readonly name: string;
  readonly size: number;
  readonly uploadedAt: string;
}

/**
 * Assainit un nom de fichier : composant unique (aucun séparateur de chemin),
 * caractères sûrs, extension autorisée. `null` si irrécupérable.
 */
export function sanitizeDocumentName(input: string): string | null {
  // Dernier composant seulement — neutralise toute tentative de traversée.
  const base = input.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120);
  if (cleaned === '') return null;

  const extension = cleaned.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(extension)) return null;
  return cleaned;
}

function ensureDir(): void {
  mkdirSync(DOCUMENTS_DIR, { recursive: true });
}

export function listDocuments(): DocumentInfo[] {
  ensureDir();
  return readdirSync(DOCUMENTS_DIR)
    .filter((name) => sanitizeDocumentName(name) === name)
    .map((name) => {
      const stats = statSync(join(DOCUMENTS_DIR, name));
      return { name, size: stats.size, uploadedAt: stats.mtime.toISOString() };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type SaveResult =
  | { readonly ok: true; readonly document: DocumentInfo }
  | { readonly ok: false; readonly error: string };

export function saveDocument(rawName: string, bytes: Uint8Array): SaveResult {
  const name = sanitizeDocumentName(rawName);
  if (name === null) {
    return {
      ok: false,
      error: 'Nom de fichier invalide (formats acceptés : PDF, JPG, PNG, WEBP, HEIC, DOC, DOCX)',
    };
  }
  if (bytes.byteLength === 0) return { ok: false, error: 'Fichier vide' };
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return { ok: false, error: 'Fichier trop volumineux (20 Mo maximum)' };
  }
  ensureDir();
  const existing = listDocuments();
  if (existing.length >= MAX_FILES && !existing.some((doc) => doc.name === name)) {
    return { ok: false, error: `Trop de documents (${MAX_FILES} maximum)` };
  }

  writeFileSync(join(DOCUMENTS_DIR, name), bytes);
  const stats = statSync(join(DOCUMENTS_DIR, name));
  return { ok: true, document: { name, size: stats.size, uploadedAt: stats.mtime.toISOString() } };
}

/** Restitue un document (nom déjà assaini). `null` si absent. */
export function readDocument(rawName: string): { bytes: Buffer; contentType: string } | null {
  const name = sanitizeDocumentName(rawName);
  if (name === null) return null;
  try {
    const bytes = readFileSync(join(DOCUMENTS_DIR, name));
    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    return { bytes, contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

export function deleteDocument(rawName: string): boolean {
  const name = sanitizeDocumentName(rawName);
  if (name === null) return false;
  try {
    unlinkSync(join(DOCUMENTS_DIR, name));
    return true;
  } catch {
    return false;
  }
}
