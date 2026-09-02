import { describe, expect, it } from 'vitest';
import type { ListingView } from './types.js';
import { byRecency, recencyMs } from './recency.js';

/** Fiche minimale : seuls les champs du tri comptent. */
function listing(over: {
  id: string;
  publishedAt?: string | null;
  firstSeenAt?: string;
  lastSeenAt?: string;
  actionPriority?: number;
}): ListingView {
  return {
    id: over.id,
    publishedAt: { value: over.publishedAt ?? null },
    firstSeenAt: over.firstSeenAt ?? '2026-09-01T12:00:00.000Z',
    lastSeenAt: over.lastSeenAt ?? '2026-09-02T12:00:00.000Z',
    actionPriority: over.actionPriority ?? 50,
  } as unknown as ListingView;
}

describe('recencyMs', () => {
  it('préfère la publication, qui est la date affichée par la carte', () => {
    const l = listing({ id: 'a', publishedAt: '2026-08-20T09:00:00.000Z' });
    expect(recencyMs(l)).toBe(Date.parse('2026-08-20T09:00:00.000Z'));
  });

  it('retombe sur la découverte quand la source ne publie pas de date (§17)', () => {
    const l = listing({ id: 'a', publishedAt: null, firstSeenAt: '2026-08-25T09:00:00.000Z' });
    expect(recencyMs(l)).toBe(Date.parse('2026-08-25T09:00:00.000Z'));
  });

  it('ne prend JAMAIS lastSeenAt : c’est une date de collecte, pas d’annonce', () => {
    // Le point de la correction : 779 fiches ne portaient que 16 valeurs de
    // lastSeenAt, une par passage — le tri rendait seize paquets informes.
    const vieille = listing({
      id: 'vieille',
      publishedAt: '2026-08-01T09:00:00.000Z',
      lastSeenAt: '2026-09-02T18:00:00.000Z',
    });
    const recente = listing({
      id: 'recente',
      publishedAt: '2026-09-01T09:00:00.000Z',
      lastSeenAt: '2026-09-02T08:00:00.000Z',
    });
    // `vieille` a été revue plus récemment, mais publiée bien avant.
    expect([vieille, recente].sort(byRecency).map((l) => l.id)).toEqual(['recente', 'vieille']);
  });
});

describe('byRecency', () => {
  it('classe du plus récent au plus ancien', () => {
    const ordre = [
      listing({ id: 'b', publishedAt: '2026-08-20T09:00:00.000Z' }),
      listing({ id: 'a', publishedAt: '2026-09-01T09:00:00.000Z' }),
      listing({ id: 'c', publishedAt: '2026-07-01T09:00:00.000Z' }),
    ]
      .sort(byRecency)
      .map((l) => l.id);
    expect(ordre).toEqual(['a', 'b', 'c']);
  });

  it('départage les dates identiques par priorité, pas au hasard', () => {
    // Beaucoup d'annonces partagent leur date à la seconde près.
    const meme = '2026-09-01T09:00:00.000Z';
    const ordre = [
      listing({ id: 'basse', publishedAt: meme, actionPriority: 10 }),
      listing({ id: 'haute', publishedAt: meme, actionPriority: 90 }),
    ]
      .sort(byRecency)
      .map((l) => l.id);
    expect(ordre).toEqual(['haute', 'basse']);
  });

  it('range les annonces sans aucune date en dernier', () => {
    const sansDate = listing({ id: 'sans', publishedAt: null, firstSeenAt: 'pas-une-date' });
    const avec = listing({ id: 'avec', publishedAt: '2026-08-01T09:00:00.000Z' });
    expect([sansDate, avec].sort(byRecency).map((l) => l.id)).toEqual(['avec', 'sans']);
  });
});
