/**
 * Données de démonstration (§42 étape 1, §26).
 *
 * TOUTES CES DONNÉES SONT FICTIVES et le resteront : ce fichier est versionné
 * dans un dépôt public. Les téléphones utilisent la plage `06 00 00 00 xx`, les
 * e-mails le domaine `example.invalid` réservé par la RFC 2606, et les agences
 * sont inventées. Ne jamais y coller une annonce réelle.
 *
 * Elles servent à trois choses :
 *   1. développer et voir l'interface sans base ni collecte ;
 *   2. alimenter les tests de non-régression du frontend (§54) ;
 *   3. donner à un nouveau venu une idée du produit en une commande.
 */

import type { Contact, ListingScores, MergedField } from '../types.js';
import type { ListingView } from '../types.js';

const OBSERVED_AT = '2026-08-14T09:30:00.000Z';

const field = <T>(value: T, sourceId = 'demo'): MergedField<T> => ({
  value,
  sourceId,
  observedAt: OBSERVED_AT,
  conflicts: [],
});

const contact = (overrides: Partial<Contact> = {}): Contact => ({
  name: null,
  agencyName: null,
  phone: null,
  email: null,
  formUrl: null,
  reference: null,
  kind: 'unknown',
  providedBy: [],
  ...overrides,
});

const scores = (
  match: number,
  opportunity: number,
  visit: number,
  risk: number,
  extras: Partial<{
    matchReasons: ListingScores['match']['reasons'];
    riskReasons: ListingScores['risk']['reasons'];
    unknown: string[];
  }> = {},
): ListingScores => ({
  match: {
    value: match,
    reasons: extras.matchReasons ?? [
      { code: 'city.match', label: 'Située à Nice', delta: 30 },
      { code: 'price.within', label: 'Dans le budget', delta: 36 },
      { code: 'area.within', label: 'Surface suffisante', delta: 28 },
    ],
    unknownSignals: [],
    confidence: 1,
  },
  opportunity: {
    value: opportunity,
    reasons: [{ code: 'freshness.published', label: 'Publiée récemment', delta: opportunity }],
    unknownSignals: extras.unknown ?? ['nombre de favoris', 'nombre de vues'],
    confidence: 0.34,
  },
  visitProbability: {
    value: visit,
    reasons: [{ code: 'base', label: 'Base neutre', delta: 40 }],
    unknownSignals: ['statistiques personnelles (aucun historique)'],
    confidence: 0.75,
  },
  risk: {
    value: risk,
    reasons: extras.riskReasons ?? [
      { code: 'price.normal', label: 'Loyer cohérent avec le marché', delta: 0 },
      { code: 'identity.agency', label: 'Agence identifiable', delta: 0 },
    ],
    unknownSignals: [],
    confidence: 1,
  },
});

/**
 * Annonces de démonstration, volontairement contrastées : une pépite
 * multi-sources, une annonce fraîche mais sans coordonnées, une annonce à
 * risque, une annonce hors critères.
 */
export const MOCK_LISTINGS: readonly ListingView[] = [
  {
    id: 'demo:1',
    title: field('Appartement T2 lumineux, proche Jean Médecin'),
    description: field(
      'Appartement de deux pièces entièrement rénové, cuisine équipée, ' +
        'double vitrage, à deux pas des commerces et du tramway.',
    ),
    price: field(690),
    charges: field(45),
    area: field(34),
    rooms: field(2),
    propertyType: field('apartment'),
    furnished: field(true),
    address: field('Rue de la Démonstration'),
    city: field('nice'),
    postalCode: field('06000'),
    publishedAt: field('2026-08-14T09:26:00.000Z'),
    availableAt: field('2026-09-01T00:00:00.000Z'),
    views: field(null),
    favorites: field(null),
    contact: contact({
      name: 'Camille Martin',
      agencyName: 'Agence Fictive Nice',
      phone: '+33600000012',
      email: 'contact@example.invalid',
      reference: 'DEMO-1',
      kind: 'agency',
      providedBy: ['demo-portail', 'demo-agence'],
    }),
    imageUrls: [],
    scores: scores(96, 98, 84, 5),
    distances: [
      { label: 'Travail', distanceKm: 2.4, durationMinutes: 17, mode: 'transit' },
      { label: 'Gare', distanceKm: 0.9, durationMinutes: 8, mode: 'walking' },
    ],
    // §13 : la même annonce vue sur quatre sources, une seule fiche.
    occurrences: [
      {
        id: 'demo-portail:1',
        sourceId: 'demo-portail',
        sourceUrl: 'https://portail.example.invalid/a/1',
        price: 690,
        area: 34,
        lastSeenAt: OBSERVED_AT,
      },
      {
        id: 'demo-portail2:1',
        sourceId: 'demo-portail2',
        sourceUrl: 'https://portail2.example.invalid/annonce/1',
        price: 690,
        area: 34,
        lastSeenAt: OBSERVED_AT,
      },
      {
        id: 'demo-portail3:1',
        sourceId: 'demo-portail3',
        sourceUrl: 'https://portail3.example.invalid/l/1',
        price: 715,
        area: 34,
        lastSeenAt: OBSERVED_AT,
      },
      {
        id: 'demo-agence:1',
        sourceId: 'demo-agence',
        sourceUrl: 'https://agence.example.invalid/bien/1',
        price: 690,
        area: 34,
        lastSeenAt: OBSERVED_AT,
      },
    ],
    matchesCriteria: true,
    actionPriority: 94,
    tracking: 'new',
    lifecycle: 'active',
    firstSeenAt: '2026-08-14T09:28:00.000Z',
    lastSeenAt: OBSERVED_AT,
  },

  {
    id: 'demo:2',
    title: field('Studio meublé quartier du Port'),
    description: field('Studio meublé, cuisine ouverte, proche du port et des transports.'),
    price: field(650),
    charges: field(null),
    area: field(18),
    rooms: field(1),
    propertyType: field('studio'),
    furnished: field(true),
    address: field(null),
    city: field('nice'),
    postalCode: field('06300'),
    publishedAt: field('2026-08-14T08:15:00.000Z'),
    availableAt: field(null),
    views: field(null),
    favorites: field(null),
    // §21 : aucune coordonnée publiée — on n'invente rien, on affiche le formulaire.
    contact: contact({
      agencyName: 'Agence Démo Port',
      formUrl: 'https://agence.example.invalid/contact/2',
      reference: 'DEMO-2',
      kind: 'agency',
      providedBy: ['demo-agence'],
    }),
    imageUrls: [],
    scores: scores(88, 71, 48, 10),
    distances: [
      { label: 'Travail', distanceKm: 3.8, durationMinutes: 26, mode: 'transit' },
      { label: 'Gare', distanceKm: 2.2, durationMinutes: 19, mode: 'walking' },
    ],
    occurrences: [
      {
        id: 'demo-agence:2',
        sourceId: 'demo-agence',
        sourceUrl: 'https://agence.example.invalid/bien/2',
        price: 650,
        area: 18,
        lastSeenAt: OBSERVED_AT,
      },
    ],
    matchesCriteria: true,
    actionPriority: 72,
    tracking: 'new',
    lifecycle: 'active',
    firstSeenAt: '2026-08-14T08:20:00.000Z',
    lastSeenAt: OBSERVED_AT,
  },

  {
    id: 'demo:3',
    title: field('Grand T3 très bon marché, disponible immédiatement'),
    description: field(
      'Je suis actuellement à l’étranger pour mon travail. Les clés vous seront ' +
        'envoyées par courrier après réception du premier loyer et de la caution.',
    ),
    price: field(420),
    charges: field(null),
    area: field(72),
    rooms: field(3),
    propertyType: field('apartment'),
    furnished: field(null),
    address: field(null),
    city: field('nice'),
    postalCode: field('06200'),
    publishedAt: field('2026-08-13T18:00:00.000Z'),
    availableAt: field(null),
    views: field(null),
    favorites: field(null),
    contact: contact({
      email: 'proprietaire@example.invalid',
      kind: 'private',
      providedBy: ['demo-portail'],
    }),
    imageUrls: [],
    // §19 : l'annonce reste visible, avec ses raisons affichées.
    scores: scores(94, 55, 30, 84, {
      riskReasons: [
        { code: 'price.veryLow', label: 'Loyer très inférieur au marché (5,8 €/m²)', delta: 40 },
        { code: 'suspicious.wording', label: 'Le bailleur déclare être à l’étranger', delta: 30 },
        { code: 'suspicious.wording', label: 'Remise des clés par courrier', delta: 30 },
        { code: 'identity.partial', label: 'Bailleur non identifié nommément', delta: 5 },
      ],
    }),
    distances: [],
    occurrences: [
      {
        id: 'demo-portail:3',
        sourceId: 'demo-portail',
        sourceUrl: 'https://portail.example.invalid/a/3',
        price: 420,
        area: 72,
        lastSeenAt: OBSERVED_AT,
      },
    ],
    matchesCriteria: true,
    actionPriority: 58,
    tracking: 'new',
    lifecycle: 'active',
    firstSeenAt: '2026-08-13T18:05:00.000Z',
    lastSeenAt: OBSERVED_AT,
  },

  {
    id: 'demo:4',
    title: field('T2 rénové avec balcon — Cimiez'),
    description: field('Deux pièces avec balcon exposé sud, résidence calme.'),
    price: field(750),
    charges: field(60),
    area: field(40),
    rooms: field(2),
    propertyType: field('apartment'),
    furnished: field(false),
    address: field(null),
    city: field('nice'),
    postalCode: field('06100'),
    publishedAt: field('2026-08-12T10:00:00.000Z'),
    availableAt: field(null),
    views: field(null),
    favorites: field(null),
    contact: contact({
      agencyName: 'Agence Démo Cimiez',
      phone: '+33600000034',
      kind: 'agency',
      providedBy: ['demo-agence'],
    }),
    imageUrls: [],
    // §53 scénario 3 : hors critères, collectée mais absente de la liste principale.
    scores: scores(38, 22, 40, 5, {
      matchReasons: [
        { code: 'city.match', label: 'Située à Nice', delta: 30 },
        { code: 'price.over', label: 'Dépasse le budget de 50 €', delta: 0 },
        { code: 'area.within', label: 'Surface suffisante', delta: 28 },
      ],
    }),
    distances: [],
    occurrences: [
      {
        id: 'demo-agence:4',
        sourceId: 'demo-agence',
        sourceUrl: 'https://agence.example.invalid/bien/4',
        price: 750,
        area: 40,
        lastSeenAt: OBSERVED_AT,
      },
    ],
    matchesCriteria: false,
    actionPriority: 33,
    tracking: 'new',
    lifecycle: 'active',
    firstSeenAt: '2026-08-12T10:05:00.000Z',
    lastSeenAt: OBSERVED_AT,
  },

  {
    id: 'demo:5',
    title: field('T2 Libération — déjà contacté'),
    description: field('Deux pièces au calme, cuisine séparée.'),
    price: field(700),
    charges: field(null),
    area: field(32),
    rooms: field(2),
    propertyType: field('apartment'),
    furnished: field(false),
    address: field(null),
    city: field('nice'),
    postalCode: field('06000'),
    publishedAt: field('2026-08-13T09:00:00.000Z'),
    availableAt: field(null),
    views: field(null),
    favorites: field(null),
    contact: contact({
      agencyName: 'Agence Démo Libération',
      email: 'liberation@example.invalid',
      kind: 'agency',
      providedBy: ['demo-agence'],
    }),
    imageUrls: [],
    scores: scores(90, 45, 52, 8),
    distances: [{ label: 'Gare', distanceKm: 1.4, durationMinutes: 12, mode: 'walking' }],
    occurrences: [
      {
        id: 'demo-agence:5',
        sourceId: 'demo-agence',
        sourceUrl: 'https://agence.example.invalid/bien/5',
        price: 700,
        area: 32,
        lastSeenAt: OBSERVED_AT,
      },
    ],
    matchesCriteria: true,
    actionPriority: 61,
    tracking: 'contacted',
    lifecycle: 'active',
    firstSeenAt: '2026-08-13T09:10:00.000Z',
    lastSeenAt: OBSERVED_AT,
  },
];

/** Sources de démonstration pour la page d'état (§63). */
export const MOCK_SOURCES = [
  {
    sourceId: 'demo-portail',
    health: 'healthy' as const,
    lastRunAt: OBSERVED_AT,
    lastSuccessAt: OBSERVED_AT,
    last429At: null,
    cooldownUntil: null,
    consecutiveErrors: 0,
    averageNewListingCount: 4.2,
  },
  {
    sourceId: 'demo-agence',
    health: 'healthy' as const,
    lastRunAt: OBSERVED_AT,
    lastSuccessAt: OBSERVED_AT,
    last429At: null,
    cooldownUntil: null,
    consecutiveErrors: 0,
    averageNewListingCount: 1.1,
  },
  {
    sourceId: 'demo-portail3',
    health: 'cooldown' as const,
    lastRunAt: OBSERVED_AT,
    lastSuccessAt: '2026-08-14T07:00:00.000Z',
    last429At: OBSERVED_AT,
    cooldownUntil: '2026-08-14T10:30:00.000Z',
    consecutiveErrors: 1,
    averageNewListingCount: 0.4,
  },
  {
    sourceId: 'demo-portail2',
    health: 'degraded' as const,
    lastRunAt: OBSERVED_AT,
    lastSuccessAt: '2026-08-13T18:00:00.000Z',
    last429At: null,
    cooldownUntil: null,
    consecutiveErrors: 2,
    averageNewListingCount: 0,
  },
];
