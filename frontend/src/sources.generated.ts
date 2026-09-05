/**
 * ENGENDRÉ — ne pas modifier à la main.
 * Reconstruire avec `pnpm --filter @rentfinder/frontend run sources`.
 *
 * La table des sources, telle que le collecteur les déclare : un nom lisible et,
 * pour les agences qui ont leur propre site, son domaine.
 *
 * `domain` vaut `null` pour les portails : leur domaine n'est pas celui d'une
 * agence, et s'en servir comme logo donnerait la même image à des dizaines
 * d'agences distinctes.
 */

export interface SourceInfo {
  readonly name: string;
  readonly domain: string | null;
}

export const SOURCES: Readonly<Record<string, SourceInfo>> = {
  'acropolis-immo': { name: 'Acropolis Immobilier', domain: 'acropolisimmo.com' },
  'agence-du-centre': { name: 'Agence du Centre', domain: 'agenceducentrenice.com' },
  'agence-longchamp': { name: 'Agence Longchamp', domain: 'agencelongchamp.com' },
  'agence-victoire': { name: 'Agence de la Victoire', domain: 'agence-victoire-nice.com' },
  akorimmo: { name: 'AKOR Immo', domain: 'akorimmo.com' },
  alberti: { name: 'Alberti Immobilier', domain: 'agencealbertinice.com' },
  'ashley-parker': { name: 'Ashley & Parker', domain: 'ashley-parker.fr' },
  beaumont: { name: 'Beaumont Immobilier', domain: 'beaumontimmo.com' },
  bep: { name: 'BEP Logement', domain: 'bep-logement.com' },
  'bep-abonnes': { name: 'BEP Logement (abonné)', domain: null },
  'borne-delaunay': { name: 'Borne & Delaunay', domain: 'borne-delaunay.com' },
  centragence: { name: 'Centragence', domain: 'centragence.net' },
  century21: { name: 'Century 21', domain: null },
  'cimiez-boulevard': { name: 'Cimiez Boulevard', domain: 'cimiez-boulevard.fr' },
  citya: { name: 'Citya Immobilier', domain: null },
  climmo: { name: 'CL Immo Gestion', domain: 'climmo.com' },
  dazur: { name: "D'Azur Immobilier", domain: 'dazur.fr' },
  dgimmo: { name: 'DG Immo', domain: 'dgimmo.fr' },
  dinamy: { name: 'Dinamy Immobilier', domain: 'dinamyimmobilier.com' },
  drago: { name: 'Cabinet Drago', domain: 'cabinet-drago.com' },
  'email-alerts': { name: 'Alertes e-mail', domain: null },
  era: { name: 'ERA Immobilier', domain: null },
  fnaim: { name: 'FNAIM', domain: null },
  foncia: { name: 'Foncia', domain: null },
  'gestion-cassini': { name: 'Gestion Cassini', domain: 'gestioncassini.com' },
  giletta: { name: 'Giletta Immobilier', domain: 'giletta-properties.com' },
  'groupe-foch': { name: 'Foch Immobilier', domain: 'groupe-foch.com' },
  'ici-immobilier': { name: 'I.C.I Info Conseil Immobilier', domain: 'ici-immobilier.com' },
  'immo-jbf': { name: 'Immo JBF', domain: 'immo-jbf.com' },
  'immo-sud': { name: 'Immo-Sud Nice', domain: 'agenceimmosud.com' },
  immo3000: { name: 'Immo 3000', domain: 'immo3000.com' },
  'immobiliere-nicoise': { name: "L'Immobilière Niçoise", domain: 'immobiliere-nicoise.com' },
  inli: { name: "In'li", domain: 'inli.fr' },
  ladresse: { name: "L'Adresse", domain: 'ladresse.com' },
  laforet: { name: 'Laforêt', domain: null },
  lamy: { name: 'Lamy Immobilier', domain: null },
  'leprince-realty': { name: 'leprince realty', domain: 'leprincerealty.com' },
  lodgis: { name: 'Lodgis', domain: null },
  'lt-immobilier': { name: 'LT Immobilier', domain: 'lt-immobilier.com' },
  mirabello: { name: 'Mirabello Immobilier', domain: 'mirabello-immobilier.com' },
  nousgerons: { name: 'NousGérons', domain: 'nousgerons.com' },
  orpi: { name: 'Orpi', domain: null },
  'palais-immobilier': { name: 'Palais Immobilier', domain: 'palaisimmobilier.com' },
  pap: { name: 'PAP', domain: null },
  'partners-immo': { name: 'Partners Immo', domain: 'partners-immo.fr' },
  personalimmo: { name: 'Personal Immo', domain: 'personalimmo.fr' },
  privilege: { name: 'Agence Privilège', domain: 'agenceprivilege.com' },
  rentumo: { name: 'Rentumo', domain: null },
  'saint-roch': { name: 'Saint Roch Immobilier', domain: 'saintrochimmobilier.com' },
  'savi-esteve': { name: 'Agence Savi Estève', domain: 'saviesteve-nice.com' },
  studapart: { name: 'Studapart', domain: null },
  winter: { name: 'Winter Immobilier', domain: 'agence-winter.com' },
};
