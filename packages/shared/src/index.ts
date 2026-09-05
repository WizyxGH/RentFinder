/**
 * @rentfinder/shared — modèle de données et contrats communs.
 *
 * Ce paquet ne contient aucune logique métier : uniquement les types partagés
 * entre le collecteur, l'API et le frontend, plus quelques helpers purs.
 * Il ne dépend de rien, afin de pouvoir être importé partout (§48).
 */

export * from './provenance.js';
export * from './listing.js';
export * from './contact.js';
export * from './scores.js';
export * from './criteria.js';
export * from './source.js';
export * from './message.js';
export * from './address.js';
export * from './user.js';
export * from './routes.js';
export * from './reference-points.js';
export * from './notification-preferences.js';
