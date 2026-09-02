import { describe, expect, it } from 'vitest';
import { loadVapidConfig, pushContentFor } from './web-push.js';

const listing = (over: Record<string, unknown> = {}): never =>
  ({
    id: 'l1',
    price: 650,
    area: 22,
    city: 'nice',
    rooms: null,
    district: null,
    phone: null,
    photoUrls: [],
    title: null,
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

  it('donne de quoi décider SANS ouvrir : loyer, surface, lieu, téléphone', () => {
    const content = pushContentFor(
      [listing({ title: 'Studio Gambetta', rooms: 1, district: 'Gambetta', phone: '0600000012' })],
      SITE,
    );
    expect(content.title).toBe('Studio Gambetta');
    expect(content.body).toContain('650 € · 22 m² · 1 pièce');
    expect(content.body).toContain('Gambetta');
    expect(content.body).toContain('0600000012');
  });

  it('joint la photo et l’identifiant, pour l’image et le bouton Favori', () => {
    // Android s'en sert ; iOS les ignore et n'affiche que titre et texte.
    const content = pushContentFor(
      [listing({ photoUrls: ['https://exemple.invalid/photo.jpg'] })],
      SITE,
    );
    expect(content.image).toBe('https://exemple.invalid/photo.jpg');
    expect(content.listingId).toBe('l1');
    expect(content.url).toContain('listing=l1');
  });

  it('n’invente pas de photo quand la source n’en publie pas (§17)', () => {
    expect(pushContentFor([listing({ photoUrls: [] })], SITE).image).toBeUndefined();
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
