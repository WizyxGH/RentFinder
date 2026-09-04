/**
 * Photos affichables, et photos seulement atteignables par un lien.
 *
 * LE PROBLÈME. Le bulletin abonné de BEP publie ses photos sur des serveurs
 * qui ne parlent QUE le http (`beptransaction.com`, `abonnes.beplogement.com`
 * — vérifié le 2026-09-04 : aucun des deux ne répond en https). Le site, lui,
 * est servi en https par GitHub Pages, et tout navigateur bloque une image
 * http sur une page https. Les 325 photos du bulletin étaient donc collectées,
 * stockées, passées au carrousel… et jamais affichées : le `onError` les
 * retirait une à une, l'annonce finissait sans image, sans que rien ne dise
 * pourquoi.
 *
 * CE QU'ON EN FAIT. On ne proxifie pas (§11 : jamais de téléchargement ni de
 * réhébergement), on ne bricole pas le protocole — on distingue simplement ce
 * que la page peut MONTRER de ce qu'elle ne peut qu'OUVRIR, et on propose le
 * lien pour le second. Une photo qu'on ne peut pas afficher reste une photo
 * qu'on peut aller voir.
 *
 * Le partage dépend de la page elle-même : servie en http (mode auto-hébergé
 * local), elle affiche parfaitement une image http. C'est donc le protocole
 * courant qui tranche, pas une liste de domaines.
 */

/** Photos d'une annonce, réparties selon ce que la page peut en faire. */
export interface PhotoSplit {
  /** Affichables telles quelles dans une balise `<img>`. */
  readonly embeddable: readonly string[];
  /**
   * Bloquées par le navigateur si on tentait de les afficher, mais parfaitement
   * ouvrables dans un onglet.
   */
  readonly linkOnly: readonly string[];
}

/** `true` si la page courante est servie en https (donc contenu mixte bloqué). */
function pageIsSecure(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'https:';
}

/**
 * Répartit les photos d'une annonce.
 *
 * @param urls  URLs telles que la source les publie.
 */
export function splitPhotos(urls: readonly string[]): PhotoSplit {
  if (!pageIsSecure()) return { embeddable: urls, linkOnly: [] };
  const embeddable: string[] = [];
  const linkOnly: string[] = [];
  for (const url of urls) {
    (url.startsWith('http://') ? linkOnly : embeddable).push(url);
  }
  return { embeddable, linkOnly };
}
