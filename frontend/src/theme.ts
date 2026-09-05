/**
 * Clair, sombre, ou ce que dit l'appareil (§39).
 *
 * LE THÈME SUIVAIT L'APPAREIL, SANS RECOURS. C'est le bon défaut — on cherche
 * un logement le soir au lit autant qu'au bureau — mais pas une réponse
 * suffisante : un téléphone réglé en sombre toute la journée rend les photos
 * d'annonces ternes, et certains yeux préfèrent l'inverse de leur système.
 *
 * L'IMPLÉMENTATION TIENT EN UN ATTRIBUT. Les couleurs du site sont écrites en
 * `light-dark(clair, sombre)`, et c'est `color-scheme` qui tranche. Poser
 * `data-theme` sur la racine suffit donc : aucune classe `dark:` à répéter dans
 * les composants, aucun second jeu de variables à tenir à jour, et les contrôles
 * natifs — cases, menus, barres de défilement — suivent d'eux-mêmes.
 *
 * L'ATTRIBUT EST INDISPENSABLE, et ce n'était pas évident. On posait d'abord
 * `style.colorScheme` directement, ce qui aurait dû suffire — et ne suffisait
 * pas : `light-dark()` n'existe pas dans le CSS publié. Lightning CSS, que Vite
 * emploie pour minifier, le remplace par un couple de variables qu'il bascule
 * aux seuls endroits où il VOIT un `color-scheme` écrit dans la feuille de
 * style. Un style posé en JavaScript lui est invisible : les couleurs
 * continuaient donc de suivre le système, et les boutons « Clair » et
 * « Sombre » ne changeaient rien. `styles.css` porte les deux règles
 * `html[data-theme=…]` qui rendent la bascule visible à la compilation.
 *
 * LE CHOIX EST LOCAL À L'APPAREIL, volontairement. C'est une préférence
 * d'affichage, comme la luminosité : elle n'a pas à voyager du téléphone vers
 * l'ordinateur, où l'éclairage n'est pas le même.
 */

export type ThemePreference = 'auto' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['auto', 'light', 'dark'];

export const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  auto: 'Automatique',
  light: 'Clair',
  dark: 'Sombre',
};

export const THEME_HINTS: Readonly<Record<ThemePreference, string>> = {
  auto: 'Suit le réglage de votre appareil.',
  light: 'Toujours clair, quelle que soit l’heure.',
  dark: 'Toujours sombre, plus reposant le soir.',
};

const KEY = 'rentfinder.theme';

function isPreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/** Le choix mémorisé, ou « automatique » — le défaut, et le plus souvent juste. */
export function readTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(KEY);
    return isPreference(stored) ? stored : 'auto';
  } catch {
    // Stockage refusé (navigation privée, réglage strict) : on n'insiste pas,
    // le thème de l'appareil reste une réponse valable (§69).
    return 'auto';
  }
}

/**
 * Applique le thème et le mémorise.
 *
 * Sur la RACINE et non sur le corps : c'est elle qui détermine la couleur de la
 * zone hors page — celle qu'on voit en tirant sur une liste, et qui trahissait
 * un fond blanc sous un site sombre.
 *
 * « Automatique » RETIRE l'attribut au lieu d'en poser un troisième : c'est
 * l'absence de consigne qui laisse la requête média du système décider.
 */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
  try {
    if (preference === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, preference);
  } catch {
    /* le thème vaudra pour cette session */
  }
}

/**
 * À appeler AVANT le premier rendu.
 *
 * Sans cela, la page s'affiche une fraction de seconde dans le thème de
 * l'appareil avant de basculer — un éclair blanc dans une chambre sombre, ce
 * qui est précisément ce qu'on cherchait à éviter.
 */
export function initTheme(): void {
  applyTheme(readTheme());
}
