import { describe, expect, it } from 'vitest';
import { parseListPage } from './parser.js';

const PAGE =
  'https://www.lodgis.com/fr/france,location-meublee/location-meuble-france-6_20242.cat.html';

// Gabarit réel d'une carte Lodgis (Bootstrap) : titre, référence, surface,
// ville, prix, disponibilité.
const HTML = `
<div class="card card__appart">
  <a href="https://www.lodgis.com/fr/france,location-meublee/appartement/LPA26616-avenue-henry-dunan-appartement-france-6.mod.html">
    <img class="card-img-top" src="https://img.lodgis.com/p1.jpg" alt="Appartement meublé 3 chambres Nice" />
  </a>
  <div class="card-body pb-0"><div class="row"><div class="col-12">
    <p class="card-title card__appart__title">Appartement meublé 3 chambres</p>
    <p class="small card__appart__num"> n°40626616 </p>
    <div class="card-surface"> 73 m² </div>
    <p class="small card-text"> Nice </p>
  </div></div></div>
  <div class="card-body"><div class="row"><div class="col-9">
    <p class="card-text"> <span class="price">1 850 €</span> /mois </p>
    <p class="text-primary lead "> Disponible à partir du <span>31-08-2026</span> </p>
  </div></div></div>
</div>
<div class="card card__appart">
  <a href="https://www.lodgis.com/fr/france,location-meublee/appartement/LPA26747-avenue-jean-medecin-appartement-france-6.mod.html">voir</a>
  <div class="card-body"><p class="card__appart__title">Studio meublé</p>
  <div class="card-surface"> 18 m² </div><p class="small card-text"> Nice </p></div>
</div>`;

describe('parseListPage (Lodgis)', () => {
  const { listings } = parseListPage(HTML, PAGE, 'Lodgis');

  it('extrait une annonce par carte, référencée par le code de l’URL', () => {
    expect(listings).toHaveLength(2);
    expect(listings.map((l) => l.sourceRef).sort()).toEqual(['LPA26616', 'LPA26747']);
  });

  it('lit prix, surface, ville, chambres, dispo et la rue du slug', () => {
    const l = listings.find((x) => x.sourceRef === 'LPA26616');
    expect(l?.priceText).toContain('1 850');
    expect(l?.areaText).toBe('73 m²');
    expect(l?.cityText).toBe('Nice');
    expect(l?.roomsText).toBe('3 chambres');
    expect(l?.propertyTypeText).toMatch(/appartement/i);
    // Tout le stock Lodgis est meublé (c'est leur métier).
    expect(l?.furnishedText).toBe('meublé');
    expect(l?.availableAtText).toBe('31-08-2026');
    // La rue n'est pas publiée en clair mais nommée dans l'URL (§20).
    expect(l?.addressText).toBe('avenue henry dunan');
    expect(l?.imageUrls?.[0]).toContain('p1.jpg');
  });

  it('n’invente pas un prix absent (§17)', () => {
    const l = listings.find((x) => x.sourceRef === 'LPA26747');
    expect(l?.priceText).toBeUndefined();
    expect(l?.areaText).toBe('18 m²');
    expect(l?.roomsText).toMatch(/studio/i);
  });
});
