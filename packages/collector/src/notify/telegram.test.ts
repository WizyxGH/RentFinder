import { describe, expect, it, vi } from 'vitest';
import type { NotifiableListing, Repository } from '../db/repository.js';
import type { TelegramConfig } from '../config.js';
import { createLogger } from '../core/logger.js';
import {
  editRentedTelegramMessages,
  formatListingMessage,
  notifyNewListings,
  notifySourceHealth,
  sendTelegramListing,
  sendTelegramMessage,
} from './telegram.js';
import type { SourceHealthTransition } from '../pipeline.js';

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

  it('plusieurs photos → album (bloc groupé) + message détail avec bouton', async () => {
    const fetchImpl = okFetch();
    const urls = Array.from({ length: 5 }, (_, i) => `https://img.exemple/${i}.jpg`);
    await sendTelegramListing(CONFIG, listing({ id: 'a', photoUrls: urls }), fetchImpl);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    // 1) album des 5 photos (un bloc), 2) message détail avec bouton.
    expect(calls).toHaveLength(2);
    expect(String(calls[0]?.[0])).toContain('sendMediaGroup');
    const album = JSON.parse(calls[0]?.[1]?.body as string) as { media: unknown[] };
    expect(album.media).toHaveLength(5);
    expect(String(calls[1]?.[0])).toContain('sendMessage');
    const details = JSON.parse(calls[1]?.[1]?.body as string) as { reply_markup: unknown };
    expect(details.reply_markup).toBeDefined();
  });

  it('borne l’album à 10 photos et signale le surplus dans le détail', async () => {
    const fetchImpl = okFetch();
    const urls = Array.from({ length: 14 }, (_, i) => `https://img.exemple/${i}.jpg`);
    await sendTelegramListing(CONFIG, listing({ id: 'a', photoUrls: urls }), fetchImpl);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const album = JSON.parse(calls[0]?.[1]?.body as string) as { media: unknown[] };
    expect(album.media).toHaveLength(10);
    const details = JSON.parse(calls[1]?.[1]?.body as string) as { text: string };
    expect(details.text).toContain('14 photos');
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

  it('chaque annonce multi-photos → un album + un message détail', async () => {
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
    // 3 annonces → 3 albums + 3 messages détail (2 messages par annonce).
    expect(urls.filter((u) => u.includes('sendMediaGroup'))).toHaveLength(3);
    expect(urls.filter((u) => u.includes('sendMessage'))).toHaveLength(3);
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

  function fakeRepo(pending: { chatId: string; messageId: number; title: string | null }[]): {
    repo: Repository;
    edited: { chatId: string; messageId: number }[];
  } {
    const edited: { chatId: string; messageId: number }[] = [];
    const repo = {
      rentedTelegramMessages: vi.fn(async () => pending),
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

describe('notifySourceHealth', () => {
  const logger = createLogger({ minLevel: 'error' });
  const t = (over: Partial<SourceHealthTransition>): SourceHealthTransition => ({
    sourceId: 'x',
    from: 'healthy',
    to: 'degraded',
    listingsFound: 0,
    error: null,
    ...over,
  });

  it('alerte sur dégradation, blocage et rétablissement — un seul message', async () => {
    const fetchImpl = okFetch();
    const count = await notifySourceHealth(
      CONFIG,
      [
        t({ sourceId: 'mirabello', from: 'healthy', to: 'degraded' }),
        t({ sourceId: 'seloger', from: 'healthy', to: 'blocked', error: 'accès refusé' }),
        t({ sourceId: 'citya', from: 'degraded', to: 'healthy' }),
      ],
      logger,
      fetchImpl,
    );
    expect(count).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string,
    ) as { text: string };
    expect(body.text).toContain('mirabello');
    expect(body.text).toContain('dégradée');
    expect(body.text).toContain('seloger');
    expect(body.text).toContain('bloquée');
    expect(body.text).toContain('citya');
    expect(body.text).toContain('rétablie');
  });

  it('ignore les mises au repos (429/cooldown) et les non-changements pertinents', async () => {
    const fetchImpl = okFetch();
    const count = await notifySourceHealth(
      CONFIG,
      [
        t({ sourceId: 'a', from: 'healthy', to: 'cooldown' }),
        // Déjà dégradée et le reste : pas de nouvelle alerte.
        t({ sourceId: 'b', from: 'degraded', to: 'blocked' }),
      ],
      logger,
      fetchImpl,
    );
    // Seule la bascule dégradée→bloquée compte (b était déjà en mauvais état,
    // mais bloquée est une aggravation notable) ; cooldown est ignoré.
    expect(count).toBe(1);
  });

  it('ne poste rien quand aucune transition n’est notable', async () => {
    const fetchImpl = okFetch();
    const count = await notifySourceHealth(
      CONFIG,
      [t({ from: 'healthy', to: 'cooldown' })],
      logger,
      fetchImpl,
    );
    expect(count).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
