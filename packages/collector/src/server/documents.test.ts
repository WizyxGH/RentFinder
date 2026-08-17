import { describe, expect, it } from 'vitest';
import { sanitizeDocumentName } from './documents.js';

describe('sanitizeDocumentName', () => {
  it('accepte un nom de pièce ordinaire', () => {
    expect(sanitizeDocumentName('Bulletin salaire juin 2026.pdf')).toBe(
      'Bulletin salaire juin 2026.pdf',
    );
    expect(sanitizeDocumentName('CNI recto-verso.jpg')).toBe('CNI recto-verso.jpg');
  });

  it('neutralise toute traversée de chemin', () => {
    expect(sanitizeDocumentName('../../.env')).toBeNull();
    expect(sanitizeDocumentName('..\\..\\secret.pdf')).toBe('secret.pdf');
    expect(sanitizeDocumentName('/etc/passwd')).toBeNull();
    expect(sanitizeDocumentName('dossier/../../avis.pdf')).toBe('avis.pdf');
  });

  it('refuse les extensions hors dossier de location', () => {
    expect(sanitizeDocumentName('script.exe')).toBeNull();
    expect(sanitizeDocumentName('page.html')).toBeNull();
    expect(sanitizeDocumentName('macro.docm')).toBeNull();
    expect(sanitizeDocumentName('sans-extension')).toBeNull();
  });

  it('remplace les caractères dangereux sans détruire le nom', () => {
    expect(sanitizeDocumentName('avis<script>.pdf')).toBe('avis_script_.pdf');
    expect(sanitizeDocumentName('  .hidden.pdf')).toBe('hidden.pdf');
  });
});
