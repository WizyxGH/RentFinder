import { describe, expect, it, vi } from 'vitest';
import type { NotifiableListing, Repository } from '../db/repository.js';
import type { TelegramConfig } from '../config.js';
import { createLogger } from '../core/logger.js';
import { formatListingMessage, notifyNewListings, sendTelegramMessage } from './telegram.js';

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
    actionPriority: pick('actionPriority', 80),
    url: pick('url', 'https://exemple.fr/annonce/1'),
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
    expect(msg).toContain('📍 nice 06000');
    expect(msg).toContain('Priorité 80');
  });

  it('échappe le HTML du titre (§62)', () => {
    const msg = formatListingMessage(listing({ id: 'a', title: 'T2 <script> & co' }));
    expect(msg).toContain('T2 &lt;script&gt; &amp; co');
    expect(msg).not.toContain('<script>');
  });

  it('omet les champs inconnus plutôt que d’inventer (§17)', () => {
    const msg = formatListingMessage(
      listing({ id: 'a', price: null, area: null, rooms: null, url: null, postalCode: null }),
    );
    expect(msg).not.toContain('€');
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
