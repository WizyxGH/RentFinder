import { describe, expect, it } from 'vitest';
import { loadVapidConfig, pushContentFor } from './web-push.js';

const listing = (over: Record<string, unknown> = {}): never =>
  ({
    id: 'l1',
    price: 650,
    area: 22,
    city: 'nice',
    ...over,
  }) as never;

describe('loadVapidConfig', () => {
  it('rend null tant que le canal n’est pas configuré', () => {
    // Sans clés, le push reste silencieusement inactif — comme Telegram.
    expect(loadVapidConfig({})).toBeNull();
    expect(loadVapidConfig({ VAPID_PUBLIC_KEY: 'abc' })).toBeNull();
    expect(loadVapidConfig({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: 'x' })).toBeNull();
  });

  it('lit les clés et se donne un sujet par défaut', () => {
    const config = loadVapidConfig({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' });
    expect(config).toEqual({
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:rentfinder@example.invalid',
    });
  });
});

describe('pushContentFor', () => {
  const SITE = 'https://exemple.invalid/';

  it('détaille une annonce unique', () => {
    const content = pushContentFor([listing()], SITE);
    expect(content.title).toBe('Nouvelle annonce');
    expect(content.body).toBe('650 € · 22 m² · nice');
    expect(content.tag).toBe('rentfinder-l1');
  });

  it('résume quand il y en a plusieurs', () => {
    // Trois notifications empilées seraient noyées ; une seule invite à ouvrir.
    const content = pushContentFor([listing(), listing({ id: 'l2' })], SITE);
    expect(content.title).toBe('2 nouvelles annonces');
    expect(content.tag).toBe('rentfinder-lot');
  });

  it('omet les champs absents plutôt que d’écrire un vide (§17)', () => {
    const content = pushContentFor([listing({ price: null, area: null })], SITE);
    expect(content.body).toBe('nice');
  });
});
