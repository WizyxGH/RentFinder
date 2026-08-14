/**
 * Registre des sources (§5).
 *
 * Unique endroit où l'on déclare qu'une source existe. Ajouter une source =
 * écrire son scraper puis l'enregistrer ici. Rien d'autre dans le système n'a
 * connaissance des sources existantes (§76).
 */

import type { Scraper, SourceDescriptor, SourceId } from '@rentfinder/shared';

export interface SourceRegistry {
  /** Tous les scrapers déclarés, actifs ou non. */
  all(): readonly Scraper[];
  /** Uniquement les scrapers activés (§5). */
  enabled(): readonly Scraper[];
  get(id: SourceId): Scraper | undefined;
  descriptors(): readonly SourceDescriptor[];
}

/**
 * Construit un registre à partir d'une liste de scrapers.
 * Lève si deux sources partagent le même identifiant : une collision
 * silencieuse ferait disparaître une source sans que personne ne le remarque.
 */
export function createRegistry(scrapers: readonly Scraper[]): SourceRegistry {
  const byId = new Map<SourceId, Scraper>();

  for (const scraper of scrapers) {
    const { id } = scraper.descriptor;
    if (byId.has(id)) {
      throw new Error(`Identifiant de source dupliqué dans le registre : « ${id} »`);
    }
    byId.set(id, scraper);
  }

  return {
    all: () => scrapers,
    enabled: () => scrapers.filter((scraper) => scraper.descriptor.enabled),
    get: (id) => byId.get(id),
    descriptors: () => scrapers.map((scraper) => scraper.descriptor),
  };
}
