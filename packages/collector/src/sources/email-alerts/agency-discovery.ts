/**
 * Repérage d'agences NON scrapées depuis les e-mails des portails (§5, §47).
 *
 * Les e-mails de confirmation de contact des portails ("Votre message a été
 * envoyé à {AGENCE}", "Proposé par {AGENCE}") nomment l'agence — ce que les
 * digests d'alerte ne font pas. On en tire, à chaque collecte, la liste des
 * agences que l'utilisateur a contactées mais qui ne sont pas encore une source
 * du projet : autant de candidates à ajouter (souvent Apimo/Hektor, triviales).
 *
 * Pur et testable : l'appelant fournit les corps d'e-mails et les noms des
 * sources déjà en place.
 */

import { comparable } from '../../normalization/text.js';

/** Mots trop génériques pour identifier une agence (ne servent pas au rapprochement). */
const STOPWORDS = new Set([
  'agence',
  'immobilier',
  'immobiliere',
  'immo',
  'cabinet',
  'gestion',
  'nice',
  'location',
  'locations',
  'syndic',
  'transaction',
  'transactions',
  'groupe',
  'residences',
  'residence',
  'sud',
  'nord',
  'est',
  'ouest',
  'centre',
  'cote',
  'azur',
]);

/**
 * Agences/plateformes à NE PAS signaler même si leur nom ne matche aucune
 * source : portails ou agrégateurs (pas des agences locales à scraper) et
 * franchises déjà couvertes par une source réseau.
 */
const IGNORE = new Set([
  'locservice', // portail particulier↔particulier (écarté, non conforme)
  'spacest', // plateforme coliving (type Studapart)
  'manda', // plateforme de gestion en ligne
  'lafage', // franchise Century 21 → déjà couverte par la source century21
]);

/** Mots distinctifs d'un nom d'agence (hors mots génériques). */
function tokens(name: string): string[] {
  return comparable(name)
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/** Forme « tassée » (sans espaces ni ponctuation) : rapproche « Nous Gérons »
 * de la source « NousGérons ». */
function squish(name: string): string {
  return comparable(name).replace(/[^a-z0-9]/g, '');
}

/**
 * Noms d'agences cités dans les e-mails de confirmation. On capture ce qui suit
 * "envoyé à" ou "Proposé par", en écartant les formules génériques.
 */
export function extractContactedAgencies(bodies: readonly string[]): string[] {
  const seen = new Map<string, string>();
  const pattern =
    /(?:message a été envoyé à|Proposé par)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9'’&.\- ]{2,40}?)(?:\s+Proposé|<|\.|,| Votre| en charge)/g;
  for (const body of bodies) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const captured = match[1];
      if (captured === undefined) continue;
      const name = captured.replace(/\s+/g, ' ').trim();
      if (name.length < 3 || /une agence|professionnel/i.test(name)) continue;
      const key = comparable(name);
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()];
}

/**
 * Parmi les agences citées, celles qui ne correspondent à AUCUNE source connue
 * (rapprochement par mot distinctif) et ne sont pas volontairement ignorées.
 * Rend les noms tels qu'affichés, dédoublonnés.
 */
export function findUndiscoveredAgencies(
  bodies: readonly string[],
  knownSourceNames: readonly string[],
): string[] {
  const knownTokens = new Set(knownSourceNames.flatMap(tokens));
  // Formes tassées ≥ 8 caractères : assez longues pour éviter qu'un mot
  // générique (« agence ») rapproche à tort deux agences distinctes.
  const knownSquished = knownSourceNames.map(squish).filter((s) => s.length >= 8);
  return extractContactedAgencies(bodies).filter((name) => {
    const t = tokens(name);
    if (t.length === 0) return false; // rien de distinctif → on n'affirme rien (§17)
    if (t.some((token) => IGNORE.has(token))) return false;
    const sq = squish(name);
    const knownByToken = t.some((token) => knownTokens.has(token));
    const knownBySquish = knownSquished.some((k) => sq.includes(k) || k.includes(sq));
    return !(knownByToken || knownBySquish);
  });
}
