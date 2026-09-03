/**
 * Utilitaires de texte partagés par tous les parsers.
 *
 * Les sites français utilisent une variété déconcertante d'espaces (insécable,
 * fine insécable, tabulation) et d'entités HTML. Tout parser commence donc par
 * ramener son entrée à une forme canonique, sans quoi les expressions
 * régulières échouent de façon imprévisible selon la source.
 */

/**
 * Espaces à traiter comme des espaces ordinaires :
 * U+00A0 insécable, U+202F fine insécable, U+2009 fine, U+2007 numérique.
 *
 * Ils sont écrits par leur code plutôt que littéralement : dans un fichier
 * source, ces caractères sont visuellement indiscernables d'une espace
 * ordinaire, ce qui rendrait la ligne impossible à relire ou à modifier
 * sûrement — et c'est aussi ce que signale la règle `no-irregular-whitespace`.
 */
const EXOTIC_SPACES = /[\u00a0\u202f\u2009\u2007\t]/g;

/** Entités HTML rencontrées en pratique sur les sites immobiliers. */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  '&#039;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&bull;': '•',
  '&euro;': '€',
  '&eacute;': 'é',
  '&egrave;': 'è',
  '&agrave;': 'à',
  '&ccedil;': 'ç',
  '&ocirc;': 'ô',
  '&sup2;': '²',
};

/** Remplace les entités HTML courantes et les entités numériques. */
export function decodeEntities(input: string): string {
  let output = input;
  for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
    output = output.split(entity).join(replacement);
  }
  return output.replace(/&#(\d+);/g, (_match, code: string) =>
    String.fromCodePoint(Number.parseInt(code, 10)),
  );
}

/**
 * Forme canonique d'un texte extrait du HTML : entités décodées, espaces
 * exotiques ramenés à l'espace simple, espaces multiples réduits, bords rognés.
 */
export function cleanText(input: string | null | undefined): string {
  if (input == null) return '';
  return decodeEntities(input).replace(EXOTIC_SPACES, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Forme canonique d'un TEXTE LONG — la description d'une annonce.
 *
 * Identique à `cleanText`, à ceci près que les RETOURS À LA LIGNE sont
 * conservés. Une description d'agence est écrite en paragraphes : « Rue
 * Smolett, tout proche du port. ⏎ Salle de douche neuve. ⏎ Libre de suite. »
 * L'aplatir en une seule ligne, comme le fait `cleanText`, rendait la fiche
 * illisible — et supprimait le seul indice de structure dont dispose
 * l'extraction d'adresse.
 *
 * Les espaces à l'intérieur d'une ligne sont réduits, les lignes vides
 * multiples ramenées à une seule : on garde la structure, pas le bruit.
 */
export function cleanMultiline(input: string | null | undefined): string {
  if (input == null) return '';
  return (
    decodeEntities(input)
      .replace(EXOTIC_SPACES, ' ')
      .replace(/\r\n?/g, '\n')
      // Espaces multiples À L'INTÉRIEUR d'une ligne uniquement.
      .replace(/[^\S\n]+/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Forme comparable d'un texte : minuscules, sans accent, sans ponctuation.
 * Utilisée pour comparer des villes et des titres lors du dédoublonnage (§14).
 *
 * @example
 * comparable('Nice — Cimiez') === 'nice cimiez'
 */
export function comparable(input: string | null | undefined): string {
  return (
    cleanText(input)
      .toLowerCase()
      .normalize('NFD')
      // Supprime les diacritiques laissés par la décomposition NFD.
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Variante identifiant : `Nice Centre` → `nice-centre`. */
export function slugify(input: string): string {
  return comparable(input).replace(/\s+/g, '-');
}

/**
 * Découpe un texte en mots significatifs, en écartant les mots vides français.
 * Sert au calcul de similarité des titres et descriptions (§14).
 */
const STOP_WORDS = new Set([
  'a',
  'au',
  'aux',
  'avec',
  'ce',
  'ces',
  'dans',
  'de',
  'des',
  'du',
  'en',
  'et',
  'il',
  'la',
  'le',
  'les',
  'ne',
  'ou',
  'par',
  'pas',
  'pour',
  'que',
  'qui',
  'sa',
  'se',
  'ses',
  'son',
  'sur',
  'un',
  'une',
  'sont',
  'est',
  'plus',
  'tres',
  'chez',
]);

export function tokenize(input: string | null | undefined): string[] {
  return comparable(input)
    .split(' ')
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}
