/**
 * Qui a le droit d'écrire (§26).
 *
 * Extrait du point d'entrée pour être TESTABLE : `index.ts` importe le client
 * de base et les routes du collecteur, si bien qu'un test de cette seule
 * fonction montait tout le Worker. Une règle de sécurité qu'on ne peut pas
 * éprouver isolément finit par ne plus l'être du tout.
 */

/** Ce que la fonction a besoin de savoir de l'environnement. */
export interface OriginPolicy {
  readonly ALLOWED_ORIGIN?: string;
}

/**
 * Méthodes qui ne changent rien : elles n'ont pas besoin d'être protégées.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Le garde-fou qui remplace `SameSite`.
 *
 * Le cookie de session est en `SameSite=None` — il n'a pas le choix, le site et
 * l'API sont sur deux domaines. On vérifie donc nous-mêmes QUI demande, sur
 * toute requête qui écrit.
 *
 * CE N'EST PAS REDONDANT AVEC CORS. Un navigateur laisse partir certaines
 * requêtes sans autorisation préalable — un envoi de formulaire en
 * `multipart/form-data`, par exemple, ce qu'est exactement le dépôt d'une pièce
 * du dossier. CORS empêcherait le site attaquant de LIRE la réponse, pas
 * d'envoyer la requête ; le fichier aurait été déposé quand même.
 *
 * `Origin` absent = ce n'est pas un navigateur (un script, une sonde), donc pas
 * un scénario où une session traîne : on laisse passer, l'absence de cookie
 * valide fera le reste.
 */
export function forbiddenOrigin(request: Request, env: OriginPolicy): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const origin = request.headers.get('Origin');
  if (origin === null) return false;
  return origin !== (env.ALLOWED_ORIGIN ?? '');
}
