/**
 * Le nom d'une pièce vient du navigateur, donc de l'utilisateur.
 *
 * C'est le SEUL endroit qui empêche une clé de sortir du préfixe de son compte
 * (`<utilisateur>/<fichier>`) : un nom contenant « ../ » qui passerait ici
 * donnerait accès aux pièces d'un autre. D'où des tests sur les cas tordus
 * plutôt que sur le cas nominal.
 */

import { describe, expect, it } from 'vitest';
import {
  deleteDocument,
  listDocuments,
  readDocument,
  sanitizeDocumentName,
  saveDocument,
  type DocumentStore,
  type StoredMeta,
} from './documents.js';

describe('sanitizeDocumentName', () => {
  it('garde un nom ordinaire tel quel', () => {
    expect(sanitizeDocumentName('bulletin de paie (mars).pdf')).toBe('bulletin de paie (mars).pdf');
  });

  it('ne garde que le dernier composant du chemin', () => {
    expect(sanitizeDocumentName('../../autre/piece.pdf')).toBe('piece.pdf');
    expect(sanitizeDocumentName('C:\\Users\\moi\\avis.pdf')).toBe('avis.pdf');
    expect(sanitizeDocumentName('..\\..\\voisin\\identite.png')).toBe('identite.png');
  });

  it('ne laisse subsister ni séparateur ni suite de points', () => {
    const name = sanitizeDocumentName('a..b/c.pdf');
    expect(name).not.toBeNull();
    expect(name).not.toContain('..');
    expect(name).not.toMatch(/[/\\]/);
  });

  it("refuse une extension qu'on ne saurait pas servir", () => {
    expect(sanitizeDocumentName('script.html')).toBeNull();
    expect(sanitizeDocumentName('bail.docx')).toBeNull();
    expect(sanitizeDocumentName('sans-extension')).toBeNull();
  });

  it('refuse la double extension dont seule la dernière compte', () => {
    // `.pdf.html` finit en html : c'est bien ce qui serait servi.
    expect(sanitizeDocumentName('piece.pdf.html')).toBeNull();
    expect(sanitizeDocumentName('piece.html.pdf')).toBe('piece.html.pdf');
  });

  it('refuse ce qui ne laisse rien après nettoyage', () => {
    expect(sanitizeDocumentName('')).toBeNull();
    expect(sanitizeDocumentName('...')).toBeNull();
    expect(sanitizeDocumentName('   ')).toBeNull();
    expect(sanitizeDocumentName('/')).toBeNull();
  });

  it('accepte les accents et refuse le reste', () => {
    expect(sanitizeDocumentName('identité.jpg')).toBe('identité.jpg');
    expect(sanitizeDocumentName('avis<script>.png')).toBe('avis_script_.png');
  });

  it("borne la longueur sans perdre l'extension", () => {
    const long = `${'a'.repeat(300)}.pdf`;
    const name = sanitizeDocumentName(long);
    expect(name).not.toBeNull();
    expect(name?.length).toBeLessThanOrEqual(120);
  });
});

/**
 * Un seau en mémoire. Il ne cherche pas à imiter R2, seulement à retenir ce
 * qu'on lui donne : ce qui compte ici est la CLÉ écrite, puisque c'est elle
 * qui sépare les comptes.
 */
function fakeStore(): DocumentStore & { readonly keys: () => string[] } {
  const entries = new Map<string, { bytes: ArrayBuffer; meta: StoredMeta }>();
  return {
    keys: () => [...entries.keys()],
    list: (prefix) =>
      Promise.resolve(
        [...entries.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ key, meta: value.meta })),
      ),
    put: (key, bytes, meta) => {
      entries.set(key, { bytes, meta });
      return Promise.resolve();
    },
    get: (key) => {
      const found = entries.get(key);
      return Promise.resolve(found === undefined ? null : { body: found.bytes, meta: found.meta });
    },
    delete: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
  };
}

const bytes = (length: number): ArrayBuffer => new ArrayBuffer(length);

describe('saveDocument', () => {
  it("range la pièce sous le compte de qui l'a déposée", async () => {
    const store = fakeStore();
    const saved = await saveDocument(store, 'moi', 'paie.pdf', bytes(1024));

    expect(saved.ok).toBe(true);
    expect(store.keys()).toEqual(['moi/paie.pdf']);
  });

  it('ne laisse pas un nom sortir du préfixe de son compte', async () => {
    const store = fakeStore();
    await saveDocument(store, 'moi', '../voisin/paie.pdf', bytes(10));

    expect(store.keys()).toEqual(['moi/paie.pdf']);
  });

  it('refuse le fichier vide et le fichier trop lourd, sans rien écrire', async () => {
    const store = fakeStore();
    const empty = await saveDocument(store, 'moi', 'paie.pdf', bytes(0));
    const heavy = await saveDocument(store, 'moi', 'paie.pdf', bytes(11 * 1024 * 1024));

    expect(empty.ok).toBe(false);
    expect(heavy.ok).toBe(false);
    expect(store.keys()).toEqual([]);
  });
});

describe('listDocuments', () => {
  it('ne montre que les pièces du compte, et rend le nom sans son préfixe', async () => {
    const store = fakeStore();
    await saveDocument(store, 'moi', 'paie.pdf', bytes(10));
    await saveDocument(store, 'moi', 'identite.png', bytes(20));
    await saveDocument(store, 'toi', 'secret.pdf', bytes(30));

    const mine = await listDocuments(store, 'moi');

    expect(mine.map((doc) => doc.name).sort()).toEqual(['identite.png', 'paie.pdf']);
  });
});

describe('readDocument', () => {
  it('sert la pièce du bon compte, en lecture privée', async () => {
    const store = fakeStore();
    await saveDocument(store, 'moi', 'paie.pdf', bytes(64));

    const response = await readDocument(store, 'moi', 'paie.pdf');

    expect(response?.headers.get('Content-Type')).toBe('application/pdf');
    expect(response?.headers.get('Cache-Control')).toContain('private');
  });

  it("ne sert pas la pièce d'un autre compte", async () => {
    const store = fakeStore();
    await saveDocument(store, 'toi', 'paie.pdf', bytes(64));

    expect(await readDocument(store, 'moi', 'paie.pdf')).toBeNull();
    expect(await readDocument(store, 'moi', '../toi/paie.pdf')).toBeNull();
  });
});

describe('deleteDocument', () => {
  it('ne supprime que dans le préfixe de son compte', async () => {
    const store = fakeStore();
    await saveDocument(store, 'toi', 'paie.pdf', bytes(10));

    await deleteDocument(store, 'moi', '../toi/paie.pdf');

    expect(store.keys()).toEqual(['toi/paie.pdf']);
  });
});
