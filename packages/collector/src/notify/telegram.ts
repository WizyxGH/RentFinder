/**
 * Notifieur Telegram des nouvelles annonces (§29).
 *
 * Après une collecte, envoie sur Telegram les annonces qui viennent d'entrer
 * dans les critères. C'est le canal « site fermé » : contrairement aux
 * notifications navigateur, il pousse sur le téléphone sans que l'app soit
 * ouverte.
 *
 * ENVOI, PAS WEBHOOK. Prévenir l'utilisateur se fait par un appel sortant
 * `sendMessage` de l'API Bot Telegram. Le « webhook » Telegram (au sens strict)
 * sert à RECEVOIR des messages entrants sur un serveur exposé — inutile ici, et
 * incompatible avec le choix « 100 % local » (aucun port ouvert sur Internet).
 *
 * PRUDENCE. Aucun secret n'est journalisé (§26) ; le jeton du bot vit dans
 * `.env`. Chaque annonce n'est notifiée qu'une fois (colonne `notified`). Un
 * échec réseau ne fait pas échouer la collecte (§69) : les annonces non
 * signalées le seront au prochain run (on ne les marque notifiées qu'en cas
 * de succès).
 */

import type { Logger } from '../core/logger.js';
import type { NotifiableListing, Repository } from '../db/repository.js';
import type { TelegramConfig } from '../config.js';

const TELEGRAM_API = 'https://api.telegram.org';

/** Échappe le texte pour le mode HTML de Telegram (§62 : jamais d'injection). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Somme lisible « 640 € · 28 m² · 2 pièces », en omettant l'inconnu (§17). */
function summarize(listing: NotifiableListing): string {
  const parts: string[] = [];
  if (listing.price !== null) parts.push(`${listing.price} €`);
  if (listing.area !== null) parts.push(`${listing.area} m²`);
  if (listing.rooms !== null) parts.push(`${listing.rooms} pièce${listing.rooms > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/**
 * Compose le message HTML d'une annonce (PUR, testable).
 * Le titre devient un lien vers la fiche d'origine quand elle est connue.
 *
 * La localisation affiche l'adresse la PLUS PRÉCISE disponible (rue si publiée,
 * sinon ville + code postal) et devient un lien Google Maps dès qu'on a de quoi
 * localiser — l'adresse de rue quand elle existe, la ville sinon (§20).
 */
export function formatListingMessage(listing: NotifiableListing): string {
  const heading = escapeHtml(listing.title ?? 'Nouvelle annonce');
  const titleLine =
    listing.url !== null
      ? `🏠 <a href="${escapeHtml(listing.url)}">${heading}</a>`
      : `🏠 ${heading}`;

  const lines = [titleLine];
  const summary = summarize(listing);
  if (summary !== '') lines.push(escapeHtml(summary));

  // Libellé affiché : adresse de rue si connue, complétée de la ville/CP.
  const cityPart = [listing.city, listing.postalCode]
    .filter((v) => v !== null && v !== '')
    .join(' ');
  const label = [listing.address, cityPart].filter((v) => v !== null && v !== '').join(', ');

  if (label !== '') {
    // Requête Maps : l'adresse de rue prime (précise), sinon la ville. Une rue
    // sans ville serait ambiguë → on ajoute toujours la ville à la requête.
    const query = [listing.address, cityPart].filter((v) => v !== null && v !== '').join(', ');
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    lines.push(`📍 <a href="${escapeHtml(mapsUrl)}">${escapeHtml(label)}</a>`);
  }

  // Une seule photo tient dans le message ; on signale les autres, visibles sur
  // la fiche (le titre est le lien).
  const photoCount = listing.photoUrls.length;
  if (photoCount > 1) lines.push(`📷 ${photoCount} photos sur la fiche`);

  lines.push(`⭐ Priorité ${listing.actionPriority}/100`);
  return lines.join('\n');
}

/** Extrait le `message_id` d'une réponse Telegram (message seul ou album). */
async function firstMessageId(response: Response): Promise<number | null> {
  try {
    const data = (await response.clone().json()) as {
      result?: { message_id?: number } | { message_id?: number }[];
    };
    const result = Array.isArray(data.result) ? data.result[0] : data.result;
    return typeof result?.message_id === 'number' ? result.message_id : null;
  } catch {
    return null;
  }
}

/** Donnée du bouton « favori » (résolue par mapping message→annonce). */
export const FAVORITE_CALLBACK = 'fav';

/** Clavier en ligne : un bouton pour mettre l'annonce en favori d'un tap. */
function favoriteKeyboard(): Record<string, unknown> {
  return { inline_keyboard: [[{ text: '⭐ Mettre en favori', callback_data: FAVORITE_CALLBACK }]] };
}

/**
 * Envoie un message via l'API Bot Telegram. Lève en cas d'échec.
 * @param withButton attache le bouton « ⭐ Favori » (un tap → favori).
 * @returns le `message_id` du message envoyé (pour lier le bouton à l'annonce).
 */
export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
  fetchImpl: typeof fetch = fetch,
  withButton = false,
): Promise<number | null> {
  const response = await fetchImpl(`${TELEGRAM_API}/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: 'HTML',
      // Pas d'aperçu de lien : le message reste compact sur le téléphone.
      disable_web_page_preview: true,
      ...(withButton ? { reply_markup: favoriteKeyboard() } : {}),
    }),
  });
  if (!response.ok) {
    // On ne journalise jamais le corps (il peut contenir des détails du jeton).
    throw new Error(`Telegram a répondu ${response.status}`);
  }
  return firstMessageId(response);
}

/**
 * Envoie une annonce en UN SEUL message (§29) : la photo principale + la fiche
 * en légende + le bouton « ⭐ Favori ».
 *
 * Pourquoi une seule photo : Telegram ne permet pas « plusieurs images + bouton
 * dans un seul message » (un album serait plusieurs messages et sans bouton).
 * La priorité utilisateur est UN message par annonce ; le message indique le
 * nombre de photos et le titre pointe vers la fiche pour toutes les voir.
 *
 * @returns le `message_id` (celui que le tap « ⭐ Favori » identifiera).
 *
 * Si Telegram ne charge pas la photo, on se replie sur le texte seul (toujours
 * un message, toujours le bouton) — l'information prime sur l'image.
 */
export async function sendTelegramListing(
  config: TelegramConfig,
  listing: NotifiableListing,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const text = formatListingMessage(listing);
  const cover = listing.photoUrls[0];
  if (cover === undefined) {
    return sendTelegramMessage(config, text, fetchImpl, true);
  }

  const response = await fetchImpl(`${TELEGRAM_API}/bot${config.botToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      photo: cover,
      caption: text,
      parse_mode: 'HTML',
      reply_markup: favoriteKeyboard(),
    }),
  });
  if (response.ok) return firstMessageId(response);
  // Photo refusée : le texte seul, avec le bouton.
  return sendTelegramMessage(config, text, fetchImpl, true);
}

export interface NotifyDeps {
  readonly repository: Repository;
  readonly config: TelegramConfig;
  readonly logger: Logger;
  readonly fetchImpl?: typeof fetch;
}

export interface NotifyReport {
  readonly candidates: number;
  readonly sent: number;
  readonly summarized: number;
}

/**
 * Notifie les nouvelles annonces en attente, puis les marque signalées.
 *
 * Envoie individuellement jusqu'à `maxPerRun` annonces (les plus prioritaires),
 * puis un message de synthèse pour le surplus. Les annonces ne sont marquées
 * `notified` qu'après un envoi réussi — un échec les laisse en attente pour le
 * prochain run (§69).
 */
export async function notifyNewListings(deps: NotifyDeps): Promise<NotifyReport> {
  const { repository, config, logger, fetchImpl } = deps;
  const pending = await repository.pendingNotifications(config.minPriority);

  if (pending.length === 0) {
    return { candidates: 0, sent: 0, summarized: 0 };
  }

  const individual = pending.slice(0, config.maxPerRun);
  const overflow = pending.slice(config.maxPerRun);
  const notified: string[] = [];

  try {
    for (const listing of individual) {
      // Un seul message par annonce (photo principale + bouton favori).
      const messageId = await sendTelegramListing(config, listing, fetchImpl);
      notified.push(listing.id);
      // Lie le message à l'annonce pour que le bouton ⭐ la mette en favori.
      if (messageId !== null) {
        await repository.recordTelegramMessage(config.chatId, messageId, listing.id);
      }
    }
    if (overflow.length > 0) {
      const extra = overflow.length;
      await sendTelegramMessage(
        config,
        `➕ <b>${extra}</b> autre${extra > 1 ? 's' : ''} annonce${extra > 1 ? 's' : ''} ` +
          `dans vos critères. Ouvrez RentFinder pour les voir.`,
        fetchImpl,
      );
      notified.push(...overflow.map((listing) => listing.id));
    }
  } catch (error) {
    // Échec réseau/API : on marque quand même ce qui est PARTI (pas de doublon),
    // et on laisse le reste pour le prochain run.
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('notify.telegram_failed', { error: message, sent: notified.length });
    await repository.markNotified(notified);
    return { candidates: pending.length, sent: notified.length, summarized: 0 };
  }

  await repository.markNotified(notified);
  logger.info('notify.telegram_sent', {
    candidates: pending.length,
    sent: individual.length,
    summarized: overflow.length,
  });
  return { candidates: pending.length, sent: individual.length, summarized: overflow.length };
}
