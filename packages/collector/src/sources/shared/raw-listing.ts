/**
 * Aide à l'assemblage d'une `RawListing` (§17).
 *
 * `exactOptionalPropertyTypes` interdit d'affecter `undefined` à un champ
 * facultatif, ce qui pousse les parseurs vers une nuée de spreads conditionnels
 * (`...(x !== undefined ? { k: x } : {})`) illisible. On assemble plutôt un
 * brouillon où tout est facultatif, puis on le compacte : bien plus lisible, et
 * la complexité reste sous contrôle.
 */

import type { RawListing } from '@rentfinder/shared';

/** Brouillon : mêmes champs que `RawListing`, tous facultatifs et `undefined`-ables. */
export type RawDraft = { [K in keyof RawListing]?: RawListing[K] | undefined };

/** Retire les champs `undefined` d'un brouillon et le fige en `RawListing`. */
export function compactListing(draft: RawDraft): RawListing {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as RawListing;
}

/**
 * Résultat d'un parseur de page de liste.
 *
 * Cette forme était redéclarée à l'identique dans quinze parseurs : la
 * centraliser évite qu'ils divergent, et rend explicite le contrat commun —
 * des annonces, et des avertissements qui remontent au journal sans interrompre
 * la collecte (§69).
 */
export interface ParsedList {
  readonly listings: readonly RawListing[];
  readonly warnings: readonly string[];
}
