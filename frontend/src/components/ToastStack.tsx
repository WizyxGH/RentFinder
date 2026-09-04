/**
 * Bandeaux d'alerte affichés DANS la page, site ouvert (§29).
 *
 * La notification navigateur ne se voit que si l'onglet est en arrière-plan :
 * une annonce trouvée pendant qu'on regarde la liste n'apparaissait nulle part,
 * et le système la masque de toute façon quand la page a le focus. Ce bandeau
 * couvre ce trou — et il fonctionne sans permission ni service de push, donc
 * même quand les notifications sont refusées.
 *
 * Il ne remplace rien : c'est le canal « je suis déjà en train de regarder ».
 * Un clic ouvre la fiche, la croix l'écarte, et il se retire seul.
 */

import { useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { formatArea, formatCity, formatPrice, formatRooms } from '../format.js';
import type { ListingView } from '../types.js';

/** Durée d'affichage. Assez pour lire trois faits, trop court pour gêner. */
export const TOAST_MS = 9_000;

export interface Toast {
  /** Identifiant de l'annonce : sert de clé ET de cible au clic. */
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

/** Bandeau d'une annonce fraîche, à partir des mêmes faits que la notification. */
export function toastFor(listing: ListingView): Toast {
  return {
    id: listing.id,
    title: `Nouvelle annonce · ${formatCity(listing.city.value)}`,
    body: [
      formatPrice(listing.price.value),
      formatArea(listing.area.value),
      formatRooms(listing.rooms.value),
    ].join(' · '),
  };
}

/**
 * Ajoute les annonces fraîches à la pile, sans doublon et sans la noyer.
 *
 * Trois au plus : au-delà, les bandeaux masqueraient la page qu'on est
 * précisément en train de regarder. Les plus récents passent devant.
 */
export function mergeToasts(
  current: readonly Toast[],
  fresh: readonly ListingView[],
): readonly Toast[] {
  const added = fresh
    .slice(0, 3)
    .map(toastFor)
    .filter((toast) => !current.some((existing) => existing.id === toast.id));
  return added.length === 0 ? current : [...added, ...current];
}

export function ToastStack({
  toasts,
  onOpen,
  onDismiss,
}: {
  readonly toasts: readonly Toast[];
  readonly onOpen: (id: string) => void;
  readonly onDismiss: (id: string) => void;
}): React.JSX.Element | null {
  // Chaque bandeau s'efface seul. L'effet suit la LISTE : un bandeau qui
  // arrive pendant qu'un autre s'affiche obtient son propre compte à rebours,
  // et ceux qu'on a déjà écartés n'en programment plus.
  useEffect(() => {
    const timers = toasts.map((toast) => window.setTimeout(() => onDismiss(toast.id), TOAST_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      // `aria-live="polite"` : le lecteur d'écran annonce le bandeau sans
      // interrompre la lecture en cours. En bas sur téléphone (au-dessus de la
      // barre d'onglets), en haut à droite sur grand écran.
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-24 z-[3000] flex flex-col gap-2 sm:inset-x-auto sm:top-4 sm:right-4 sm:bottom-auto sm:w-80"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          // Le bandeau MONTE dans le champ de vision plutôt que d'y
          // apparaître : arrivant seul, sans geste de l'utilisateur, il faut
          // que le mouvement attire l'œil vers lui.
          className="rf-rise pointer-events-auto flex items-start gap-2 rounded-xl border border-hot bg-card p-3 shadow-lg"
        >
          <Bell aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-hot" />
          <button
            type="button"
            onClick={() => {
              onDismiss(toast.id);
              onOpen(toast.id);
            }}
            className="min-w-0 flex-1 cursor-pointer text-left"
          >
            <span className="block truncate font-semibold">{toast.title}</span>
            <span className="block truncate text-sm text-muted-foreground">{toast.body}</span>
          </button>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Masquer cette alerte"
            className="shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
