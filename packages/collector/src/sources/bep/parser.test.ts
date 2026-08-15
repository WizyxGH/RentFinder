import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { parsePhone } from '../../normalization/parse-listing-fields.js';
import { parseDetailPage, parseListingUrl, parseSitemap, parseSitemapIndex } from './parser.js';

const FIXTURES = join(import.meta.dirname, '../../../../../tests/fixtures/bep');

const sitemapXml = readFileSync(join(FIXTURES, 'sitemap-1.xml'), 'utf8');
const detailHtml = readFileSync(join(FIXTURES, 'detail-90000001.html'), 'utf8');
const degradedHtml = readFileSync(join(FIXTURES, 'detail-degraded.html'), 'utf8');

const DETAIL_URL =
  'https://bep-logement.com/fr/propriete/location+appartement+nice+studio-meuble-fictif-centre+90000001';

describe('parseListingUrl', () => {
  it('décompose une URL de fiche location', () => {
    const parsed = parseListingUrl(DETAIL_URL);
    expect(parsed).not.toBeNull();
    expect(parsed?.transaction).toBe('location');
    expect(parsed?.typeSlug).toBe('appartement');
    expect(parsed?.citySlug).toBe('nice');
    expect(parsed?.reference).toBe('90000001');
  });

  it('reconnaît une ville à tirets', () => {
    const parsed = parseListingUrl(
      'https://bep-logement.com/fr/propriete/location+appartement+saint-laurent-du-var+deux-pieces-fictif-vue-mer+90000002',
    );
    expect(parsed?.citySlug).toBe('saint-laurent-du-var');
    expect(parsed?.reference).toBe('90000002');
  });

  it('gère une URL sans slug descriptif (ville puis référence)', () => {
    // Observé en réel : /fr/propriete/location+appartement+nice+84308912
    const parsed = parseListingUrl(
      'https://bep-logement.com/fr/propriete/location+appartement+nice+84308912',
    );
    expect(parsed?.citySlug).toBe('nice');
    expect(parsed?.reference).toBe('84308912');
  });

  it('identifie les ventes et rejette les autres pages', () => {
    const vente = parseListingUrl(
      'https://bep-logement.com/fr/propriete/vente+appartement+nice+quatre-pieces-fictif-a-vendre+90000004',
    );
    expect(vente?.transaction).toBe('vente');
    expect(parseListingUrl('https://bep-logement.com/fr/locations')).toBeNull();
    expect(parseListingUrl('https://bep-logement.com/fr/')).toBeNull();
  });
});

describe('parseSitemap', () => {
  const entries = parseSitemap(sitemapXml);

  it('extrait uniquement les fiches de location, CDATA compris', () => {
    // 4 fiches location dans la fixture (la vente et les pages sont exclues).
    expect(entries).toHaveLength(4);
    expect(entries.every((entry) => entry.url.transaction === 'location')).toBe(true);
  });

  it('conserve le lastmod de chaque fiche', () => {
    const nice = entries.find((entry) => entry.url.reference === '90000001');
    expect(nice?.lastmod).toBe('2026-08-14');
  });

  it("parse l'index de sitemaps", () => {
    const index = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://bep-logement.com/sitemap-1.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemapIndex(index)).toEqual(['https://bep-logement.com/sitemap-1.xml']);
  });
});

describe('parseDetailPage — fiche nominale (JSON-LD)', () => {
  const { listing, warnings } = parseDetailPage(detailHtml, DETAIL_URL);

  it('extrait la fiche sans warning', () => {
    expect(listing).not.toBeNull();
    expect(warnings).toHaveLength(0);
  });

  it('préfère le prix AFFICHÉ (charges comprises) au prix JSON hors charges', () => {
    expect(listing?.priceText).toBe('690 € / Mois (Charges comprises)');
  });

  it('extrait les caractéristiques depuis le JSON-LD', () => {
    expect(listing?.title).toBe('Studio Meublé Fictif Centre');
    expect(listing?.areaText).toBe('21 m²');
    expect(listing?.roomsText).toBe('1 pièces');
    expect(listing?.cityText).toBe('Nice');
    expect(listing?.postalCodeText).toBe('06000');
    expect(listing?.publishedAtText).toBe('2026-08-14');
  });

  it("extrait les coordonnées d'agence publiées (§21)", () => {
    expect(listing?.agencyName).toBe('BEP AGENCE FICTIVE');
    expect(listing?.phoneText).toBe('+33-0600000012');
    expect(listing?.emailText).toBe('agence@example.invalid');
  });

  it('conserve les URLs d’images sans les télécharger (§11)', () => {
    expect(listing?.imageUrls).toHaveLength(2);
    expect(listing?.imageUrls?.[0]).toContain('example.invalid');
  });
});

describe('parseDetailPage — chaîne complète avec la normalisation', () => {
  const NOW = Date.parse('2026-08-15T12:00:00.000Z');

  it('produit une occurrence typée, meublée, dans les critères', () => {
    const { listing } = parseDetailPage(detailHtml, DETAIL_URL);
    if (listing === null) throw new Error('fiche absente');
    const normalized = normalizeListing(listing, { sourceId: 'bep', nowMs: NOW });
    expect(normalized).not.toBeNull();
    expect(normalized?.price).toBe(690);
    expect(normalized?.chargesIncluded).toBe(true);
    expect(normalized?.area).toBe(21);
    expect(normalized?.rooms).toBe(1);
    expect(normalized?.city).toBe('nice');
    expect(normalized?.furnished).toBe(true);
    // Le téléphone « +33-0600000012 » du JSON-LD est normalisé en E.164.
    expect(normalized?.contact.phone).toBe('+33600000012');
    expect(normalized?.contact.email).toBe('agence@example.invalid');
  });
});

describe('parseDetailPage — fiche dégradée (sans JSON-LD)', () => {
  const { listing, warnings } = parseDetailPage(
    degradedHtml,
    'https://bep-logement.com/fr/propriete/location+appartement+saint-laurent-du-var+deux-pieces-fictif-vue-mer+90000002',
  );

  it('se replie sur le HTML et le signale', () => {
    expect(listing).not.toBeNull();
    expect(warnings.some((w) => w.includes('JSON-LD'))).toBe(true);
  });

  it('lit prix, pièces et ville depuis le HTML et l’URL', () => {
    expect(listing?.priceText).toBe('700 € / Mois');
    expect(listing?.roomsText).toBe('2 pièces');
    expect(listing?.cityText).toBe('saint laurent du var');
    expect(listing?.areaText).toBeUndefined();
    expect(listing?.phoneText).toBeUndefined();
  });
});

describe('parsePhone — format « +33-0X » des JSON-LD Apimo (§51)', () => {
  it('normalise l’indicatif accolé au 0 national', () => {
    expect(parsePhone('+33-0600000012')).toBe('+33600000012');
    expect(parsePhone('+33-0600000034')).toBe('+33600000034');
  });
});
