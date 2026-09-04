/**
 * Deux alertes pour le même logement (§29).
 *
 * CE QUI S'EST PASSÉ. Le 2026-09-03 à 12h11, deux notifications sont parties à
 * la même minute pour le même studio Saint-Sylvestre : « 660 € · 29,4 m² » vu
 * par une alerte e-mail, et « 660 € · 29 m² » vu directement chez Savi Esteve.
 * Deux fiches distinctes — les surfaces publiées diffèrent d'un demi-mètre
 * carré, ce qui suffit à ne pas les fusionner (§14, prudence) — mais un seul
 * appartement, et deux sonneries.
 *
 * Le dépôt savait déjà rapprocher ces deux-là : `listingSpecKey` arrondit
 * justement le loyer et la surface, et `directListingSpecKeys` recensait les
 * biens vus EN DIRECT pour cette raison. Simplement, personne n'appelait ces
 * fonctions — l'intention était écrite, le filtre jamais posé.
 *
 * CE QU'ON FAIT. Quand une alerte e-mail décrit le même bien qu'une source
 * directe, on tait l'alerte e-mail. La source directe vaut mieux : elle porte
 * un lien vers la vraie fiche, souvent un téléphone, et les honoraires.
 *
 * CE QU'ON NE FAIT PAS. On ne fusionne rien (§14) : les deux fiches restent
 * visibles sur le site, avec leurs sources. Et on ne marque pas l'annonce tue
 * comme « signalée » : si la fiche directe disparaît, l'e-mail redevient la
 * seule trace du bien, et il sera notifié à ce moment-là.
 */

import { listingSpecKey, looseSpecKey, type NotifiableListing } from '../db/repository.js';

/** La source qui relaie, par opposition à celles qu'on collecte en direct. */
const RELAYED_SOURCE = 'email-alerts';

/** Les deux clés d'une annonce : avec la ville, et sans elle. */
function keysOf(listing: NotifiableListing): string[] {
  return [
    listingSpecKey(listing.price, listing.area, listing.city, listing.rooms),
    looseSpecKey(listing.price, listing.area, listing.rooms),
  ].filter((key): key is string => key !== null);
}

/**
 * Retire les alertes redondantes d'un lot à notifier.
 *
 * @param pending  annonces prêtes à être signalées, priorité décroissante.
 * @param directKeys  clés des biens déjà connus par une source DIRECTE, en
 *                    base. Le lot courant s'y ajoute au fil de l'eau : deux
 *                    annonces du même bien peuvent arriver dans la même
 *                    collecte, et c'est précisément ce qui s'est produit.
 */
export function dropRedundantNotifications(
  pending: readonly NotifiableListing[],
  directKeys: ReadonlySet<string>,
): readonly NotifiableListing[] {
  const direct = new Set(directKeys);

  // Les annonces directes du lot d'abord, quel que soit leur rang de priorité :
  // sans cela, une alerte e-mail traitée en premier passerait, et c'est la
  // fiche directe — la meilleure des deux — qui aurait été tue.
  for (const listing of pending) {
    if (listing.sourceId === RELAYED_SOURCE) continue;
    for (const key of keysOf(listing)) direct.add(key);
  }

  return pending.filter((listing) => {
    if (listing.sourceId !== RELAYED_SOURCE) return true;
    return !keysOf(listing).some((key) => direct.has(key));
  });
}
