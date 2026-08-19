import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '../db/repository.js';
import type { TelegramConfig } from '../config.js';
import { createLogger } from '../core/logger.js';
import { pollTelegramReactions } from './reactions.js';

const CONFIG: TelegramConfig = {
  botToken: 'test-token',
  chatId: '1006472657',
  minPriority: 0,
  maxPerRun: Infinity,
};

const logger = createLogger({ minLevel: 'error' });

/** Repo factice : mémorise l'offset et les favoris posés. */
function fakeRepo(
  mapping: Record<number, string>,
  initialOffset?: string,
): {
  repo: Repository;
  favorites: { id: string; value: boolean }[];
  state: Map<string, string>;
} {
  const favorites: { id: string; value: boolean }[] = [];
  const state = new Map<string, string>();
  if (initialOffset !== undefined) state.set('reactions_offset', initialOffset);
  const repo = {
    listingForTelegramMessage: vi.fn(async (_chat: string, messageId: number) =>
      mapping[messageId] !== undefined ? mapping[messageId] : null,
    ),
    setListingFavorite: vi.fn(async (id: string, value: boolean) => {
      favorites.push({ id, value });
    }),
    getTelegramState: vi.fn(async (key: string) => state.get(key) ?? null),
    setTelegramState: vi.fn(async (key: string, value: string) => {
      state.set(key, value);
    }),
  } as unknown as Repository;
  return { repo, favorites, state };
}

/** Fabrique une réponse getUpdates factice. */
const updatesFetch = (updates: unknown[]): typeof fetch =>
  vi.fn(
    async () => new Response(JSON.stringify({ ok: true, result: updates }), { status: 200 }),
  ) as unknown as typeof fetch;

function reactionUpdate(updateId: number, messageId: number, emoji: string | null): unknown {
  return {
    update_id: updateId,
    message_reaction: {
      chat: { id: 1006472657 },
      message_id: messageId,
      new_reaction: emoji === null ? [] : [{ type: 'emoji', emoji }],
    },
  };
}

function callbackUpdate(updateId: number, messageId: number, data: string): unknown {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb${updateId}`,
      data,
      message: { chat: { id: 1006472657 }, message_id: messageId },
    },
  };
}

describe('pollTelegramReactions', () => {
  it('un tap sur le bouton ⭐ met l’annonce en favori (callback_query)', async () => {
    const { repo, favorites } = fakeRepo({ 42: 'orpi:123' });
    const fetchImpl = updatesFetch([callbackUpdate(1000, 42, 'fav')]);

    const report = await pollTelegramReactions({
      repository: repo,
      config: CONFIG,
      logger,
      fetchImpl,
    });

    expect(report.favorited).toBe(1);
    expect(favorites).toEqual([{ id: 'orpi:123', value: true }]);
    // Un accusé de réception (answerCallbackQuery) est envoyé.
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(calls.some((u) => u.includes('answerCallbackQuery'))).toBe(true);
  });

  it('un ❤️ sur une annonce connue la met en favori', async () => {
    const { repo, favorites } = fakeRepo({ 42: 'orpi:123' });
    const fetchImpl = updatesFetch([reactionUpdate(1000, 42, '❤')]);

    const report = await pollTelegramReactions({
      repository: repo,
      config: CONFIG,
      logger,
      fetchImpl,
    });

    expect(report.favorited).toBe(1);
    expect(favorites).toEqual([{ id: 'orpi:123', value: true }]);
  });

  it('une réaction retirée (vide) retire le favori', async () => {
    const { repo, favorites } = fakeRepo({ 42: 'orpi:123' });
    const fetchImpl = updatesFetch([reactionUpdate(1000, 42, null)]);

    const report = await pollTelegramReactions({
      repository: repo,
      config: CONFIG,
      logger,
      fetchImpl,
    });

    expect(report.unfavorited).toBe(1);
    expect(favorites).toEqual([{ id: 'orpi:123', value: false }]);
  });

  it('ignore une réaction sur un message inconnu', async () => {
    const { repo, favorites } = fakeRepo({});
    const fetchImpl = updatesFetch([reactionUpdate(1000, 99, '❤')]);

    const report = await pollTelegramReactions({
      repository: repo,
      config: CONFIG,
      logger,
      fetchImpl,
    });

    expect(report.favorited).toBe(0);
    expect(favorites).toHaveLength(0);
  });

  it('avance l’offset pour ne pas retraiter les mêmes réactions', async () => {
    const { repo, state } = fakeRepo({ 42: 'orpi:123' });
    const fetchImpl = updatesFetch([reactionUpdate(1000, 42, '❤'), reactionUpdate(1001, 42, '👍')]);

    await pollTelegramReactions({ repository: repo, config: CONFIG, logger, fetchImpl });

    // offset = dernier update_id + 1.
    expect(state.get('reactions_offset')).toBe('1002');
  });

  it('n’échoue jamais si getUpdates renvoie une erreur (§69)', async () => {
    const { repo } = fakeRepo({});
    const failing = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;

    const report = await pollTelegramReactions({
      repository: repo,
      config: CONFIG,
      logger,
      fetchImpl: failing,
    });

    expect(report).toEqual({ favorited: 0, unfavorited: 0 });
  });

  it('transmet l’offset stocké à getUpdates', async () => {
    const { repo } = fakeRepo({}, '5000');
    const fetchImpl = updatesFetch([]);

    await pollTelegramReactions({ repository: repo, config: CONFIG, logger, fetchImpl });

    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(url).toContain('offset=5000');
    expect(url).toContain('message_reaction');
  });
});
