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
  const locality = [postalCode, city !== undefined && city !== '' ? toTitleCase(city) : '']
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

  const district = parts.district?.trim();
  if (district !== undefined && district !== '') {
    return formatAddress({ ...parts, street: null, city: parts.city })
      ? `${toTitleCase(district)}, ${formatAddress({ ...parts, street: null })}`
      : toTitleCase(district);
  }
  return formatAddress({ ...parts, street: null });
}
