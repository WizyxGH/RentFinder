/**
 * Création de BROUILLONS Gmail via IMAP `APPEND` (§22, §23, §26).
 *
 * On n'envoie JAMAIS : on dépose un brouillon prêt à relire dans le dossier
 * « Brouillons » de la boîte de l'utilisateur, avec les MÊMES identifiants
 * (mot de passe d'application) que l'import d'alertes. L'utilisateur relit et
 * envoie lui-même — rien ne part sans son action explicite.
 *
 * Contrairement à l'import (lecture seule), cette fonction ÉCRIT dans la boîte,
 * mais uniquement dans les Brouillons, et jamais un envoi. Elle ne lève pas :
 * un échec réseau/auth rend simplement 0 brouillon créé (§69).
 */

import { ImapFlow } from 'imapflow';
import type { ImapConfig } from '../config.js';

export interface DraftContent {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  /** Identifiant de l'annonce, pour tracer les brouillons réellement créés. */
  readonly listingId: string;
}

/** Sous-ensemble d'ImapFlow utilisé (facilite l'injection en test, §59). */
export interface DraftImapLike {
  connect(): Promise<void>;
  list(): Promise<readonly { readonly path: string; readonly specialUse?: string }[]>;
  append(path: string, content: string, flags?: readonly string[]): Promise<unknown>;
  logout(): Promise<void>;
}

/** Encode un en-tête non-ASCII en mot encodé RFC 2047 (UTF-8 / base64). */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Découpe une chaîne base64 en lignes de 76 caractères (RFC 2045). */
function chunk76(base64: string): string {
  return (base64.match(/.{1,76}/g) ?? []).join('\r\n');
}

/**
 * Construit le message MIME (texte brut UTF-8, corps en base64) d'un brouillon.
 * Fonction PURE, testable sans réseau.
 */
export function buildDraftMime(from: string, draft: DraftContent): string {
  const body = chunk76(Buffer.from(draft.body, 'utf8').toString('base64'));
  return [
    `From: ${from}`,
    `To: ${draft.to}`,
    `Subject: ${encodeHeader(draft.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

export interface CreateDraftsOptions {
  readonly config: ImapConfig;
  readonly drafts: readonly DraftContent[];
  readonly log: (event: string, fields?: Record<string, unknown>) => void;
  /** Injection pour les tests (§59). */
  readonly clientFactory?: (config: ImapConfig) => DraftImapLike;
}

/** Repère le dossier « Brouillons » via l'usage spécial `\Drafts` (nom localisé). */
function findDraftsPath(
  boxes: readonly { readonly path: string; readonly specialUse?: string }[],
): string | null {
  const special = boxes.find((b) => b.specialUse === '\\Drafts');
  if (special !== undefined) return special.path;
  const byName = boxes.find((b) => /drafts|brouillons/i.test(b.path));
  return byName?.path ?? null;
}

/**
 * Crée un brouillon par entrée dans le dossier Brouillons. Rend la liste des
 * `listingId` pour lesquels un brouillon a bien été déposé (pour les tracer).
 */
export async function createGmailDrafts(options: CreateDraftsOptions): Promise<string[]> {
  const { config, drafts, log } = options;
  if (drafts.length === 0) return [];

  const client: DraftImapLike =
    options.clientFactory?.(config) ??
    (new ImapFlow({
      host: config.host,
      port: config.port,
      secure: true,
      auth: { user: config.user, pass: config.password },
      logger: false,
    }) as unknown as DraftImapLike);

  const created: string[] = [];
  try {
    await client.connect();
  } catch (error) {
    log('draft.connect_failed', {
      error: error instanceof Error ? error.message : 'erreur inconnue',
    });
    return [];
  }

  try {
    const draftsPath = findDraftsPath(await client.list());
    if (draftsPath === null) {
      log('draft.no_mailbox', {});
      return [];
    }
    for (const draft of drafts) {
      try {
        const mime = buildDraftMime(config.user, draft);
        await client.append(draftsPath, mime, ['\\Draft']);
        created.push(draft.listingId);
      } catch (error) {
        log('draft.append_failed', {
          listingId: draft.listingId,
          error: error instanceof Error ? error.message : 'erreur inconnue',
        });
      }
    }
    log('draft.created', { count: created.length, mailbox: draftsPath });
  } finally {
    try {
      await client.logout();
    } catch {
      /* déconnexion best-effort */
    }
  }

  return created;
}
