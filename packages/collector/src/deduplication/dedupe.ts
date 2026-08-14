/**
 * Regroupement des occurrences en logements uniques (§13).
 *
 * Comparer chaque annonce à toutes les autres coûterait O(n²) — inacceptable
 * dès quelques milliers d'annonces (§56). On génère donc d'abord des paires
 * candidates par « blocage » : deux annonces ne sont comparées que si elles
 * partagent au moins une clé grossière (téléphone, référence, ou ville +
 * tranche de surface). Les paires retenues sont ensuite évaluées finement par
 * `similarity`, et fusionnées via une structure union-find.
 */

import type { NormalizedListing } from '@rentfinder/shared';
import { comparable } from '../normalization/text.js';
import { similarity, type SimilarityResult } from './similarity.js';

/** Groupe d'occurrences désignant le même logement. */
export interface DuplicateGroup {
  readonly occurrences: readonly NormalizedListing[];
  /** Paires jugées ambiguës, conservées pour inspection manuelle (§14). */
  readonly ambiguousPairs: readonly AmbiguousPair[];
}

export interface AmbiguousPair {
  readonly leftId: string;
  readonly rightId: string;
  readonly result: SimilarityResult;
}

/** Union-find avec compression de chemin. */
class UnionFind {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    let root = this.parent.get(id) ?? id;
    while (root !== this.parent.get(root)) {
      root = this.parent.get(root) ?? root;
    }
    // Compression : les prochains appels seront immédiats.
    let current = id;
    while (current !== root) {
      const next = this.parent.get(current) ?? root;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

/**
 * Clés de blocage d'une annonce.
 *
 * Une annonce en possède plusieurs : il suffit qu'une seule soit partagée pour
 * que la comparaison fine ait lieu. C'est volontairement généreux — rater une
 * paire candidate produit un doublon visible, ce qu'on cherche à éviter.
 */
export function blockingKeys(listing: NormalizedListing): string[] {
  const keys: string[] = [];

  if (listing.contact.phone !== null) keys.push(`phone:${listing.contact.phone}`);
  if (listing.contact.email !== null) keys.push(`email:${listing.contact.email}`);

  const reference = listing.contact.reference;
  if (reference !== null && reference.length >= 4) {
    keys.push(`ref:${comparable(reference)}`);
  }

  const city = listing.city ?? listing.postalCode ?? 'ville-inconnue';

  // Tranche de surface de 5 m². On indexe aussi la tranche voisine pour que
  // deux annonces de part et d'autre d'une frontière restent comparables.
  if (listing.area !== null) {
    const bucket = Math.round(listing.area / 5);
    keys.push(`area:${city}:${bucket}`);
    keys.push(`area:${city}:${bucket - 1}`);
  }

  // Tranche de loyer de 50 €, avec le même chevauchement.
  if (listing.price !== null) {
    const bucket = Math.round(listing.price / 50);
    keys.push(`price:${city}:${bucket}`);
    keys.push(`price:${city}:${bucket - 1}`);
  }

  return keys;
}

export interface DedupeOptions {
  /**
   * Si `true`, les paires ambiguës sont fusionnées.
   * Par défaut `false` : mieux vaut un doublon affiché qu'une fusion erronée,
   * qui ferait disparaître un logement réel de la liste (§14).
   */
  readonly mergeAmbiguous?: boolean;
}

export interface DedupeResult {
  readonly groups: readonly DuplicateGroup[];
  /** Nombre de comparaisons fines réellement effectuées — suivi du coût (§56). */
  readonly comparisonCount: number;
}

/** Regroupe un lot d'occurrences en logements uniques. */
export function dedupe(
  listings: readonly NormalizedListing[],
  options: DedupeOptions = {},
): DedupeResult {
  const mergeAmbiguous = options.mergeAmbiguous ?? false;
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const unionFind = new UnionFind();
  for (const listing of listings) unionFind.add(listing.id);

  // Index inversé : clé de blocage → identifiants partageant cette clé.
  const buckets = new Map<string, string[]>();
  for (const listing of listings) {
    for (const key of blockingKeys(listing)) {
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [listing.id]);
      else bucket.push(listing.id);
    }
  }

  const comparedPairs = new Set<string>();
  const ambiguousByRoot = new Map<string, AmbiguousPair[]>();
  let comparisonCount = 0;

  for (const bucket of buckets.values()) {
    // Un bucket dégénéré (toutes les annonces d'une ville sans surface ni prix)
    // ferait exploser le coût : on l'ignore plutôt que de ralentir la collecte.
    if (bucket.length < 2 || bucket.length > 200) continue;

    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const leftId = bucket[i];
        const rightId = bucket[j];
        if (leftId === undefined || rightId === undefined) continue;

        const pairKey = leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
        if (comparedPairs.has(pairKey)) continue;
        comparedPairs.add(pairKey);

        const left = byId.get(leftId);
        const right = byId.get(rightId);
        if (left === undefined || right === undefined) continue;

        comparisonCount += 1;
        const result = similarity(left, right);

        if (result.verdict === 'duplicate' || (mergeAmbiguous && result.verdict === 'ambiguous')) {
          unionFind.union(leftId, rightId);
        } else if (result.verdict === 'ambiguous') {
          const root = unionFind.find(leftId);
          const pending = ambiguousByRoot.get(root) ?? [];
          pending.push({ leftId, rightId, result });
          ambiguousByRoot.set(root, pending);
        }
      }
    }
  }

  // Matérialisation des groupes.
  const grouped = new Map<string, NormalizedListing[]>();
  for (const listing of listings) {
    const root = unionFind.find(listing.id);
    const members = grouped.get(root) ?? [];
    members.push(listing);
    grouped.set(root, members);
  }

  const groups: DuplicateGroup[] = [];
  for (const [root, occurrences] of grouped) {
    groups.push({
      occurrences,
      ambiguousPairs: ambiguousByRoot.get(root) ?? [],
    });
  }

  return { groups, comparisonCount };
}
