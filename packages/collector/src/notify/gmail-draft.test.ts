import { describe, expect, it } from 'vitest';
import {
  buildDraftMime,
  encodeHeader,
  toHtmlBody,
  createGmailDrafts,
  type DraftImapLike,
} from './gmail-draft.js';

describe('toHtmlBody', () => {
  const url = 'https://exemple.invalid/annonce/1';

  it('hyperlie « Votre annonce » et retire le pied « Lien de l’annonce »', () => {
    const plain = 'Bonjour,\n\nVotre annonce m’intéresse.\n\nLien de l’annonce : ' + url;
    const html = toHtmlBody(plain, url);
    expect(html).toContain(`<a href="${url}">Votre annonce</a>`);
    // Le lien n'est pas dupliqué en pied.
    expect(html).not.toContain('Lien de l’annonce');
  });

  it('à défaut de « Votre annonce », ajoute le lien en pied', () => {
    const html = toHtmlBody('Bonjour, ce bien m’intéresse.', url);
    expect(html).toContain(`<a href="${url}">${url}</a>`);
  });

  it('sans URL, rend le texte échappé sans lien', () => {
    expect(toHtmlBody('Bonjour <b>', null)).toContain('Bonjour &lt;b&gt;');
  });
});

describe('encodeHeader', () => {
  it('laisse l’ASCII intact', () => {
    expect(encodeHeader('Demande de visite')).toBe('Demande de visite');
  });
  it('encode le non-ASCII en mot encodé RFC 2047', () => {
    expect(encodeHeader('réf. 42')).toBe(
      `=?UTF-8?B?${Buffer.from('réf. 42', 'utf8').toString('base64')}?=`,
    );
  });
});

describe('buildDraftMime', () => {
  const mime = buildDraftMime('moi@example.invalid', {
    listingId: 'x1',
    to: 'agence@example.invalid',
    subject: 'Demande de visite - Florian GERTNER KILIAN',
    body: 'Bonjour,\n\nVotre annonce m’intéresse.\nCordialement,\nFlorian',
    sourceUrl: 'https://exemple.invalid/annonce/1',
  });

  it('porte les bons en-têtes (HTML) et un corps base64 décodable', () => {
    expect(mime).toContain('From: moi@example.invalid');
    expect(mime).toContain('To: agence@example.invalid');
    expect(mime).toContain('Content-Type: text/html; charset=utf-8');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    // Le corps (après la ligne vide) se redécode en HTML UTF-8, avec le lien
    // porté par « Votre annonce ».
    const body = mime.split('\r\n\r\n')[1] ?? '';
    const decoded = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
    expect(decoded).toContain('<a href="https://exemple.invalid/annonce/1">Votre annonce</a>');
    expect(decoded).toContain('Florian');
  });
});

describe('createGmailDrafts', () => {
  it('dépose un brouillon par entrée dans le dossier Brouillons et rend les ids', async () => {
    const appended: { path: string; flags?: readonly string[] }[] = [];
    const fake: DraftImapLike = {
      connect: async () => {},
      list: async () => [{ path: 'INBOX' }, { path: '[Gmail]/Brouillons', specialUse: '\\Drafts' }],
      append: async (path, _content, flags) => {
        appended.push({ path, flags });
      },
      logout: async () => {},
    };
    const created = await createGmailDrafts({
      config: {
        host: 'imap',
        port: 993,
        user: 'moi@example.invalid',
        password: 'x',
        mailbox: 'INBOX',
      },
      drafts: [
        { listingId: 'a', to: 'x@example.invalid', subject: 'S', body: 'B' },
        { listingId: 'b', to: 'y@example.invalid', subject: 'S', body: 'B' },
      ],
      log: () => {},
      clientFactory: () => fake,
    });
    expect(created).toEqual(['a', 'b']);
    expect(appended).toHaveLength(2);
    expect(appended[0]?.path).toBe('[Gmail]/Brouillons');
    expect(appended[0]?.flags).toContain('\\Draft');
  });
});
