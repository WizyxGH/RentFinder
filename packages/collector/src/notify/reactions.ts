/**
 * Interactions Telegram → favoris (§29, §33).
 *
 * Quand l'utilisateur tape le bouton « ⭐ Favori » (ou, en groupe, pose un ❤️)
 * sur une annonce reçue, on la bascule en favori dans RentFinder. Le lien
 * message → annonce est mémorisé à l'envoi (table `telegram_notifications`).
 *
 * POURQUOI UN BOUTON ET PAS UNE RÉACTION. En messagerie PRIVÉE, Telegram ne
 * délivre PAS les réactions (`message_reaction`) aux bots — seulement en groupe
 * où le bot est admin. Le bouton en ligne, lui, produit un `callback_query`
 * livré partout : c'est le canal fiable. On gère aussi `message_reaction` au
 * cas où l'utilisateur passerait par un groupe.
 *
 * MÉCANIQUE. On lit les mises à jour par `getUpdates` (appel SORTANT, pas de
 * webhook, pas de port ouvert — cohérent avec le 100 % local). Un offset
 * persisté évite de retraiter deux fois la même interaction. Appelé après
 * chaque collecte : un tap est pris en compte au plus tard au run suivant.
 */

import type { Logger } from '../core/logger.js';
import type { Repository } from '../db/repository.js';
import type { TelegramConfig } from '../config.js';
import { FAVORITE_CALLBACK } from './telegram.js';

const TELEGRAM_API = 'https://api.telegram.org';
const OFFSET_KEY = 'reactions_offset';

/** Emojis considérés comme « mise en favori » (cas des groupes). */
const FAVORITE_EMOJI = new Set(['❤', '❤️', '♥', '👍', '🔥']);
/** Emojis considérés comme « retrait du favori » (réaction retirée / pouce bas). */
const UNFAVORITE_EMOJI = new Set(['👎', '💔']);

interface ReactionType {
  readonly type?: string;
  readonly emoji?: string;
}
interface TelegramUpdate {
  readonly update_id: number;
  readonly message_reaction?: {
    readonly chat?: { readonly id?: number };
    readonly message_id?: number;
    readonly new_reaction?: readonly ReactionType[];
  };
  readonly callback_query?: {
    readonly id?: string;
    readonly data?: string;
    readonly message?: { readonly chat?: { readonly id?: number }; readonly message_id?: number };
  };
}

export interface ReactionDeps {
  readonly repository: Repository;
  readonly config: TelegramConfig;
  readonly logger: Logger;
  readonly fetchImpl?: typeof fetch;
}

export interface ReactionReport {
  readonly favorited: number;
  readonly unfavorited: number;
}

/** Confirme un tap de bouton (retire le sablier) avec un petit message. */
async function answerCallback(
  config: TelegramConfig,
  callbackId: string,
  ok: boolean,
  fetchImpl: typeof fetch,
): Promise<void> {
  try {
    await fetchImpl(`${TELEGRAM_API}/bot${config.botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackId,
        text: ok ? '⭐ Ajoutée à vos favoris' : 'Annonce introuvable',
      }),
    });
  } catch {
    /* l'accusé est un confort : son échec n'a pas d'importance */
  }
}

type UpdateEffect = 'favorited' | 'unfavorited' | null;

/** Applique le bouton « ⭐ Favori » d'un `callback_query`. */
async function applyCallback(
  callback: NonNullable<TelegramUpdate['callback_query']>,
  deps: ReactionDeps,
  fetchImpl: typeof fetch,
): Promise<UpdateEffect> {
  if (callback.data !== FAVORITE_CALLBACK || callback.message?.message_id === undefined)
    return null;
  const chatId = callback.message.chat?.id;
  const listingId =
    chatId === undefined
      ? null
      : await deps.repository.listingForTelegramMessage(
          String(chatId),
          callback.message.message_id,
        );
  if (listingId !== null) await deps.repository.setListingFavorite(listingId, true);
  // Accusé de réception : enlève le « chargement » du bouton et confirme.
  if (callback.id !== undefined) {
    await answerCallback(deps.config, callback.id, listingId !== null, fetchImpl);
  }
  return listingId !== null ? 'favorited' : null;
}

/** Applique une réaction ❤️ (canal des groupes) sur une annonce connue. */
async function applyReaction(
  reaction: NonNullable<TelegramUpdate['message_reaction']>,
  deps: ReactionDeps,
): Promise<UpdateEffect> {
  if (reaction.message_id === undefined || reaction.chat?.id === undefined) return null;
  const emojis = (reaction.new_reaction ?? [])
    .filter((r) => r.type === 'emoji' && typeof r.emoji === 'string')
    .map((r) => r.emoji as string);
  const wantsFavorite = emojis.some((e) => FAVORITE_EMOJI.has(e));
  const wantsUnfavorite = emojis.length > 0 && emojis.every((e) => UNFAVORITE_EMOJI.has(e));
  const cleared = emojis.length === 0; // réaction entièrement retirée

  const listingId = await deps.repository.listingForTelegramMessage(
    String(reaction.chat.id),
    reaction.message_id,
  );
  if (listingId === null) return null;

  if (wantsFavorite) {
    await deps.repository.setListingFavorite(listingId, true);
    return 'favorited';
  }
  if (wantsUnfavorite || cleared) {
    await deps.repository.setListingFavorite(listingId, false);
    return 'unfavorited';
  }
  return null;
}

/** Traite un update : bouton (fiable en privé) puis réaction (groupes). */
async function applyUpdate(
  update: TelegramUpdate,
  deps: ReactionDeps,
  fetchImpl: typeof fetch,
): Promise<UpdateEffect> {
  if (update.callback_query !== undefined) {
    return applyCallback(update.callback_query, deps, fetchImpl);
  }
  if (update.message_reaction !== undefined) {
    return applyReaction(update.message_reaction, deps);
  }
  return null;
}

/**
 * Traite les réactions Telegram en attente et met à jour les favoris.
 *
 * Ne lève jamais : une panne réseau du sondage ne doit pas faire échouer la
 * collecte (§69). Renvoie un compte des favoris ajoutés/retirés.
 */
export async function pollTelegramReactions(deps: ReactionDeps): Promise<ReactionReport> {
  const { repository, config, logger } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const storedOffset = await repository.getTelegramState(OFFSET_KEY);
  const offset = storedOffset !== null ? Number.parseInt(storedOffset, 10) : undefined;

  let updates: TelegramUpdate[];
  try {
    const params = new URLSearchParams({
      timeout: '0',
      allowed_updates: JSON.stringify(['callback_query', 'message_reaction']),
    });
    if (offset !== undefined && Number.isFinite(offset)) params.set('offset', String(offset));

    const response = await fetchImpl(
      `${TELEGRAM_API}/bot${config.botToken}/getUpdates?${params.toString()}`,
    );
    if (!response.ok) throw new Error(`getUpdates ${response.status}`);
    const data = (await response.json()) as { ok: boolean; result?: TelegramUpdate[] };
    updates = data.ok ? (data.result ?? []) : [];
  } catch (error) {
    logger.warn('telegram.reactions_failed', {
      error: error instanceof Error ? error.message : 'inconnue',
    });
    return { favorited: 0, unfavorited: 0 };
  }

  let favorited = 0;
  let unfavorited = 0;
  let maxUpdateId = offset !== undefined ? offset - 1 : -1;

  for (const update of updates) {
    maxUpdateId = Math.max(maxUpdateId, update.update_id);
    const effect = await applyUpdate(update, deps, fetchImpl);
    if (effect === 'favorited') favorited += 1;
    else if (effect === 'unfavorited') unfavorited += 1;
  }

  // Confirme les updates traités : au prochain getUpdates, Telegram ne les
  // renverra plus (offset = dernier update_id + 1).
  if (maxUpdateId >= 0) {
    await repository.setTelegramState(OFFSET_KEY, String(maxUpdateId + 1));
  }

  if (favorited > 0 || unfavorited > 0) {
    logger.info('telegram.reactions', { favorited, unfavorited });
  }
  return { favorited, unfavorited };
}
