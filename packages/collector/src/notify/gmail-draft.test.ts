import { describe, expect, it } from 'vitest';
import {
  buildDraftMime,
  encodeHeader,
  createGmailDrafts,
  type DraftImapLike,
} from './gmail-draft.js';

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
    subject: 'Demande de visite (réf. 42)',
    body: 'Bonjour,\n\nVotre annonce m’intéresse.\nCordialement,\nFlorian',
  });

  it('porte les bons en-têtes et un corps base64 décodable', () => {
    expect(mime).toContain('From: moi@example.invalid');
    expect(mime).toContain('To: agence@example.invalid');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    // Le sujet non-ASCII est encodé.
    expect(mime).toContain('Subject: =?UTF-8?B?');
    // Le corps (après la ligne vide) se redécode en UTF-8 d'origine.
    const body = mime.split('\r\n\r\n')[1] ?? '';
    const decoded = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
    expect(decoded).toContain('Votre annonce m’intéresse.');
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
