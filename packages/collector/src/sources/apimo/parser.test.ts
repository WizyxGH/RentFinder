import { describe, expect, it } from 'vitest';
import { parseDetailPage } from './parser.js';

const AGENCY = 'Agence Test';

/** Fiche résidentielle minimale (JSON-LD @graph Apartment + Offer). */
function residentialHtml(extra = ''): string {
  return `<!DOCTYPE html><html><head>
    <script type="application/ld+json">${JSON.stringify({
      '@graph': [
        { '@type': 'RealEstateAgent', name: 'Agence' },
        {
          '@type': 'Apartment',
          name: 'Beau T2',
          numberOfRooms: 2,
          floorSize: { value: 30 },
          offers: { price: 650 },
          address: { addressLocality: 'Nice', postalCode: '06000' },
        },
      ],
    })}</script></head><body>${extra}</body></html>`;
}

const RESIDENTIAL_URL = 'https://exemple.fr/fr/propriete/location+appartement+nice+beau-t2+123456';
const COMMERCE_URL =
  'https://exemple.fr/fr/propriete/location+commerce+nice+local-atelier+84747869';

describe('parseDetailPage — garde-fous (§3, §17)', () => {
  it('garde une location résidentielle disponible', () => {
    const { listing } = parseDetailPage(residentialHtml(), RESIDENTIAL_URL, AGENCY);
    expect(listing).not.toBeNull();
    expect(listing?.priceText).toContain('650');
  });

  it('écarte un bien à usage commercial (slug d’URL)', () => {
    const { listing, warnings } = parseDetailPage(residentialHtml(), COMMERCE_URL, AGENCY);
    expect(listing).toBeNull();
    expect(warnings.join(' ')).toMatch(/commercial/i);
  });

  it('écarte un bien à usage commercial (type JSON-LD CommercialProperty)', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@graph': [{ '@type': 'CommercialProperty', name: 'Local', offers: { price: 560 } }],
    })}</script>`;
    const { listing } = parseDetailPage(html, RESIDENTIAL_URL, AGENCY);
    expect(listing).toBeNull();
  });

  it('écarte un bien affiché « déjà Loué »', () => {
    const html = residentialHtml(
      '<div class="propertySold"><p class="sticker">déjà Loué</p></div>',
    );
    const { listing, warnings } = parseDetailPage(html, RESIDENTIAL_URL, AGENCY);
    expect(listing).toBeNull();
    expect(warnings.join(' ')).toMatch(/lou[ée]|vendu/i);
  });
});
