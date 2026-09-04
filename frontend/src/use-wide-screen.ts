/**
 * « L'écran est-il assez large pour montrer les annonces ET le plan ? »
 *
 * La question se pose en JavaScript et non en CSS, pour une raison précise :
 * en la traitant par classes utilitaires, il faudrait MONTER les deux mises en
 * page et n'en cacher qu'une. Le plan est chargé à la demande (Leaflet, 152 ko)
 * — le monter pour le cacher annulerait exactement l'économie qu'on en tire
 * (§65).
 *
 * Le seuil est celui de `lg` chez Tailwind, 1024 px : au-dessous, deux colonnes
 * réduiraient les cartes à des vignettes illisibles.
 */

import { useEffect, useState } from 'react';

/** Seuil `lg` de Tailwind. Écrit en dur ici : c'est un contrat avec le CSS. */
const WIDE = '(min-width: 1024px)';

/**
 * `matchMedia` peut manquer — jsdom ne l'implémente pas, et les tests montent
 * l'application entière. On répond alors « pas large » : la liste seule reste
 * une vue complète, là où une exception aurait vidé l'écran (§69).
 */
function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(WIDE)
    : null;
}

export function useWideScreen(): boolean {
  const [wide, setWide] = useState(() => query()?.matches ?? false);

  useEffect(() => {
    const media = query();
    if (media === null) return;
    const update = (): void => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return wide;
}
