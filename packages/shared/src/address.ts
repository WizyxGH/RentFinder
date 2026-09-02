/**
 * Formatage des adresses, style postal français / Google Maps (§20).
 *
 * Les sources publient la ville dans des casses très variables (« nice »,
 * « NICE », « Nice ») parce que la normalisation la range en minuscules pour
 * pouvoir la comparer. À l'AFFICHAGE, on veut partout la même forme, celle que
 * l'utilisateur lit sur une carte ou une enveloppe :
 *
 *     12 Rue de France, 06000 Nice
 *
 * Un seul formateur, utilisé par l'interface, les notifications et les
 * messages : c'est ce qui garantit l'harmonisation. On n'invente jamais une
 * partie absente (§17) — les composants manquants sont simplement omis.
 */

/** Petits mots qui restent en minuscules à l'intérieur d'un nom propre. */
const LOWERCASE_PARTICLES = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'sur',
  'sous',
  'en',
  'et',
  'd',
  'l',
]);

/**
 * Met un nom propre en casse de titre en respectant les usages français :
 * « saint-laurent-du-var » → « Saint-Laurent-du-Var », « nice » → « Nice ».
 * Les particules internes restent minuscules, le premier mot jamais.
 */
export function toTitleCase(value: string): string {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (cleaned === '') return '';

  // On traite les mots ET les segments séparés par un tiret, en gardant le
  // séparateur d'origine (« Saint-Laurent-du-Var » garde ses tirets).
  let isFirst = true;
  return cleaned.replace(/[^\s-']+/g, (word) => {
    const lower = word.toLocaleLowerCase('fr-FR');
    const capitalize = isFirst || !LOWERCASE_PARTICLES.has(lower);
    isFirst = false;
    return capitalize ? lower.charAt(0).toLocaleUpperCase('fr-FR') + lower.slice(1) : lower;
  });
}

/**
 * Communes écrites comme sur une carte.
 *
 * La normalisation range la ville en forme comparable — minuscules, sans
 * accent ni tiret — pour pouvoir la comparer. Recapitaliser ne suffit donc
 * pas : « cagnes sur mer » donnait « Cagnes Sur Mer », et « saint andre de la
 * roche » perdait son accent. Ce sont des NOMS PROPRES connus, pas des données
 * d'annonce : les rétablir n'invente rien (§17), au contraire d'un accent
 * deviné sur un nom de rue.
 *
 * La clé est la forme comparable ; la valeur, l'orthographe officielle.
 */
const COMMUNES: Record<string, string> = {
  nice: 'Nice',
  cannes: 'Cannes',
  antibes: 'Antibes',
  menton: 'Menton',
  grasse: 'Grasse',
  vallauris: 'Vallauris',
  vence: 'Vence',
  carros: 'Carros',
  biot: 'Biot',
  valbonne: 'Valbonne',
  levens: 'Levens',
  mougins: 'Mougins',
  beausoleil: 'Beausoleil',
  contes: 'Contes',
  drap: 'Drap',
  falicon: 'Falicon',
  colomars: 'Colomars',
  aspremont: 'Aspremont',
  gattieres: 'Gattières',
  eze: 'Èze',
  monaco: 'Monaco',
  toulon: 'Toulon',
  bessenay: 'Bessenay',
  'le cannet': 'Le Cannet',
  'la turbie': 'La Turbie',
  'la trinite': 'La Trinité',
  'cagnes sur mer': 'Cagnes-sur-Mer',
  'juan les pins': 'Juan-les-Pins',
  'la colle sur loup': 'La Colle-sur-Loup',
  'villeneuve loubet': 'Villeneuve-Loubet',
  'saint laurent du var': 'Saint-Laurent-du-Var',
  'saint andre de la roche': 'Saint-André-de-la-Roche',
  'saint andre les alpes': 'Saint-André-les-Alpes',
  'saint jeannet': 'Saint-Jeannet',
  'saint jean cap ferrat': 'Saint-Jean-Cap-Ferrat',
  'tourrette levens': 'Tourrette-Levens',
  'roquebrune cap martin': 'Roquebrune-Cap-Martin',
  'cap d ail': "Cap-d'Ail",
  'beaulieu sur mer': 'Beaulieu-sur-Mer',
  'villefranche sur mer': 'Villefranche-sur-Mer',
  'mandelieu la napoule': 'Mandelieu-la-Napoule',
  mandelieu: 'Mandelieu-la-Napoule',
  roquebilliere: 'Roquebillière',
  rocquebilliere: 'Roquebillière',
  'vieil antibes': 'Antibes',
};

/** Forme comparable : minuscules, sans accent, tirets et apostrophes en espaces. */
function comparableCommune(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Commune telle qu'une carte l'écrit : « Cagnes-sur-Mer », « Cap-d'Ail ».
 *
 * Certaines sources collent le QUARTIER au nom de la commune — « nice magnan »,
 * « mougins tournamy » —, ce qui faisait apparaître autant de villes
 * différentes dans la liste. Quand le début correspond à une commune connue,
 * on ne garde qu'elle : c'est ce que rendrait une carte. Le quartier n'est pas
 * perdu pour autant, il a son propre champ.
 *
 * Une commune inconnue est simplement mise en casse de titre : mieux vaut
 * l'afficher telle quelle que la déformer.
 */
export function formatCommune(city: string): string {
  return splitCommune(city).commune;
}

/**
 * Sépare la commune de ce que la source lui a collé.
 *
 * « nice magnan » → commune « Nice », quartier « Magnan ». Le suffixe n'est
 * PAS jeté : pour quinze annonces il est la seule localisation connue — ni
 * adresse ni champ quartier — et le supprimer les aurait ramenées à « Nice »
 * tout court. Il n'est promu qu'à défaut de quartier publié (§17).
 */
export function splitCommune(city: string): {
  readonly commune: string;
  readonly district: string | null;
} {
  const comparable = comparableCommune(city);
  if (comparable === '') return { commune: '', district: null };

  const exact = COMMUNES[comparable];
  if (exact !== undefined) return { commune: exact, district: null };

  // Préfixe le PLUS LONG d'abord : « saint andre de la roche » ne doit pas se
  // réduire à une commune plus courte qui commencerait pareil.
  const words = comparable.split(' ');
  for (let length = words.length - 1; length >= 1; length--) {
    const candidate = COMMUNES[words.slice(0, length).join(' ')];
    if (candidate !== undefined) {
      const rest = words.slice(length).join(' ');
      return { commune: candidate, district: rest === '' ? null : toTitleCase(rest) };
    }
  }
  return { commune: toTitleCase(city), district: null };
}

export interface AddressParts {
  /** Rue publiée (numéro + voie), si connue. */
  readonly street?: string | null;
  readonly postalCode?: string | null;
  readonly city?: string | null;
}

/**
 * Adresse sur une ligne, style Google Maps : « 12 Rue de France, 06000 Nice ».
 * Les parties absentes sont omises sans laisser de séparateur orphelin (§17).
 * Rend une chaîne vide si rien n'est connu.
 */
export function formatAddress(parts: AddressParts): string {
  const street = parts.street?.trim();
  const postalCode = parts.postalCode?.trim();
  const city = parts.city?.trim();

  // « 06000 Nice » : en France le code postal précède la commune.
  const locality = [postalCode, city !== undefined && city !== '' ? formatCommune(city) : '']
    .filter((part) => part !== undefined && part !== '')
    .join(' ');

  return [street !== undefined && street !== '' ? toTitleCase(street) : '', locality]
    .filter((part) => part !== '')
    .join(', ');
}

/**
 * Libellé de localisation le plus précis disponible, pour une carte ou une
 * notification : rue si publiée, sinon quartier, sinon commune — toujours
 * complété de la commune. Vide si rien n'est connu (§17).
 */
export function formatLocation(
  parts: AddressParts & { readonly district?: string | null },
): string {
  const street = parts.street?.trim();
  if (street !== undefined && street !== '') return formatAddress(parts);

  // Quartier publié, ou à défaut celui que la source avait collé à la commune.
  const carried = parts.city != null ? splitCommune(parts.city).district : null;
  const district =
    (parts.district?.trim() ?? '') !== '' ? parts.district?.trim() : (carried ?? undefined);
  if (district !== undefined && district !== '') {
    return formatAddress({ ...parts, street: null, city: parts.city })
      ? `${toTitleCase(district)}, ${formatAddress({ ...parts, street: null })}`
      : toTitleCase(district);
  }
  return formatAddress({ ...parts, street: null });
}
