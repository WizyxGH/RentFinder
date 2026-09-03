/**
 * Sondage des nouvelles annonces, SITE OUVERT (§29).
 *
 * Deux canaux partent du même sondage, et c'est voulu :
 *   - un BANDEAU dans la page, qui ne demande aucune permission — c'est le
 *     canal « je suis déjà en train de regarder », le seul qui fonctionne quand
 *     l'onglet a le focus (le système masque alors les notifications) ;
 *   - la NOTIFICATION navigateur, qui prend le relais onglet en arrière-plan,
 *     si la permission a été accordée.
 *
 * Extrait de `App` : la boucle, son annulation et la mémoire des annonces déjà
 * vues forment un tout, et les y laisser poussait le composant au-delà de la
 * complexité tolérée.
 */

import { useEffect } from 'react';
import { fetchListings, isDemoMode } from './api/client.js';
import {
  diffForNotification,
  fireNotifications,
  NOTIFY_POLL_MS,
  readOptIn,
  readSeen,
  writeSeen,
} from './notifications.js';
import type { ListingView } from './types.js';

export function useNewListingAlerts({
  onFresh,
  onOpen,
}: {
  /** Annonces jamais vues jusqu'ici, dans les critères. Jamais appelé à vide. */
  readonly onFresh: (fresh: readonly ListingView[]) => void;
  /** Ouverture d'une fiche depuis une notification cliquée. */
  readonly onOpen: (id: string) => void;
}): void {
  useEffect(() => {
    if (isDemoMode()) return undefined; // pas de vraies données à surveiller

    let cancelled = false;
    const tick = async (): Promise<void> => {
      if (!readOptIn()) return;
      try {
        const response = await fetchListings({ sort: 'recent' });
        if (cancelled) return;
        // Le premier sondage amorce la mémoire sans rien signaler : sinon tout
        // le stock existant sonnerait d'un coup (voir `diffForNotification`).
        const { fresh, nextSeen } = diffForNotification(response.listings, readSeen());
        writeSeen(nextSeen);
        if (fresh.length === 0) return;
        onFresh(fresh);
        // Silencieux si la permission n'a pas été accordée : le bandeau, lui,
        // s'affiche quand même.
        fireNotifications(fresh, onOpen);
      } catch {
        /* réseau indisponible : nouveau sondage au prochain tick */
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), NOTIFY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onFresh, onOpen]);
}
