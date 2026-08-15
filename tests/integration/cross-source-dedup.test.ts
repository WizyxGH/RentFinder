/**
 * Dédoublonnage croisé entre sources réelles (§47, §53 scénario 2).
 *
 * Ces tests utilisent les VRAIS parsers sur les VRAIES fixtures des deux
 * sources, puis la vraie chaîne normalisation → dédoublonnage. Ils vérifient
 * les deux directions du contrat :
 *
 *   1. ANTI-FUSION : deux logements différents mais très proches (même ville,
 *      même prix, même surface) ne doivent JAMAIS être fusionnés sans signal
 *      fort — fusionner à tort fait disparaître une annonce réelle (§14).
 *   2. FUSION : une annonce réellement multi-diffusée, reliée par un signal
 *      fort (GPS), doit produire UNE fiche qui conserve les deux occurrences
 *      et leurs URLs (§13).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedListing } from '@rentfinder/shared';
import { dedupe } from '../../packages/collector/src/deduplication/dedupe.js';
import { mergeGroup } from '../../packages/collector/src/deduplication/merge.js';
import { similarity } from '../../packages/collector/src/deduplication/similarity.js';
import { normalizeListing } from '../../packages/collector/src/normalization/normalize.js';
import { parseSearchPage as parseLaforet } from '../../packages/collector/src/sources/laforet/parser.js';
import { parseSearchPage as parseOrpi } from '../../packages/collector/src/sources/orpi/parser.js';
import { makeOccurrence, TEST_NOW } from '../helpers/factories.js';

const FIXTURES = join(import.meta.dirname, '../fixtures');

function loadCorpus(): NormalizedListing[] {
  const laforetHtml = readFileSync(join(FIXTURES, 'laforet/nice-page1.html'), 'utf8');
  const orpiHtml = readFileSync(join(FIXTURES, 'orpi/nice-page1.html'), 'utf8');

  const laforetRaw = parseLaforet(
    laforetHtml,
    'https://www.laforet.com/ville/location-appartement-nice-06000',
  ).listings;
  const orpiRaw = parseOrpi(orpiHtml, 'https://www.orpi.com/location-immobiliere-nice/').listings;

  return [
    ...laforetRaw.map((raw) => normalizeListing(raw, { sourceId: 'laforet', nowMs: TEST_NOW })),
    ...orpiRaw.map((raw) => normalizeListing(raw, { sourceId: 'orpi', nowMs: TEST_NOW })),
  ].filter((listing): listing is NormalizedListing => listing !== null);
}

describe('dédoublonnage croisé Laforêt × Orpi — fixtures réelles', () => {
  const corpus = loadCorpus();

  it('le corpus combiné contient bien les occurrences des deux sources', () => {
    const sources = new Set(corpus.map((occurrence) => occurrence.sourceId));
    expect(sources).toContain('laforet');
    expect(sources).toContain('orpi');
    expect(corpus.length).toBeGreaterThanOrEqual(9);
  });

  it('ne fusionne PAS deux logements proches sans signal fort (anti-fusion, §14)', () => {
    // Laforêt 40000001 : 1 pièce, 34 m², 690 €, Nice.
    // Orpi …202       : 2 pièces, 34 m², 690 €, Nice.
    // Même prix, même surface, même ville — mais pièces différentes (veto) et
    // aucun signal fort commun : ils doivent rester deux fiches.
    const result = dedupe(corpus);
    const laforetGroup = result.groups.find((group) =>
      group.occurrences.some((occurrence) => occurrence.sourceRef === '40000001'),
    );
    const orpiGroup = result.groups.find((group) =>
      group.occurrences.some(
        (occurrence) => occurrence.sourceRef === '00000000-0000-4000-8000-000000000202',
      ),
    );
    expect(laforetGroup).toBeDefined();
    expect(orpiGroup).toBeDefined();
    expect(laforetGroup).not.toBe(orpiGroup);
    expect(laforetGroup?.occurrences).toHaveLength(1);
    expect(orpiGroup?.occurrences).toHaveLength(1);
  });

  it('aucune fusion multi-sources ne se produit sur ces fixtures indépendantes', () => {
    // Les fixtures décrivent des biens tous distincts : toute fusion serait
    // une fusion abusive.
    const result = dedupe(corpus);
    for (const group of result.groups) {
      expect(group.occurrences).toHaveLength(1);
    }
  });
});

describe('fusion par signal GPS — annonce Orpi multi-diffusée', () => {
  const corpus = loadCorpus();
  const orpiStudio = corpus.find(
    (occurrence) => occurrence.sourceId === 'orpi' && occurrence.sourceRef === 'x-000001-101',
  );

  it('précondition : le studio Orpi porte des coordonnées GPS', () => {
    expect(orpiStudio?.latitude).not.toBeNull();
    expect(orpiStudio?.longitude).not.toBeNull();
  });

  it('reconnaît le doublon quand une autre source publie le même bien au même endroit', () => {
    if (orpiStudio === undefined) throw new Error('studio Orpi absent du corpus');

    // La même annonce publiée par le site de l'agence : mêmes prix/surface,
    // position GPS à ~30 m (imprécision de géocodage typique).
    const agencyTwin = makeOccurrence({
      id: 'agence-fictive:AF-101',
      sourceId: 'agence-fictive',
      sourceRef: 'AF-101',
      sourceUrl: 'https://agence-fictive.example.invalid/location/AF-101',
      title: 'Studio meublé centre — disponible',
      price: 690,
      area: 13.5,
      rooms: 1,
      city: 'nice',
      postalCode: '06000',
      latitude: (orpiStudio.latitude ?? 0) + 0.0002,
      longitude: orpiStudio.longitude,
    });

    const verdict = similarity(orpiStudio, agencyTwin);
    expect(verdict.verdict).toBe('duplicate');
    expect(verdict.signals.some((signal) => signal.code === 'gps')).toBe(true);

    // La chaîne complète produit UNE fiche portant les deux URLs (§13).
    const result = dedupe([...corpus, agencyTwin]);
    const group = result.groups.find((candidate) =>
      candidate.occurrences.some((occurrence) => occurrence.sourceRef === 'x-000001-101'),
    );
    expect(group?.occurrences).toHaveLength(2);

    const merged = mergeGroup([...(group?.occurrences ?? [])]);
    const urls = merged.occurrences.map((occurrence) => occurrence.sourceUrl);
    expect(urls).toContain(
      'https://www.orpi.com/annonce-location-appartement-t1-nice-06000-x-000001-101/',
    );
    expect(urls).toContain('https://agence-fictive.example.invalid/location/AF-101');
  });
});
