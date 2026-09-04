import { describe, expect, it } from 'vitest';
import {
  goneContentFor,
  loadVapidConfig,
  pushContentFor,
  pushContentsFor,
  reminderContentFor,
} from './web-push.js';
import type { NotifiableListing } from '../db/repository.js';

const listing = (over: Record<string, unknown> = {}): never =>
  ({
    id: 'l1',
    title: null,
    price: 650,
    area: 22,
    rooms: null,
    city: 'nice',
    postalCode: null,
    address: null,
    district: null,
    availableAt: null,
    actionPriority: 70,
    url: null,
    photoUrls: [],
    sourceId: null,
    phone: null,
    ...over,
  }) as never;

describe('loadVapidConfig', () => {
  it('rend null tant que le canal n’est pas configuré', () => {
    // Sans clés, le canal reste silencieusement inactif.
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
      listing({ title: 'Studio Gambetta', rooms: 1, district: 'Gambetta', phone: '0600000012' }),
      SITE,
    );
    expect(content.title).toBe('Studio Gambetta');
    expect(content.body).toContain('650 € · 22 m² · 1 pièce');
    expect(content.body).toContain('Gambetta');
    expect(content.body).toContain('0600000012');
  });

  it('porte de quoi décider sans ouvrir : adresse, dispo, origine, priorité', () => {
    // Le canal se contentait d'un titre et de deux lignes — ces quatre-là sont
    // ce qui manquait pour agir depuis la notification.
    const content = pushContentFor(
      listing({
        address: 'Rue Smolett',
        postalCode: '06300',
        availableAt: new Date(Date.now() + 86_400_000).toISOString(),
        sourceId: 'dinamy',
        actionPriority: 94,
      }),
      SITE,
    );
    expect(content.body).toContain('Rue Smolett, 06300 Nice');
    expect(content.body).toContain('Dispo maintenant');
    expect(content.body).toContain('via Dinamy Immobilier');
    expect(content.body).toContain('Priorité 94/100');
  });

  it('joint la photo, l’identifiant et le téléphone, pour l’image et les boutons', () => {
    // Android s'en sert ; iOS les ignore et n'affiche que titre et texte.
    const content = pushContentFor(
      listing({ photoUrls: ['https://exemple.invalid/photo.jpg'], phone: '0600000012' }),
      SITE,
    );
    expect(content.image).toBe('https://exemple.invalid/photo.jpg');
    expect(content.listingId).toBe('l1');
    expect(content.phone).toBe('0600000012');
    // L'adresse MÈNE À LA FICHE. Elle pointait sur `?listing=<id>`, que rien
    // ne lisait côté site : toucher la notification ouvrait l'accueil, et il
    // fallait retrouver à la main l'annonce dont on venait d'être prévenu.
    expect(content.url).toContain('/annonce/l1');
  });

  it('n’invente ni photo ni téléphone quand la source n’en publie pas (§17)', () => {
    const content = pushContentFor(listing({ photoUrls: [] }), SITE);
    expect(content.image).toBeUndefined();
    expect(content.phone).toBeUndefined();
  });

  it('omet les champs absents plutôt que d’écrire un vide (§17)', () => {
    const content = pushContentFor(listing({ price: null, area: null }), SITE);
    expect(content.body.split('\n')).toEqual(['📍 Nice', '⭐ Priorité 70/100']);
  });
});

describe('pushContentsFor', () => {
  const SITE = 'https://exemple.invalid/';

  it('détaille chaque annonce plutôt que d’annoncer un décompte', () => {
    // « 2 nouvelles annonces » obligeait à ouvrir le site pour savoir quoi que
    // ce soit — l'inverse de ce qu'une alerte doit faire.
    const contents = pushContentsFor([listing(), listing({ id: 'l2', price: 700 })], SITE);
    expect(contents).toHaveLength(2);
    expect(contents[0]?.tag).toBe('rentfinder-l1');
    expect(contents[1]?.body).toContain('700 €');
  });

  it('résume le surplus au-delà de quatre, pour ne pas noyer', () => {
    const many = Array.from({ length: 7 }, (_v, i) => listing({ id: `l${i}` }));
    const contents = pushContentsFor(many, SITE);
    expect(contents).toHaveLength(5);
    expect(contents[4]?.title).toBe('+ 3 autres annonces');
    expect(contents[4]?.tag).toBe('rentfinder-lot');
  });
});

describe('les autres familles d’alertes', () => {
  const suivi: NotifiableListing = {
    id: 'l9',
    title: 'Studio Libération',
    price: 690,
    area: 28,
    rooms: 1,
    city: 'Nice',
    postalCode: '06000',
    address: null,
    district: 'Libération',
    availableAt: null,
    actionPriority: 80,
    url: 'https://exemple.invalid/a/9',
    photoUrls: [],
    sourceId: 'demo',
    phone: '0600000012',
  };

  it('dit qu’un favori a disparu, et mène à sa fiche', () => {
    const content = goneContentFor(suivi, 'https://exemple.invalid/');

    expect(content.title).toMatch(/plus disponible/i);
    expect(content.body).toContain('Studio Libération');
    expect(content.url).toContain('/annonce/l9');
    // Une étiquette DISTINCTE de l'alerte « nouvelle annonce » : sinon la
    // seconde remplacerait la première dans le tiroir du téléphone.
    expect(content.tag).not.toBe(`rentfinder-${suivi.id}`);
  });

  it('rappelle une candidature en tête avec le téléphone sous la main', () => {
    const content = reminderContentFor(suivi, 'https://exemple.invalid/');

    expect(content.title).toMatch(/candidat/i);
    expect(content.phone).toBe('0600000012');
    expect(content.body).toContain('0600000012');
    expect(content.tag).not.toBe(goneContentFor(suivi, 'https://exemple.invalid/').tag);
  });
});
