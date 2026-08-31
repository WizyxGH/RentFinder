/**
 * Recherche libre dans la liste des annonces (§36).
 *
 * Cherche dans ce qui identifie un logement pour un humain : le titre, la
 * commune, le quartier, la rue, la description et le nom de l'agence. Chaque
 * mot saisi doit se retrouver quelque part (ET implicite), pour que
 * « nice gambetta » restreigne au lieu d'élargir.
 *
 * La comparaison ignore casse et accents : « libération » trouve « LIBERATION »,
 * fréquent dans les annonces écrites en capitales.
 */

/** Champs d'une annonce que la recherche inspecte. */
export interface Searchable {
  readonly title: { readonly value: string | null };
  readonly description: { readonly value: string | null };
  readonly city: { readonly value: string | null };
  readonly district: { readonly value: string | null };
  readonly address: { readonly value: string | null };
  readonly postalCode: { readonly value: string | null };
  readonly contact: { readonly agencyName: string | null };
}

/** Minuscules sans accent, pour comparer « Libération » et « LIBERATION ». */
function comparable(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * `true` si l'annonce correspond à la recherche. Une recherche vide laisse tout
 * passer — elle ne doit jamais masquer d'annonce par inadvertance (§17).
 */
export function matchesSearch(listing: Searchable, query: string): boolean {
  const terms = comparable(query)
    .split(/\s+/)
    .filter((term) => term !== '');
  if (terms.length === 0) return true;

  const haystack = comparable(
    [
      listing.title.value,
      listing.description.value,
      listing.city.value,
      listing.district.value,
      listing.address.value,
      listing.postalCode.value,
      listing.contact.agencyName,
    ]
      .filter((part): part is string => part !== null && part !== '')
      .join(' '),
  );

  return terms.every((term) => haystack.includes(term));
}
