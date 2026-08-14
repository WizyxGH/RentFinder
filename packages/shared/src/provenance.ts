/**
 * Provenance des données (§15).
 *
 * Principe directeur du projet : lorsqu'une même information provient de
 * plusieurs sources et que les valeurs divergent, on n'écrase JAMAIS
 * silencieusement. On retient une valeur et on conserve les autres, chacune
 * accompagnée de la source qui l'a fournie.
 */

/** Identifiant stable et court d'une source, ex. `laforet`, `orpi`. */
export type SourceId = string;

/** Date au format ISO 8601 UTC, ex. `2026-08-14T09:30:00.000Z`. */
export type IsoDateTime = string;

/**
 * Une valeur accompagnée de son origine.
 *
 * @example
 * { value: 690, sourceId: 'laforet', observedAt: '2026-08-14T09:30:00.000Z' }
 */
export interface Sourced<T> {
  readonly value: T;
  readonly sourceId: SourceId;
  readonly observedAt: IsoDateTime;
}

/**
 * Champ issu de la fusion de plusieurs sources (§15).
 *
 * `value` est la valeur retenue pour l'affichage. `conflicts` contient les
 * valeurs divergentes qu'on a choisi de ne pas retenir, mais qu'on refuse de
 * perdre — l'interface peut ainsi signaler « SeLoger annonce 690 €, Laforêt
 * annonce 700 € ».
 *
 * `conflicts` est vide dans le cas courant où toutes les sources s'accordent.
 */
export interface MergedField<T> {
  readonly value: T;
  readonly sourceId: SourceId;
  readonly observedAt: IsoDateTime;
  readonly conflicts: readonly Sourced<T>[];
}

/** Construit un champ fusionné sans conflit. */
export function merged<T>(value: T, sourceId: SourceId, observedAt: IsoDateTime): MergedField<T> {
  return { value, sourceId, observedAt, conflicts: [] };
}

/**
 * Indique si un champ fusionné porte au moins une valeur divergente.
 * L'interface s'en sert pour afficher un avertissement discret (§15).
 */
export function hasConflict<T>(field: MergedField<T>): boolean {
  return field.conflicts.length > 0;
}

/**
 * `null` signifie explicitement « la source ne fournit pas cette information ».
 *
 * §17 : ne jamais inventer une donnée. Un nombre de favoris absent vaut `null`,
 * jamais `0`. Le scoring doit traiter `null` comme « inconnu » et non comme une
 * valeur basse, sous peine de pénaliser injustement les sources avares en
 * métadonnées.
 */
export type Unknown = null;

/** Valeur potentiellement non fournie par la source. */
export type Maybe<T> = T | Unknown;
