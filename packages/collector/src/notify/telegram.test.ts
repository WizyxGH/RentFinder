import { describe, expect, it, vi } from 'vitest';
import type { NotifiableListing, Repository } from '../db/repository.js';
import type { TelegramConfig } from '../config.js';
import { createLogger } from '../core/logger.js';
import {
  editRentedTelegramMessages,
  formatListingMessage,
  notifyNewListings,
  sendTelegramListing,
  sendTelegramMessage,
} from './telegram.js';

const CONFIG: TelegramConfig = {
  botToken: 'test-token',
  chatId: '123',
  minPriority: 0,
  maxPerRun: 2,
};

function listing(over: Partial<NotifiableListing> & { id: string }): NotifiableListing {
  // `in` et non `??` : une valeur explicitement `null` doit être respectée
  // (sinon on ne pourrait pas tester le cas « champ inconnu », §17).
  const pick = <K extends keyof NotifiableListing>(
    key: K,
    fallback: NotifiableListing[K],
  ): NotifiableListing[K] => (key in over ? (over[key] as NotifiableListing[K]) : fallback);
  return {
    id: over.id,
    title: pick('title', 'Bel appartement'),
    price: pick('price', 640),
    area: pick('area', 28),
    rooms: pick('rooms', 2),
    city: pick('city', 'nice'),
    postalCode: pick('postalCode', '06000'),
    address: pick('address', null),
    district: pick('district', null),
    availableAt: pick('availableAt', null),
    actionPriority: pick('actionPriority', 80),
    url: pick('url', 'https://exemple.fr/annonce/1'),
    photoUrls: pick('photoUrls', []),
  };
}

/** Réponse fetch factice — jamais de réseau dans les tests (§59). */
const okFetch = (): typeof fetch =>
  vi.fn(async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;

describe('formatListingMessage', () => {
  it('compose un message avec titre cliquable, résumé, lieu et priorité', () => {
    const msg = formatListingMessage(listing({ id: 'a' }));
    expect(msg).toContain('<a href="https://exemple.fr/annonce/1">Bel appartement</a>');
    expect(msg).toContain('640 € · 28 m² · 2 pièces');
    // Sans adresse de rue, le lieu (ville + CP) est un lien Maps.
    expect(msg).toContain('google.com/maps');
    expect(msg).toContain('nice 06000');
    expect(msg).toContain('Priorité 80');
  });

  it('affiche l’adresse de rue précise et un lien Maps quand elle existe (§20)', () => {
    const msg = formatListingMessage(
      listing({ id: 'a', address: '22-24 Avenue de la Californie' }),
    );
    expect(msg).toContain('22-24 Avenue de la Californie, nice 06000');
    expect(msg).toContain('google.com/maps');
    // La requête Maps contient l'adresse précise, encodée.
    expect(msg).toContain(encodeURIComponent('22-24 Avenue de la Californie, nice 06000'));
  });

  it('échappe le HTML du titre (§62)', () => {
    const msg = formatListingMessage(listing({ id: 'a', title: 'T2 <script> & co' }));
    expect(msg).toContain('T2 &lt;script&gt; &amp; co');
    expect(msg).not.toContain('<script>');
  });

  it('affiche la disponibilité quand la source la publie (§17)', () => {
    const now = Date.parse('2026-08-21T12:00:00Z');
    // Date future → date précise.
    const future = formatListingMessage(
      listing({ id: 'a', availableAt: '2026-10-01T00:00:00.000Z' }),
      now,
    );
    expect(future).toContain('📅 Dispo 1 oct.');
    // Date immédiate (sous 3 jours) → « maintenant ».
    const soon = formatListingMessage(
      listing({ id: 'a', availableAt: '2026-08-22T00:00:00.000Z' }),
      now,
    );
    expect(soon).toContain('📅 Dispo maintenant');
    // Absente → pas de ligne de dispo.
    expect(formatListingMessage(listing({ id: 'a', availableAt: null }), now)).not.toContain('📅');
  });

  it('omet les champs inconnus plutôt que d’inventer (§17)', () => {
    const msg = formatListingMessage(
      listing({
        id: 'a',
        price: null,
        area: null,
        rooms: null,
        url: null,
        city: null,
        postalCode: null,
        address: null,
      }),
    );
    expect(msg).not.toContain('€');
    // Ni fiche ni localisation connues → aucun lien du tout.
    expect(msg).not.toContain('<a ');
    expect(msg).toContain('🏠 Bel appartement');
  });
});

describe('sendTelegramMessage', () => {
  it('poste sur l’API bot et lève sur statut non-OK', async () => {
    const fetchImpl = okFetch();
    await sendTelegramMessage(CONFIG, 'coucou', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/sendMessage',
      expect.objectContaining({ method: 'POST' }),
    );

    const failing = vi.fn(async () => new Response('', { status: 429 })) as unknown as typeof fetch;
    await expect(sendTelegramMessage(CONFIG, 'x', failing)).rejects.toThrow(/429/);
  });
});

describe('sendTelegramListing', () => {
  it('une seule photo → sendPhoto (photo + légende + bouton)', async () => {
    const fetchImpl = okFetch();
    await sendTelegramListing(
      CONFIG,
      listing({ id: 'a', photoUrls: ['https://img.exemple/1.jpg'] }),
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/sendPhoto',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string,
    ) as { reply_markup: unknown };
    expect(body.reply_markup).toBeDefined();
  });

  it('plusieurs photos → UN SEUL message : couverture + légende + bouton', async () => {
    const fetchImpl = okFetch();
    const urls = Array.from({ length: 5 }, (_, i) => `https://img.exemple/${i}.jpg`);
    await sendTelegramListing(CONFIG, listing({ id: 'a', photoUrls: urls }), fetchImpl);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    // Un seul appel : sendPhoto (pas d'album qui inonderait la conversation).
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain('sendPhoto');
    const body = JSON.parse(calls[0]?.[1]?.body as string) as {
      photo: string;
      caption: string;
      reply_markup: unknown;
    };
    // La couverture = la première photo ; le bouton favori est présent.
    expect(body.photo).toBe('https://img.exemple/0.jpg');
    expect(body.reply_markup).toBeDefined();
    // La légende signale les autres photos, à voir sur l'annonce.
    expect(body.caption).toContain('5 photos');
  });

  it('sans photo, envoie un message texte avec bouton', async () => {
    const fetchImpl = okFetch();
    await sendTelegramListing(CONFIG, listing({ id: 'a', photoUrls: [] }), fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/sendMessage',
      expect.anything(),
    );
    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string,
    ) as { reply_markup: unknown };
    expect(body.reply_markup).toBeDefined();
  });
});

describe('loadTelegramConfig — pas de limite par défaut', () => {
  it('maxPerRun vaut Infinity sans TELEGRAM_MAX_PER_RUN', async () => {
    const { loadTelegramConfig } = await import('../config.js');
    const config = loadTelegramConfig({
      TELEGRAM_BOT_TOKEN: 'x',
      TELEGRAM_CHAT_ID: '1',
    } as NodeJS.ProcessEnv);
    expect(config?.maxPerRun).toBe(Infinity);
  });
});

describe('notifyNewListings', () => {
  function fakeRepo(pending: NotifiableListing[]): {
    repo: Repository;
    marked: string[];
  } {
    const marked: string[] = [];
    const repo = {
      pendingNotifications: vi.fn(async () => pending),
      markNotified: vi.fn(async (ids: readonly string[]) => {
        marked.push(...ids);
      }),
    } as unknown as Repository;
    return { repo, marked };
  }

  const logger = createLogger({ minLevel: 'error' });

  it('chaque annonce multi-photos → UN SEUL message (sendPhoto), pas d’album', async () => {
    const pending = Array.from({ length: 3 }, (_, i) =>
      listing({
        id: `l${i}`,
        photoUrls: ['https://img.exemple/1.jpg', 'https://img.exemple/2.jpg'],
      }),
    );
    const { repo } = fakeRepo(pending);
    const fetchImpl = okFetch();
    await notifyNewListings({
      repository: repo,
      config: { ...CONFIG, maxPerRun: Infinity },
      logger,
      fetchImpl,
    });
    const urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0]),
    );
    // 3 annonces → 3 messages (sendPhoto), aucun album.
    expect(urls.filter((u) => u.includes('sendPhoto'))).toHaveLength(3);
    expect(urls.filter((u) => u.includes('sendMediaGroup'))).toHaveLength(0);
  });

  it('envoie individuellement puis résume le surplus, et marque tout notifié', async () => {
    const pending = [
      listing({ id: 'a', actionPriority: 90 }),
      listing({ id: 'b', actionPriority: 80 }),
      listing({ id: 'c', actionPriority: 70 }),
      listing({ id: 'd', actionPriority: 60 }),
    ];
    const { repo, marked } = fakeRepo(pending);
    const fetchImpl = okFetch();

    const report = await notifyNewListings({ repository: repo, config: CONFIG, logger, fetchImpl });

    // maxPerRun = 2 → 2 messages individuels + 1 message de synthèse.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(report).toEqual({ candidates: 4, sent: 2, summarized: 2 });
    expect(marked.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ne fait rien quand il n’y a aucune annonce en attente', async () => {
    const { repo } = fakeRepo([]);
    const fetchImpl = okFetch();
    const report = await notifyNewListings({ repository: repo, config: CONFIG, logger, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report).toEqual({ candidates: 0, sent: 0, summarized: 0 });
  });

  it('sur échec réseau, ne marque QUE ce qui est parti (pas de doublon au prochain run)', async () => {
    const pending = [listing({ id: 'a' }), listing({ id: 'b' }), listing({ id: 'c' })];
    const { repo, marked } = fakeRepo(pending);
    // Le 2e envoi échoue.
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return new Response('', { status: call === 2 ? 500 : 200 });
    }) as unknown as typeof fetch;

    const report = await notifyNewListings({ repository: repo, config: CONFIG, logger, fetchImpl });
    expect(report.sent).toBe(1);
    expect(marked).toEqual(['a']);
  });
});

describe('editRentedTelegramMessages', () => {
  const logger = createLogger({ minLevel: 'error' });

  type Pending = {
    chatId: string;
    messageId: number;
    title: string | null;
    reason?: 'rented' | 'inactive';
  };
  function fakeRepo(pending: Pending[]): {
    repo: Repository;
    edited: { chatId: string; messageId: number }[];
  } {
    const edited: { chatId: string; messageId: number }[] = [];
    const repo = {
      unavailableTelegramMessages: vi.fn(async () =>
        pending.map((p) => ({ ...p, reason: p.reason ?? ('rented' as const) })),
      ),
      markTelegramRentedEdited: vi.fn(async (chatId: string, messageId: number) => {
        edited.push({ chatId, messageId });
      }),
    } as unknown as Repository;
    return { repo, edited };
  }

  it('édite la légende du message loué et le marque traité', async () => {
    const { repo, edited } = fakeRepo([{ chatId: '123', messageId: 42, title: 'T2 Nice' }]);
    const fetchImpl = okFetch();
    const count = await editRentedTelegramMessages({
      repository: repo,
      config: CONFIG,
      logger,
      fetchImpl,
    });
    expect(count).toBe(1);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(calls[0]?.[0])).toContain('editMessageCaption');
    const body = JSON.parse(calls[0]?.[1]?.body as string) as {
      caption: string;
      message_id: number;
    };
    expect(body.caption).toContain('LOUÉ');
    expect(body.caption).toContain('T2 Nice');
    expect(body.message_id).toBe(42);
    expect(edited).toEqual([{ chatId: '123', messageId: 42 }]);
  });

  it('édite « Plus disponible » quand l’annonce a disparu (inactive)', async () => {
    const { repo } = fakeRepo([
      { chatId: '123', messageId: 50, title: 'Studio', reason: 'inactive' },
    ]);
    const fetchImpl = okFetch();
    const count = await editRentedTelegramMessages({
      repository: repo,
      config: CONFIG,
      logger,
      fetchImpl,
    });
    expect(count).toBe(1);
    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string,
    ) as { caption: string };
    expect(body.caption).toContain('Plus disponible');
    expect(body.caption).not.toContain('LOUÉ');
  });

  it('bascule sur editMessageText si la légende échoue (message texte)', async () => {
    const { repo } = fakeRepo([{ chatId: '123', messageId: 7, title: null }]);
    // editMessageCaption échoue (message sans média), editMessageText réussit.
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('editMessageCaption')
        ? new Response('{"ok":false}', { status: 400 })
        : new Response('{"ok":true}', { status: 200 }),
    ) as unknown as typeof fetch;
    const count = await editRentedTelegramMessages({
      repository: repo,
      config: CONFIG,
      logger,
      fetchImpl,
    });
    expect(count).toBe(1);
    const urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(urls.some((u) => u.includes('editMessageCaption'))).toBe(true);
    expect(urls.some((u) => u.includes('editMessageText'))).toBe(true);
  });

  it('marque traité même si l’édition échoue (évite de boucler)', async () => {
    const { repo, edited } = fakeRepo([{ chatId: '123', messageId: 9, title: 'X' }]);
    const failing = vi.fn(async () => new Response('{"ok":false}', { status: 400 }));
    const count = await editRentedTelegramMessages({
      repository: repo,
      config: CONFIG,
      logger,
      fetchImpl: failing as unknown as typeof fetch,
    });
    expect(count).toBe(0);
    expect(edited).toEqual([{ chatId: '123', messageId: 9 }]);
  });

  it('ne fait rien sans message loué en attente', async () => {
    const { repo } = fakeRepo([]);
    const fetchImpl = okFetch();
    const count = await editRentedTelegramMessages({
      repository: repo,
      config: CONFIG,
      logger,
      fetchImpl,
    });
    expect(count).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
