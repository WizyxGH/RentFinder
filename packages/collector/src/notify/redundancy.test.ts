import { describe, expect, it } from 'vitest';
import type { NotifiableListing } from '../db/repository.js';
import { dropRedundantNotifications } from './redundancy.js';

function listing(over: Partial<NotifiableListing> & { id: string }): NotifiableListing {
  return {
    title: null,
    price: 660,
    area: 29,
    rooms: 1,
    city: 'nice',
    postalCode: null,
    address: null,
    district: null,
    availableAt: null,
    actionPriority: 80,
    url: null,
    photoUrls: [],
    sourceId: 'savi-esteve',
    phone: null,
    ...over,
  };
}

describe('dropRedundantNotifications', () => {
  it('tait l’alerte e-mail quand une source directe est déjà en base', () => {
    const pending = [listing({ id: 'mail', sourceId: 'email-alerts', area: 29.4 })];
    // La clé arrondit la surface : 29,4 et 29 se rejoignent.
    const kept = dropRedundantNotifications(pending, new Set(['660|29|nice|1']));
    expect(kept).toEqual([]);
  });

  it('tait l’alerte e-mail quand la fiche directe arrive dans le MÊME lot', () => {
    // C'est le cas réel du 2026-09-03 : deux notifications à la même minute.
    const pending = [
      listing({ id: 'mail', sourceId: 'email-alerts', area: 29.4 }),
      listing({ id: 'direct', sourceId: 'savi-esteve', area: 29 }),
    ];
    expect(dropRedundantNotifications(pending, new Set()).map((l) => l.id)).toEqual(['direct']);
  });

  it('garde l’alerte e-mail quand aucune source directe ne décrit ce bien', () => {
    const pending = [listing({ id: 'mail', sourceId: 'email-alerts', price: 555 })];
    expect(dropRedundantNotifications(pending, new Set(['660|29|nice|1']))).toHaveLength(1);
  });

  it('rapproche aussi sans la ville — les e-mails ne la publient pas toujours', () => {
    const pending = [listing({ id: 'mail', sourceId: 'email-alerts', city: null })];
    expect(dropRedundantNotifications(pending, new Set(['660|29|1']))).toEqual([]);
  });

  it('ne tait JAMAIS deux fiches directes : elles peuvent être deux vrais biens', () => {
    const pending = [
      listing({ id: 'a', sourceId: 'citya' }),
      listing({ id: 'b', sourceId: 'fnaim' }),
    ];
    expect(dropRedundantNotifications(pending, new Set()).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('ne rapproche rien dans le vide : sans loyer ni surface, on notifie (§17)', () => {
    const pending = [listing({ id: 'mail', sourceId: 'email-alerts', price: null, area: null })];
    expect(dropRedundantNotifications(pending, new Set(['660|29|nice|1']))).toHaveLength(1);
  });
});
