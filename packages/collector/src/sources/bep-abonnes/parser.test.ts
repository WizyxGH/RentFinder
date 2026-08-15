import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../../normalization/normalize.js';
import { parseBulletin } from './parser.js';

const FIXTURE = readFileSync(
  join(import.meta.dirname, '../../../../../tests/fixtures/bep-abonnes/bulletin.html'),
  'utf8',
);

const NOW = Date.parse('2026-08-15T12:00:00.000Z');

describe('parseBulletin — bulletin abonné BEP', () => {
  const { listings, warnings } = parseBulletin(FIXTURE);

  it('extrait chaque annonce du bulletin', () => {
    expect(warnings).toHaveLength(0);
    expect(listings.map((l) => l.sourceRef)).toEqual(['9000001', '9000002', '9000003']);
  });

  it('extrait loyer, surface, type, DPE et date de bulletin', () => {
    const t2 = listings.find((l) => l.sourceRef === '9000001');
    expect(t2?.priceText).toMatch(/690/);
    expect(t2?.areaText).toBe('42 M²');
    expect(t2?.cityText).toBe('NICE CENTRE / GAMBETTA');
    expect(t2?.extra?.['dpe']).toBe('D');
    expect(t2?.publishedAtText).toBe('2026-08-13');
    expect(t2?.imageUrls?.[0]).toMatch(/beptransaction\.com/);
  });

  it('normalise correctement une annonce niçoise (charges comprises, §16)', () => {
    const t2 = listings.find((l) => l.sourceRef === '9000001');
    if (t2 === undefined) throw new Error('annonce absente');
    const n = normalizeListing(t2, { sourceId: 'bep-abonnes', nowMs: NOW });
    expect(n?.price).toBe(690);
    expect(n?.area).toBe(42);
    expect(n?.dpe).toBe('D');
    expect(n?.propertyType).toBe('apartment');
    expect(n?.city).toContain('nice');
  });

  it('conserve les annonces hors Nice (le filtrage est fait au scoring)', () => {
    // Grasse est bien extraite ; c'est le score de match (ville) qui l'écarte.
    const grasse = listings.find((l) => l.sourceRef === '9000002');
    expect(grasse?.cityText).toBe('GRASSE CENTRE');
  });

  it('détecte la colocation dans la description (§16)', () => {
    const coloc = listings.find((l) => l.sourceRef === '9000003');
    if (coloc === undefined) throw new Error('annonce absente');
    const n = normalizeListing(coloc, { sourceId: 'bep-abonnes', nowMs: NOW });
    expect(n?.flatShare).toBe(true);
  });
});
