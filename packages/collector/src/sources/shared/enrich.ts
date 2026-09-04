/**
 * Compléter les annonces NOUVELLES par leur fiche.
 *
 * LE PROBLÈME. Plusieurs sources ne sont lues que sur leur page de liste — un
 * choix d'économie assumé (§30) — et cette page COUPE la description. Relevé du
 * 2026-09-04 sur l'inventaire : FNAIM tronque 72 descriptions sur 75, Foncia
 * les 18 siennes à 99 caractères de moyenne, Century 21 dix-huit sur vingt.
 * Ce qui disparaît n'est pas du décor : la fiche FNAIM du même bien fait 1 900
 * caractères et donne l'adresse en toutes lettres — « 94 AV. DE LA CORNICHE
 * FLEURIE 06200 NICE » — c'est-à-dire de quoi placer une punaise et calculer
 * un trajet (§20), et de quoi reconnaître un doublon (§14).
 *
 * LE COMPROMIS. On ne visite QUE les fiches inconnues, et pas plus de `max`
 * par exécution. Une source dont le stock ne bouge pas ne coûte donc rien de
 * plus au second passage ; une première collecte s'étale sur quelques cycles
 * au lieu de tirer cent requêtes d'un coup.
 *
 * L'ÉCHEC N'EST JAMAIS BLOQUANT (§69). Une fiche injoignable laisse l'annonce
 * telle que la liste l'a donnée — tronquée, mais présente. Un 429 arrête la
 * série sur-le-champ : la source vient de dire qu'elle en a assez.
 */

import type { RawListing, ScrapeContext } from '@rentfinder/shared';
import type { RawDraft } from './raw-listing.js';

export interface EnrichOptions {
  /** Fiches visitées au plus par exécution. */
  readonly max: number;
  /** URL de la fiche, ou `null` si l'annonce n'en a pas d'exploitable. */
  readonly detailUrl: (listing: RawListing) => string | null;
  /**
   * Ce que la fiche apprend, à fusionner sur l'annonce. `null` si la page
   * n'apprend rien — on ne remplace alors surtout pas ce qu'on avait (§17).
   */
  readonly parse: (html: string, listing: RawListing) => RawDraft | null;
}

export interface EnrichResult {
  readonly listings: readonly RawListing[];
  readonly requestCount: number;
  readonly pagesFetched: number;
  readonly warnings: readonly string[];
}

/**
 * Visite les fiches des annonces que la source n'avait pas encore données, et
 * fusionne ce qu'elles apprennent.
 *
 * L'ordre de la liste est conservé : elle est triée par la source (fraîcheur,
 * loyer croissant…), et la bousculer changerait ce que voit l'utilisateur.
 */
export async function enrichNewListings(
  context: ScrapeContext,
  listings: readonly RawListing[],
  options: EnrichOptions,
): Promise<EnrichResult> {
  const warnings: string[] = [];
  const patched = new Map<string, RawListing>();
  let requestCount = 0;
  let pagesFetched = 0;
  let budget = options.max;

  for (const listing of listings) {
    if (budget <= 0 || context.shouldStop()) break;
    if (context.isKnown(listing.sourceRef)) continue;
    const url = options.detailUrl(listing);
    if (url === null) continue;

    budget -= 1;
    try {
      const page = await context.fetch(url);
      requestCount += 1;
      if (page.notModified) continue;
      pagesFetched += 1;
      const extra = options.parse(page.body, listing);
      if (extra === null) continue;
      // Les champs de la fiche PRIMENT : c'est la page complète, la liste n'en
      // était qu'un résumé. Les clés absentes laissent l'annonce intacte.
      const merged: Record<string, unknown> = { ...listing };
      for (const [key, value] of Object.entries(extra)) {
        if (value !== undefined) merged[key] = value;
      }
      patched.set(listing.sourceRef, merged as unknown as RawListing);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.log('detail.failed', { url, error: message });
      warnings.push(`Fiche injoignable : ${url}`);
      // 429 : la source dit qu'elle en a assez. On s'arrête là, sans insister.
      if (message.includes('429')) break;
    }
  }

  return {
    listings: listings.map((listing) => patched.get(listing.sourceRef) ?? listing),
    requestCount,
    pagesFetched,
    warnings,
  };
}
