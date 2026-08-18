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
 */
export function formatListingMessage(listing: NotifiableListing): string {
  const place = [listing.city, listing.postalCode].filter((v) => v !== null && v !== '').join(' ');
  const heading = escapeHtml(listing.title ?? 'Nouvelle annonce');
  const titleLine =
    listing.url !== null
      ? `🏠 <a href="${escapeHtml(listing.url)}">${heading}</a>`
      : `🏠 ${heading}`;

  const lines = [titleLine];
  const summary = summarize(listing);
  if (summary !== '') lines.push(escapeHtml(summary));
  if (place !== '') lines.push(`📍 ${escapeHtml(place)}`);
  lines.push(`⭐ Priorité ${listing.actionPriority}/100`);
  return lines.join('\n');
}

/** Envoie un message via l'API Bot Telegram. Lève en cas d'échec. */
export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${TELEGRAM_API}/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: 'HTML',
      // Pas d'aperçu de lien : le message reste compact sur le téléphone.
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    // On ne journalise jamais le corps (il peut contenir des détails du jeton).
    throw new Error(`Telegram a répondu ${response.status}`);
  }
}

/**
 * Envoie une annonce AVEC ses photos (les images viennent du site d'origine —
 * §11, rien n'est téléchargé par nous : Telegram les charge depuis leurs URLs).
 *
 *   - 0 photo  → message texte ;
 *   - 1 photo  → `sendPhoto`, fiche en légende ;
 *   - 2+       → `sendMediaGroup` (album, 10 max), fiche en légende de la 1re.
 *
 * Si Telegram ne parvient pas à charger les images (URL expirée, hôte
 * récalcitrant), on se replie sur le texte — l'information prime sur l'image.
 */
export async function sendTelegramListing(
  config: TelegramConfig,
  listing: NotifiableListing,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const text = formatListingMessage(listing);
  const photos = listing.photoUrls;
  if (photos.length === 0) {
    await sendTelegramMessage(config, text, fetchImpl);
    return;
  }

  const endpoint = photos.length === 1 ? 'sendPhoto' : 'sendMediaGroup';
  const payload =
    photos.length === 1
      ? { chat_id: config.chatId, photo: photos[0], caption: text, parse_mode: 'HTML' }
      : {
          chat_id: config.chatId,
          media: photos.map((url, index) => ({
            type: 'photo',
            media: url,
            // La légende de l'album vit sur son premier élément.
            ...(index === 0 ? { caption: text, parse_mode: 'HTML' } : {}),
          })),
        };

  const response = await fetchImpl(`${TELEGRAM_API}/bot${config.botToken}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (response.ok) return;

  // 4xx typique : Telegram n'a pas pu charger une image. Le texte, lui, doit passer.
  await sendTelegramMessage(config, text, fetchImpl);
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
      await sendTelegramListing(config, listing, fetchImpl);
      notified.push(listing.id);
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
