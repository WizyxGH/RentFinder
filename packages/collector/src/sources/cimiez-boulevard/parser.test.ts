/**
 * Deux pièges portent tout le risque de cette source : la description TRONQUÉE
 * du JSON-LD, qu'il ne faut pas prendre pour la vraie, et les pages d'annonces
 * retirées, qui renvoient l'écran de recherche au lieu d'une erreur.
 */

import { describe, expect, it } from 'vitest';
import { parseFullDescription, parseListingUrl, parseSitemap } from './parser.js';

const URL_FICHE =
  'https://cimiez-boulevard.fr/properties/nice/cimiez/location/appartement-4-pieces-118m2-fr2182957';

describe('parseListingUrl', () => {
  it('lit la ville, le QUARTIER, le type et la référence', () => {
    // Le quartier vient de l'adresse : aucune autre source ne le donne aussi
    // franchement, et sa couverture plafonne à 16 % ailleurs.
    expect(parseListingUrl(URL_FICHE)).toEqual({
      citySlug: 'nice',
      districtSlug: 'cimiez',
      transaction: 'location',
      typeSlug: 'appartement',
      reference: '2182957',
      canonicalUrl: URL_FICHE,
    });
  });

  it('écarte ce qui n’est pas une fiche', () => {
    expect(parseListingUrl('https://cimiez-boulevard.fr/location-appartement-nice')).toBeNull();
    expect(parseListingUrl('https://cimiez-boulevard.fr/')).toBeNull();
    expect(parseListingUrl('pas une url')).toBeNull();
  });

  it('retire l’ancre et la chaîne de requête de l’adresse canonique', () => {
    const parsed = parseListingUrl(`${URL_FICHE}?utm=x#photos`);
    expect(parsed?.canonicalUrl).toBe(URL_FICHE);
  });
});

describe('parseSitemap', () => {
  it('ne garde que les LOCATIONS, pas les ventes ni les pages de recherche', () => {
    const xml = `<urlset>
      <url><loc>${URL_FICHE}</loc></url>
      <url><loc>https://cimiez-boulevard.fr/properties/nice/cimiez/vente/appartement-3-pieces-80m2-fr99</loc></url>
      <url><loc>https://cimiez-boulevard.fr/location-appartement-nice</loc></url>
    </urlset>`;
    const entries = parseSitemap(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.reference).toBe('2182957');
  });
});

describe('parseFullDescription', () => {
  it('déplie les deux couches d’échappement et rend les sauts de ligne', () => {
    // Le texte est échappé en JavaScript PUIS en HTML. Sans les sauts de
    // ligne, « Loyer mensuel », « Caution » et « Honoraires » se colleraient.
    const html = `<div x-data="{ descriptionText: 'Location non meubl\u00e9e.\u003Cbr \u002F\u003E\nLoyer mensuel : 1 840 \u20ac (dont 440 \u20ac de charges)', maxLength: 500 }">`;
    const text = parseFullDescription(html);
    expect(text).toContain('Location non meublée.');
    expect(text).toContain('dont 440 € de charges');
    expect(text?.split('\n').length).toBeGreaterThan(1);
  });

  it('renvoie rien quand l’expression est absente', () => {
    // C'est le cas des annonces retirées : le site sert son écran de
    // recherche, sans JSON-LD ni description.
    expect(parseFullDescription('<html><title>Recherche</title></html>')).toBeUndefined();
  });
});
