import { describe, expect, it } from 'vitest';
import type { RawListing } from '@rentfinder/shared';
import { SHORT_TERM_LEASE_FEATURE } from '@rentfinder/shared';
import { dedupeStreetAddress, normalizeListing, rederiveFromText } from './normalize.js';

describe('district (quartier)', () => {
  it('reprend le quartier de extra.quartier (ex. Orpi)', () => {
    const n = normalizeListing(
      raw({ cityText: 'nice', extra: { reference: 'r1', quartier: 'Madeleine' } }),
      OPTIONS,
    );
    expect(n?.district).toBe('Madeleine');
  });

  it('district null quand la source ne publie pas de quartier', () => {
    const n = normalizeListing(raw({ cityText: 'nice' }), OPTIONS);
    expect(n?.district).toBeNull();
  });
});

describe('dedupeStreetAddress — voie saisie en double par la source', () => {
  it('supprime la voie répétée et garde le numéro', () => {
    expect(dedupeStreetAddress('Rue Edouard Scoffier 28 Rue Edouard Scoffier')).toBe(
      '28 Rue Edouard Scoffier',
    );
  });

  it('laisse une adresse normale intacte', () => {
    expect(dedupeStreetAddress('28 Rue Edouard Scoffier')).toBe('28 Rue Edouard Scoffier');
    expect(dedupeStreetAddress('12 Avenue de la Californie')).toBe('12 Avenue de la Californie');
  });

  it('ne fusionne pas deux voies distinctes', () => {
    expect(dedupeStreetAddress('Avenue de la Gare 12 Boulevard Victor Hugo')).toBe(
      'Avenue de la Gare 12 Boulevard Victor Hugo',
    );
  });

  it('gère null', () => {
    expect(dedupeStreetAddress(null)).toBeNull();
  });
});

const OPTIONS = { sourceId: 'test', nowMs: Date.parse('2026-08-19T12:00:00Z') };

function raw(over: Partial<RawListing>): RawListing {
  return {
    sourceRef: 'ref1',
    sourceUrl: 'https://exemple.fr/location/nice/ref1',
    ...over,
  } as RawListing;
}

describe('normalizeListing — exclusion des ventes (§3)', () => {
  it('garde une location normale', () => {
    const result = normalizeListing(
      raw({ title: 'Appartement à louer 2 pièces', priceText: '700 € / mois' }),
      OPTIONS,
    );
    expect(result).not.toBeNull();
  });

  it('garde une location CHÈRE (loyer élevé, pas une vente)', () => {
    const result = normalizeListing(
      raw({ title: 'Villa à louer avec piscine', priceText: '8500 € / mois' }),
      OPTIONS,
    );
    expect(result).not.toBeNull();
  });

  it('écarte un bien à vendre (URL de vente)', () => {
    const result = normalizeListing(
      raw({ sourceUrl: 'https://exemple.fr/vente/nice/ref9', title: 'Appartement 3 pièces' }),
      OPTIONS,
    );
    expect(result).toBeNull();
  });

  it('écarte un bien à vendre (texte explicite, sans marqueur de location)', () => {
    const result = normalizeListing(
      raw({ title: 'Maison à vendre', description: 'Frais de notaire en sus' }),
      OPTIONS,
    );
    expect(result).toBeNull();
  });

  it('ne se laisse pas piéger : « proche des commerces » n’est pas une vente', () => {
    const result = normalizeListing(
      raw({
        title: 'Studio à louer',
        description: 'Proche des commerces et de la vente à emporter',
      }),
      OPTIONS,
    );
    expect(result).not.toBeNull();
  });
});

describe('rederiveFromText — rattrapage des annonces déjà en base', () => {
  /** Une occurrence telle qu'elle revient de la base. */
  const stored = (over: Record<string, unknown> = {}): never =>
    ({
      id: 'dinamy:30',
      title: 'Location meublée Appartement 1 pièce',
      description: 'Rue Smolett, tout proche du port, ce grand studio meublé.',
      address: null,
      propertyType: 'studio',
      features: ['Ascenseur', '2e étage'],
      ...over,
    }) as never;

  it('retrouve la rue restée dans la description', () => {
    // Le cas qui laissait 86 fiches sur 93 sans adresse : l'extraction ne
    // savait pas lire une voie sans numéro le jour de la collecte.
    expect(rederiveFromText(stored())?.address).toBe('Rue Smolett');
  });

  it('n’écrase JAMAIS une adresse publiée par la source', () => {
    expect(rederiveFromText(stored({ address: '12 Avenue de la Californie' }))).toBeNull();
  });

  it('ajoute le bail 9 mois sans perdre les atouts venus du scraper', () => {
    // Recalculer la liste entière les perdrait : « 2e étage » et « Ascenseur »
    // viennent d'attributs bruts que la base ne conserve pas.
    const corrected = rederiveFromText(
      stored({
        address: 'Rue Smolett',
        description: 'Etudiant de Septembre à juin au prix de 600 € cc',
      }),
    );
    expect(corrected?.features).toEqual(['Ascenseur', '2e étage', SHORT_TERM_LEASE_FEATURE]);
  });

  it('efface une adresse qui a mordu sur la phrase suivante', () => {
    // Elle reste fausse quelle qu'en soit la provenance : mieux vaut aucune
    // rue qu'une rue introuvable sur une carte (§17, §20).
    expect(
      rederiveFromText(
        stored({
          address: "10 Avenue Sainte-MargueriteAu sein d'une résidence",
          description: 'Studio calme et lumineux.',
        }),
      )?.address,
    ).toBeNull();
  });

  it('reclasse un logement que le mot « parking » avait fait écarter', () => {
    // 22 fiches sur 59 typées « parking » au 2026-09-03 étaient des logements.
    const corrected = rederiveFromText(
      stored({
        address: 'Rue Smolett',
        propertyType: 'parking',
        title: 'Studette de 20m² avec parking',
        description: 'Studio calme et lumineux.',
      }),
    );
    expect(corrected?.propertyType).toBe('studio');
  });

  it('ne rend rien quand il n’y a rien à corriger', () => {
    expect(
      rederiveFromText(
        stored({ address: 'Rue Smolett', description: 'Studio calme et lumineux.' }),
      ),
    ).toBeNull();
  });
});
