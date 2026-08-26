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
import { listingSpecKey, looseSpecKey } from '../db/repository.js';
import { formatLocation } from '@rentfinder/shared';
import { sourceDisplayNames } from '../sources/index.js';
import type { TelegramConfig } from '../config.js';

const TELEGRAM_API = 'https://api.telegram.org';

/** Échappe le texte pour le mode HTML de Telegram (§62 : jamais d'injection). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Portail d'origine déduit de l'URL de l'annonce. Les annonces importées par
 * ALERTE E-MAIL portent une URL du portail (parfois via son domaine de
 * tracking) : on la traduit en nom lisible pour lever l'ambiguïté du
 * `source = email-alerts` (§17). `null` si l'hôte n'est pas un portail connu
 * (annonces d'agences : leur source suffit déjà à les identifier).
 */
const PORTAL_LABELS: readonly (readonly [RegExp, string])[] = [
  [/seloger\.com$/i, 'SeLoger'],
  [/bienici\.com$/i, "Bien'ici"],
  [/leboncoin\.fr$/i, 'Leboncoin'],
  [/pap\.fr$/i, 'PAP'],
  [/logic-immo\.com$/i, 'Logic-Immo'],
];

/**
 * Nom lisible d'une source à partir de son identifiant (« foncia » → « Foncia »).
 * La table est construite une seule fois, à la demande, pour ne pas payer
 * l'import du registre à chaque message.
 */
let sourceNamesCache: ReadonlyMap<string, string> | null = null;

function sourceName(sourceId: string | null): string | null {
  if (sourceId === null || sourceId === '') return null;
  sourceNamesCache ??= sourceDisplayNames();
  return sourceNamesCache.get(sourceId) ?? null;
}

function portalLabel(url: string | null): string | null {
  if (url === null) return null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return PORTAL_LABELS.find(([pattern]) => pattern.test(host))?.[1] ?? null;
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
export function formatListingMessage(
  listing: NotifiableListing,
  nowMs: number = Date.now(),
): string {
  const heading = escapeHtml(listing.title ?? 'Nouvelle annonce');
  const titleLine =
    listing.url !== null
      ? `🏠 <a href="${escapeHtml(listing.url)}">${heading}</a>`
      : `🏠 ${heading}`;

  const lines = [titleLine];
  const summary = summarize(listing);
  if (summary !== '') lines.push(escapeHtml(summary));

  // Localisation la plus précise (rue → quartier → commune), au format postal
  // français commun à toute l'application : « 12 Rue de France, 06000 Nice ».
  const label = formatLocation({
    street: listing.address,
    district: listing.district,
    postalCode: listing.postalCode,
    city: listing.city,
  });

  if (label !== '') {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`;
    lines.push(`📍 <a href="${escapeHtml(mapsUrl)}">${escapeHtml(label)}</a>`);
  }

  // Disponibilité : décisive pour agir (emménagement possible) — §17, affichée
  // seulement si la source l'a publiée.
  const availability = formatAvailability(listing.availableAt, nowMs);
  if (availability !== null) lines.push(`📅 ${availability}`);

  // Téléphone : Telegram n'accepte pas les liens `tel:` dans les boutons, mais
  // un numéro écrit dans le message est tappable sur mobile → appel direct, le
  // canal le plus rapide pour être le premier à visiter (§21).
  if (listing.phone !== null) lines.push(`📞 ${escapeHtml(listing.phone)}`);

  // Provenance, TOUJOURS affichée : savoir d'où sort l'annonce oriente l'action
  // (rappeler l'agence, ouvrir le portail…). Pour une alerte e-mail, le
  // `sourceId` générique ne dit rien : on affiche alors le PORTAIL déduit de
  // l'URL (SeLoger, Bien'ici…). Sinon, le nom de la source (agence).
  const origin = portalLabel(listing.url) ?? sourceName(listing.sourceId);
  if (origin !== null) lines.push(`📨 via ${escapeHtml(origin)}`);

  lines.push(`⭐ Priorité ${listing.actionPriority}/100`);
  return lines.join('\n');
}

/**
 * Disponibilité lisible, alignée sur l'affichage du site : « Dispo maintenant »
 * si l'emménagement est immédiat (sous 3 jours), sinon « Dispo le {date} ».
 * `null` si la source ne l'a pas publiée ou si la date est illisible (§17).
 */
function formatAvailability(iso: string | null, nowMs: number): string | null {
  if (iso === null) return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  if (timestamp <= nowMs + 3 * 86_400_000) return 'Dispo maintenant';
  const formatted = new Date(timestamp).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year:
      new Date(timestamp).getUTCFullYear() === new Date(nowMs).getUTCFullYear()
        ? undefined
        : 'numeric',
    timeZone: 'UTC',
  });
  return `Dispo ${formatted}`;
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
function favoriteKeyboard(url: string | null = null): Record<string, unknown> {
  const row: Record<string, unknown>[] = [{ text: '⭐ Favori', callback_data: FAVORITE_CALLBACK }];
  // Telegram n'autorise que http(s) dans les boutons `url` (ni `tel:` ni
  // `mailto:`) : on y met donc l'annonce, et le téléphone reste tappable dans
  // le texte du message.
  if (url !== null && /^https?:\/\//i.test(url)) {
    row.push({ text: '🔗 Voir l’annonce', url });
  }
  return { inline_keyboard: [row] };
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
 * Envoie une annonce en DEUX messages groupés (§29) :
 *
 * UN SEUL message par annonce (§29) : soit un texte (sans photo), soit une
 * photo de COUVERTURE avec toute la fiche en légende et le bouton « ⭐ Favori ».
 * On n'envoie PAS d'album : un album Telegram crée un message PAR photo, ce qui
 * inondait la conversation (les autres photos se voient sur l'annonce d'origine).
 *
 * @returns le `message_id` du message envoyé — celui que le tap « ⭐ Favori »
 *          identifiera. Si la photo ne passe pas, repli sur un message texte.
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

  // Photo de couverture + fiche en légende + bouton, sur un seul message.
  const response = await fetchImpl(`${TELEGRAM_API}/bot${config.botToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      photo: cover,
      caption: text,
      parse_mode: 'HTML',
      reply_markup: favoriteKeyboard(listing.url),
    }),
  });
  if (response.ok) return firstMessageId(response);
  return sendTelegramMessage(config, text, fetchImpl, true);
}

/**
 * Édite les messages Telegram des annonces devenues INDISPONIBLES pour le
 * signaler (§29, §33) : « 🔴 LOUÉ » quand la source l'a marquée louée, « ⚫ Plus
 * disponible » quand l'annonce a simplement disparu de la source. On ne connaît
 * pas le type du message (photo ou texte) : on tente `editMessageCaption` puis
 * `editMessageText`. Chaque message n'est édité qu'une fois (drapeau
 * `edited_rented`). Ne lève jamais (§69).
 *
 * @returns le nombre de messages édités.
 */
export async function editRentedTelegramMessages(deps: NotifyDeps): Promise<number> {
  const { repository, config, logger } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const pending = await repository.unavailableTelegramMessages();
  let edited = 0;

  for (const { chatId, messageId, title, reason } of pending) {
    const heading = reason === 'rented' ? '🔴 <b>LOUÉ</b>' : '⚫ <b>Plus disponible</b>';
    const note =
      reason === 'rented' ? 'Ce bien a été loué.' : 'Cette annonce a été retirée de la source.';
    const text = `${heading} — ${escapeHtml(title ?? 'Annonce')}\n<i>${note}</i>`;
    try {
      const base = { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' as const };
      let ok = await tryEdit(config, 'editMessageCaption', { ...base, caption: text }, fetchImpl);
      if (!ok) ok = await tryEdit(config, 'editMessageText', { ...base, text }, fetchImpl);
      // On marque « traité » même si l'édition échoue (message supprimé,
      // trop ancien…) pour ne pas boucler indéfiniment.
      await repository.markTelegramRentedEdited(chatId, messageId);
      if (ok) edited += 1;
    } catch {
      /* réseau : on réessaiera au prochain run (drapeau non posé) */
    }
  }

  if (edited > 0) logger.info('telegram.unavailable_edited', { edited });
  return edited;
}

/** Tente une édition Telegram ; `true` si l'API a accepté. */
async function tryEdit(
  config: TelegramConfig,
  method: 'editMessageCaption' | 'editMessageText',
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const response = await fetchImpl(`${TELEGRAM_API}/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.ok;
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
  const raw = await repository.pendingNotifications(config.minPriority);

  // Anti-doublon des NOTIFICATIONS (§29). Le dédoublonnage des fiches reste
  // volontairement prudent (§14 : ne jamais fusionner deux logements distincts,
  // ce qui ferait disparaître une annonce réelle). Mais deux fiches de même
  // loyer/surface/ville/pièces produisent une notification redondante. Ici le
  // risque est inverse et réversible : taire une notification ne perd rien, la
  // fiche reste visible sur le site. On applique donc deux règles :
  //   1. une annonce d'alerte E-MAIL dont un équivalent DIRECT (agence scrapée)
  //      existe n'est pas notifiée — le lien direct est meilleur ;
  //   2. dans un même envoi, une seule notification par « signature » de bien,
  //      la mieux notée en premier (les suivantes sont tues).
  const directKeys = await repository.directListingSpecKeys();
  const seenBySource = new Map<string, string>();
  const pending = raw.filter((listing) => {
    const loose = looseSpecKey(listing.price, listing.area, listing.rooms);
    // Signature : la ville quand on l'a, sinon le repli loyer|surface|pièces —
    // les alertes e-mail ne publient pas toujours la commune.
    const key = listingSpecKey(listing.price, listing.area, listing.city, listing.rooms) ?? loose;
    if (key === null) return true; // signature incalculable : on ne tait rien (§17)
    if (
      listing.sourceId === 'email-alerts' &&
      (directKeys.has(key) || (loose !== null && directKeys.has(loose)))
    ) {
      return false;
    }

    const source = listing.sourceId ?? '?';
    const keptFrom = seenBySource.get(key);
    // Suppression réservée aux doublons INTER-sources (même bien relayé par
    // deux sources). Au sein d'une MÊME source, deux annonces de mêmes loyer/
    // surface/ville/pièces sont bien plus souvent deux logements distincts d'un
    // même immeuble : on les notifie toutes (§14, prudence).
    if (keptFrom !== undefined && keptFrom !== source) return false;
    if (keptFrom === undefined) seenBySource.set(key, source);
    return true;
  });

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
