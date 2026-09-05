/**
 * KV ne connaît que des octets : il ignore la taille et le type de ce qu'on lui
 * confie. Tout repose donc sur les métadonnées — et sur ce qui se passe quand
 * elles manquent, ce qui arrivera aux pièces déposées par une version
 * antérieure.
 */

import { describe, expect, it } from 'vitest';
import { kvDocumentStore, type KeyValueNamespace } from './kv-store.js';

function fakeNamespace(): KeyValueNamespace & { readonly raw: Map<string, unknown> } {
  const store = new Map<string, { value: ArrayBuffer; metadata: unknown }>();
  return {
    raw: store as unknown as Map<string, unknown>,
    list: ({ prefix }) =>
      Promise.resolve({
        keys: [...store.entries()]
          .filter(([name]) => name.startsWith(prefix))
          .map(([name, entry]) => ({ name, metadata: entry.metadata })),
      }),
    put: (key, value, options) => {
      store.set(key, { value, metadata: options?.metadata });
      return Promise.resolve();
    },
    getWithMetadata: (key) => {
      const found = store.get(key);
      return Promise.resolve(
        found === undefined
          ? { value: null, metadata: null }
          : { value: found.value, metadata: found.metadata },
      );
    },
    delete: (key) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
}

const META = { contentType: 'application/pdf', size: 1024, uploadedAt: '2026-09-05T08:00:00.000Z' };

describe('kvDocumentStore', () => {
  it('conserve taille et type dans les métadonnées', async () => {
    // KV ne les connaît pas : sans elles, dresser la liste demanderait de
    // TÉLÉCHARGER chaque pièce pour la peser.
    const store = kvDocumentStore(fakeNamespace());
    await store.put('moi/paie.pdf', new ArrayBuffer(1024), META);

    const listed = await store.list('moi/');
    expect(listed).toEqual([{ key: 'moi/paie.pdf', meta: META }]);
  });

  it('ne liste que le préfixe demandé', async () => {
    const store = kvDocumentStore(fakeNamespace());
    await store.put('moi/paie.pdf', new ArrayBuffer(8), META);
    await store.put('toi/secret.pdf', new ArrayBuffer(8), META);

    expect((await store.list('moi/')).map((e) => e.key)).toEqual(['moi/paie.pdf']);
  });

  it('rend la pièce avec ses métadonnées', async () => {
    const store = kvDocumentStore(fakeNamespace());
    await store.put('moi/paie.pdf', new ArrayBuffer(1024), META);

    const found = await store.get('moi/paie.pdf');
    expect(found?.meta.contentType).toBe('application/pdf');
    expect(found?.body.byteLength).toBe(1024);
  });

  it('survit à des métadonnées absentes ou abîmées', async () => {
    // Une pièce déposée par une version antérieure n'en a aucune. Faire tomber
    // la liste entière pour une entrée abîmée serait pire que l'afficher avec
    // des valeurs neutres (§69).
    const namespace = fakeNamespace();
    await namespace.put('moi/ancienne.pdf', new ArrayBuffer(4));
    const store = kvDocumentStore(namespace);

    const listed = await store.list('moi/');
    expect(listed[0]?.meta).toEqual({
      contentType: 'application/octet-stream',
      size: 0,
      uploadedAt: new Date(0).toISOString(),
    });
  });

  it('rend null pour une pièce absente', async () => {
    const store = kvDocumentStore(fakeNamespace());
    expect(await store.get('moi/inexistante.pdf')).toBeNull();
  });

  it('supprime', async () => {
    const store = kvDocumentStore(fakeNamespace());
    await store.put('moi/paie.pdf', new ArrayBuffer(8), META);
    await store.delete('moi/paie.pdf');
    expect(await store.get('moi/paie.pdf')).toBeNull();
  });
});
