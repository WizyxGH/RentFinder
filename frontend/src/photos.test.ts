import { afterEach, describe, expect, it, vi } from 'vitest';
import { splitPhotos } from './photos.js';

/** Change le protocole vu par le module, comme le ferait le navigateur. */
function servedOver(protocol: 'http:' | 'https:'): void {
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    protocol,
  } as Location);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('splitPhotos', () => {
  const urls = [
    'https://images.example.invalid/a.jpg',
    'http://www.beptransaction.com/bep/docs/b.jpg',
  ];

  it('sur une page https, met de côté ce que le navigateur bloquerait', () => {
    servedOver('https:');
    expect(splitPhotos(urls)).toEqual({
      embeddable: ['https://images.example.invalid/a.jpg'],
      linkOnly: ['http://www.beptransaction.com/bep/docs/b.jpg'],
    });
  });

  it('sur une page http, tout s’affiche — rien à mettre de côté', () => {
    servedOver('http:');
    expect(splitPhotos(urls)).toEqual({ embeddable: urls, linkOnly: [] });
  });

  it('ne perd aucune photo au passage', () => {
    servedOver('https:');
    const split = splitPhotos(urls);
    expect([...split.embeddable, ...split.linkOnly]).toHaveLength(urls.length);
  });
});
