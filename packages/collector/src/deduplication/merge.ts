/**
 * Fusion des occurrences en une fiche unique (§15).
 *
 * Règle centrale : on ne perd jamais une information. Quand deux sources
 * divergent, l'une des valeurs est retenue pour l'affichage et l'autre est
 * conservée dans `conflicts` avec sa provenance, afin que l'interface puisse
 * signaler le désaccord au lieu de le masquer.
 *
 * La source dite « principale » est l'occurrence la plus complète : c'est elle
 * qui fournit les valeurs par défaut. Ce choix est arbitraire mais explicite,
 * et il est réversible sans perte puisque tout est conservé.
 */

import type {
  AggregatedListing,
  Contact,
  LifecycleStatus,
  MergedField,
  NormalizedListing,
  PropertyType,
  Sourced,
} from '@rentfinder/shared';

/** Champs pris en compte pour mesurer la complétude d'une occurrence. */
const COMPLETENESS_FIELDS = [
  'title',
  'description',
  'price',
  'charges',
  'area',
  'rooms',
  'address',
  'city',
  'postalCode',
  'latitude',
  'longitude',
  'publishedAt',
] as const;

function completeness(listing: NormalizedListing): number {
  let filled = COMPLETENESS_FIELDS.reduce(
    (count, field) => count + (listing[field] !== null ? 1 : 0),
    0,
  );
  // Des coordonnées de contact valent cher : elles conditionnent l'action (§21).
  if (listing.contact.phone !== null) filled += 2;
  if (listing.contact.email !== null) filled += 2;
  return filled;
}

/** Désigne l'occurrence de référence : la plus complète, puis la plus ancienne. */
export function pickPrimary(occurrences: readonly NormalizedListing[]): NormalizedListing {
  const [first, ...rest] = occurrences;
  if (first === undefined) throw new Error('Un groupe de doublons ne peut pas être vide');

  return rest.reduce((best, candidate) => {
    const bestScore = completeness(best);
    const candidateScore = completeness(candidate);
    if (candidateScore !== bestScore) return candidateScore > bestScore ? candidate : best;
    return Date.parse(candidate.firstSeenAt) < Date.parse(best.firstSeenAt) ? candidate : best;
  }, first);
}

/**
 * Fusionne un champ à travers toutes les occurrences.
 *
 * @param select accesseur du champ
 * @param equals comparaison métier ; deux valeurs « équivalentes » ne créent
 *               pas de conflit (utile pour les nombres à tolérance près)
 */
function mergeField<T>(
  occurrences: readonly NormalizedListing[],
  primary: NormalizedListing,
  select: (listing: NormalizedListing) => T,
  equals: (a: T, b: T) => boolean = (a, b) => a === b,
): MergedField<T> {
  const primaryValue = select(primary);

  // Si la source principale ne renseigne rien, on adopte la première valeur
  // disponible ailleurs plutôt que de laisser le champ vide.
  let value = primaryValue;
  let sourceId = primary.sourceId;
  let observedAt = primary.scrapedAt;

  if (value === null || value === undefined) {
    const fallback = occurrences.find((occurrence) => {
      const candidate = select(occurrence);
      return candidate !== null && candidate !== undefined;
    });
    if (fallback !== undefined) {
      value = select(fallback);
      sourceId = fallback.sourceId;
      observedAt = fallback.scrapedAt;
    }
  }

  const conflicts: Sourced<T>[] = [];
  for (const occurrence of occurrences) {
    if (occurrence.sourceId === sourceId) continue;
    const candidate = select(occurrence);
    if (candidate === null || candidate === undefined) continue;
    if (equals(candidate, value)) continue;
    conflicts.push({
      value: candidate,
      sourceId: occurrence.sourceId,
      observedAt: occurrence.scrapedAt,
    });
  }

  return { value, sourceId, observedAt, conflicts };
}

/**
 * Tolérance appliquée aux nombres lors de la détection de conflit.
 *
 * Elle ne sert QU'À absorber les erreurs d'arrondi en virgule flottante. §15
 * est explicite : deux sources qui annoncent des valeurs différentes doivent
 * toutes deux être conservées. Un écart de 690 € contre 715 € est une
 * divergence réelle que l'utilisateur a le droit de voir, pas un détail à
 * lisser — c'est souvent le signe que l'une inclut les charges et l'autre non.
 *
 * La question « cet écart est-il alarmant ? » est distincte et relève du
 * scoring de risque, qui applique ses propres seuils de significativité (§19).
 */
const numbersEqual =
  (tolerance: number) =>
  (a: unknown, b: unknown): boolean => {
    if (typeof a !== 'number' || typeof b !== 'number') return a === b;
    return Math.abs(a - b) <= tolerance;
  };

/**
 * Fusionne les coordonnées de toutes les occurrences (§15).
 * Exemple typique : le téléphone vient de Leboncoin, la référence du site de
 * l'agence, le nom du conseiller de SeLoger.
 */
export function mergeContacts(occurrences: readonly NormalizedListing[]): Contact {
  const providedBy = new Set<string>();
  let name: string | null = null;
  let agencyName: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  let formUrl: string | null = null;
  let reference: string | null = null;
  let kind: Contact['kind'] = 'unknown';

  for (const occurrence of occurrences) {
    const contact = occurrence.contact;
    name ??= contact.name;
    agencyName ??= contact.agencyName;
    phone ??= contact.phone;
    email ??= contact.email;
    formUrl ??= contact.formUrl;
    reference ??= contact.reference;
    if (kind === 'unknown' && contact.kind !== 'unknown') kind = contact.kind;
    for (const source of contact.providedBy) providedBy.add(source);
  }

  return { name, agencyName, phone, email, formUrl, reference, kind, providedBy: [...providedBy] };
}

/**
 * Le cycle de vie du groupe est le plus optimiste de ses occurrences : tant
 * qu'une source voit encore l'annonce, le logement est disponible (§32).
 */
function mergeLifecycle(occurrences: readonly NormalizedListing[]): LifecycleStatus {
  if (occurrences.some((o) => o.lifecycle === 'active')) return 'active';
  if (occurrences.some((o) => o.lifecycle === 'possiblyInactive')) return 'possiblyInactive';
  return 'inactive';
}

/** Construit la fiche unique d'un logement à partir de ses occurrences (§13). */
export function mergeGroup(occurrences: readonly NormalizedListing[]): AggregatedListing {
  const primary = pickPrimary(occurrences);

  // L'identifiant du groupe suit l'occurrence la plus anciennement connue, afin
  // de rester stable quand une nouvelle source rejoint le groupe.
  const oldest = occurrences.reduce((best, candidate) =>
    Date.parse(candidate.firstSeenAt) < Date.parse(best.firstSeenAt) ? candidate : best,
  );

  const imageUrls = [...new Set(occurrences.flatMap((occurrence) => occurrence.imageUrls))];

  const timestamps = occurrences.map((o) => Date.parse(o.firstSeenAt)).filter(Number.isFinite);
  const lastSeen = occurrences.map((o) => Date.parse(o.lastSeenAt)).filter(Number.isFinite);

  return {
    id: oldest.id,

    title: mergeField(occurrences, primary, (l) => l.title),
    description: mergeField(occurrences, primary, (l) => l.description),

    price: mergeField(occurrences, primary, (l) => l.price, numbersEqual(0.01)),
    charges: mergeField(occurrences, primary, (l) => l.charges, numbersEqual(0.01)),
    area: mergeField(occurrences, primary, (l) => l.area, numbersEqual(0.01)),
    rooms: mergeField(occurrences, primary, (l) => l.rooms),
    propertyType: mergeField<PropertyType>(occurrences, primary, (l) => l.propertyType),
    furnished: mergeField(occurrences, primary, (l) => l.furnished),
    flatShare: mergeField(occurrences, primary, (l) => l.flatShare),

    address: mergeField(occurrences, primary, (l) => l.address),
    city: mergeField(occurrences, primary, (l) => l.city),
    postalCode: mergeField(occurrences, primary, (l) => l.postalCode),
    latitude: mergeField(occurrences, primary, (l) => l.latitude, numbersEqual(0.001)),
    longitude: mergeField(occurrences, primary, (l) => l.longitude, numbersEqual(0.001)),

    contact: mergeContacts(occurrences),

    publishedAt: mergeField(occurrences, primary, (l) => l.publishedAt),
    availableAt: mergeField(occurrences, primary, (l) => l.availableAt),

    imageUrls,

    views: mergeField(occurrences, primary, (l) => l.views),
    favorites: mergeField(occurrences, primary, (l) => l.favorites),

    // §13 : toutes les occurrences sont conservées, avec leurs URLs d'origine.
    occurrences: [...occurrences],

    firstSeenAt: new Date(Math.min(...timestamps)).toISOString(),
    lastSeenAt: new Date(Math.max(...lastSeen)).toISOString(),
    lifecycle: mergeLifecycle(occurrences),
    tracking: 'new',
  };
}
