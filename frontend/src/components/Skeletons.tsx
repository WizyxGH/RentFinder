/**
 * Squelettes de chargement (§36, §39).
 *
 * « Chargement… » centré ne disait rien de ce qui arrivait et faisait sauter
 * la page d'un coup quand la liste apparaissait. Un squelette occupe D'EMBLÉE
 * la place que prendra le contenu : la mise en page ne bouge plus, et l'attente
 * paraît plus courte parce qu'on voit déjà la forme du résultat.
 *
 * Aucun chiffre n'y figure — un squelette suggère une structure, il ne montre
 * jamais de valeur qui pourrait passer pour une donnée (§17).
 */

/** Bloc gris animé. Brique de base de tous les squelettes. */
export function SkeletonBlock({
  className = '',
}: {
  readonly className?: string;
}): React.JSX.Element {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

/** Silhouette d'une carte d'annonce : photo, titre, chiffres, ligne de source. */
function ListingCardSkeleton(): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card p-3">
      <SkeletonBlock className="-mx-3 -mt-3 mb-3 h-44 rounded-none" />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <SkeletonBlock className="h-5 w-2/3" />
          <SkeletonBlock className="mt-1.5 h-4 w-1/3" />
        </div>
        <SkeletonBlock className="size-14 shrink-0 rounded-lg" />
      </div>
      <div className="mt-3 flex gap-2">
        <SkeletonBlock className="h-4 w-16" />
        <SkeletonBlock className="h-4 w-16" />
        <SkeletonBlock className="h-4 w-16" />
      </div>
      <SkeletonBlock className="mt-3 h-3.5 w-1/2" />
    </div>
  );
}

/**
 * Liste en cours de chargement. Trois cartes suffisent : au-delà, le squelette
 * dépasse l'écran sans rien apprendre de plus.
 */
export function ListingListSkeleton({ count = 3 }: { readonly count?: number }): React.JSX.Element {
  return (
    <div
      // `aria-busy` + `role="status"` : un lecteur d'écran annonce l'attente
      // au lieu de lire une suite de blocs vides.
      role="status"
      aria-busy="true"
      aria-label="Chargement des annonces"
      className="grid gap-3 lg:grid-cols-2"
    >
      {Array.from({ length: count }, (_, index) => (
        <ListingCardSkeleton key={index} />
      ))}
    </div>
  );
}

/** Silhouette de la carte géographique, à la hauteur qu'elle occupera. */
export function MapSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label="Chargement de la carte">
      <SkeletonBlock className="h-[60vh] w-full rounded-2xl" />
    </div>
  );
}

/** Silhouette d'un panneau de texte : un titre et quelques lignes. */
export function PanelSkeleton({ rows = 4 }: { readonly rows?: number }): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label="Chargement" className="flex flex-col gap-2">
      <SkeletonBlock className="h-5 w-1/3" />
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonBlock key={index} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

/**
 * Silhouette d'une FICHE d'annonce : photo, titre, chiffres, corps de texte.
 *
 * Elle manquait, et son absence produisait le pire des écrans : ouvrir une
 * adresse `/annonce/…` directement — un lien collé, un rafraîchissement —
 * n'affichait RIEN, pas même un fond, tant que l'annonce n'était pas revenue
 * de la base.
 */
export function ListingDetailSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label="Chargement de l’annonce">
      <SkeletonBlock className="h-9 w-24" />
      <SkeletonBlock className="mt-3 h-56 w-full rounded-2xl" />
      <SkeletonBlock className="mt-4 h-7 w-3/4" />
      <SkeletonBlock className="mt-2 h-5 w-1/3" />
      <div className="mt-4 flex gap-2">
        <SkeletonBlock className="h-10 w-28 rounded-full" />
        <SkeletonBlock className="h-10 w-28 rounded-full" />
      </div>
      <div className="mt-5 flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonBlock key={index} className="h-4 w-full" />
        ))}
        <SkeletonBlock className="h-4 w-2/3" />
      </div>
    </div>
  );
}

/**
 * Silhouette d'une liste d'entrées courtes : agences, sources, recherches
 * enregistrées, réglages. Ces écrans affichaient une page vide pendant leur
 * chargement, ce qui se lit comme « il n'y a rien » plutôt que « ça arrive ».
 */
export function RowsSkeleton({ rows = 5 }: { readonly rows?: number }): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label="Chargement" className="flex flex-col gap-2">
      <SkeletonBlock className="mb-2 h-7 w-40" />
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonBlock key={index} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
