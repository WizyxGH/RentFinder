/**
 * Les chemins du site, partagés entre ce qui les PRODUIT et ce qui les LIT.
 *
 * POURQUOI ICI ET NON DANS L'INTERFACE. Deux programmes fabriquent des liens
 * vers une fiche : le site, qui construit ses adresses en naviguant, et le
 * COLLECTEUR, qui les glisse dans les notifications Web Push. Ils ne partagent
 * que ce paquet.
 *
 * Ils ont divergé le 2026-09-05 : les adresses sont passées en anglais —
 * `/annonce/<id>` est devenu `/listing/<id>` — et la notification a continué
 * d'envoyer l'ancien chemin. Toucher une alerte ouvrait donc l'accueil, sans
 * message d'erreur, puisqu'une adresse inconnue y ramène volontairement. Rien
 * ne pouvait le signaler : deux constantes séparées ne se contredisent jamais.
 *
 * Une seule définition, importée des deux côtés, rend la divergence impossible.
 */

/**
 * Le chemin d'une fiche, sans préfixe de site.
 *
 * L'identifiant contient un « : » (`source:référence`) : il est échappé, faute
 * de quoi certains navigateurs réécrivent l'adresse et la route ne correspond
 * plus.
 */
export function listingPath(id: string): string {
  return `/listing/${encodeURIComponent(id)}`;
}

/**
 * L'adresse complète d'une fiche, à partir de l'adresse du site.
 *
 * Tolère un `siteUrl` avec ou sans barre finale : les deux formes se trouvent
 * dans les variables d'environnement, et une double barre casse le routage.
 */
export function listingUrl(siteUrl: string, id: string): string {
  const base = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;
  return `${base}${listingPath(id)}`;
}
