/**
 * À QUI appartient une décision.
 *
 * Une fiche de logement est partagée ; « je l'ai mise en favori », « je l'ai
 * contactée », « je l'ai archivée » ne le sont pas. Ces états vivaient sur la
 * fiche elle-même — à deux, le favori de l'un serait devenu celui de l'autre.
 * Ils sont désormais rattachés à un utilisateur (`listing_user_state`).
 *
 * IL N'Y EN A QU'UN POUR L'INSTANT, et cette constante le dit franchement.
 * Le site est un bundle statique qui parle directement à Turso avec un jeton
 * conservé par le navigateur : dans ce modèle, aucun mot de passe ne peut être
 * vérifié — le jeton donne accès à toute la base, et un écran de connexion
 * posé devant serait contournable en quelques secondes. Mettre une constante
 * plutôt qu'un écran de connexion, c'est refuser une sécurité de façade (§26).
 *
 * LE JOUR OÙ UN SERVEUR TIENDRA LA SESSION, cette constante devient la valeur
 * lue dans le cookie. C'est le seul endroit à changer côté données — c'est
 * précisément pourquoi le schéma a été préparé avant l'écran.
 */
export const CURRENT_USER = 'moi';
