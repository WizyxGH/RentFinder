/**
 * Transport IMAP pour l'import des alertes e-mail (§6, §10, §26).
 *
 * Se connecte à la boîte mail de l'utilisateur en LECTURE SEULE, récupère les
 * e-mails récents du dossier configuré et rend leur HTML. Aucune modification
 * de la boîte (pas de marquage « lu »), aucune connexion à un portail. Ne lève
 * jamais : toute erreur réseau/auth rend une liste vide (§69).
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ALERT_SENDER_MATCHES } from '@rentfinder/shared';
import type { ImapConfig } from '../config.js';

export interface EmailImportOptions {
  readonly config: ImapConfig;
  /** Journalisation (le `log` du contexte de scraper convient). */
  readonly log: (event: string, fields?: Record<string, unknown>) => void;
  /** Ne lire que les e-mails reçus depuis N jours (défaut 7). */
  readonly sinceDays?: number;
  /** Injection pour les tests (§59) — un client compatible ImapFlow. */
  readonly clientFactory?: (config: ImapConfig) => ImapLike;
}

/**
 * Expéditeurs des portails dont on lit les alertes. La recherche IMAP ne
 * remonte QUE les e-mails d'un de ces expéditeurs — les mails personnels de
 * l'utilisateur ne sont JAMAIS lus (§26), même si la boîte est INBOX.
 */
const ALERT_SENDERS: readonly string[] = ALERT_SENDER_MATCHES;

/** Sous-ensemble d'ImapFlow réellement utilisé (facilite l'injection en test). */
export interface ImapLike {
  connect(): Promise<void>;
  getMailboxLock(
    mailbox: string,
    opts?: { readonly readOnly?: boolean },
  ): Promise<{ release(): void }>;
  fetch(
    range: unknown,
    query: { readonly source: true },
  ): AsyncIterable<{ readonly source?: Buffer }>;
  logout(): Promise<void>;
}

/**
 * Récupère le HTML des e-mails d'alerte récents. Chaque entrée = le corps HTML
 * (ou texte) d'un e-mail, à passer ensuite à `parseAlertEmail`.
 */
export async function fetchAlertEmails(options: EmailImportOptions): Promise<string[]> {
  const { config, log } = options;
  const sinceDays = options.sinceDays ?? 7;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const client: ImapLike =
    options.clientFactory?.(config) ??
    new ImapFlow({
      host: config.host,
      port: config.port,
      secure: true,
      auth: { user: config.user, pass: config.password },
      logger: false,
    });

  const bodies: string[] = [];
  try {
    await client.connect();
  } catch (error) {
    log('email.connect_failed', {
      error: error instanceof Error ? error.message : 'erreur inconnue',
    });
    return [];
  }

  try {
    // Lecture seule : jamais de marquage « lu » ni d'altération de la boîte.
    const lock = await client.getMailboxLock(config.mailbox, { readOnly: true });
    try {
      // VIE PRIVÉE (§26) : on ne lit QUE les e-mails PROVENANT des portails —
      // jamais les mails personnels de l'utilisateur, même en lisant INBOX. Le
      // filtrage se fait côté serveur IMAP (recherche par expéditeur).
      const query = { since, or: ALERT_SENDERS.map((from) => ({ from })) };
      for await (const message of client.fetch(query, { source: true })) {
        if (message.source === undefined) continue;
        const parsed = await simpleParser(message.source);
        const body = typeof parsed.html === 'string' ? parsed.html : (parsed.text ?? '');
        if (body !== '') bodies.push(body);
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    log('email.fetch_failed', {
      error: error instanceof Error ? error.message : 'erreur inconnue',
    });
  } finally {
    try {
      await client.logout();
    } catch {
      /* déconnexion best-effort */
    }
  }

  log('email.fetched', { emails: bodies.length });
  return bodies;
}
