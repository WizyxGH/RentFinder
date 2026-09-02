/**
 * Page des notifications (§29).
 *
 * Regroupe ce que la cloche seule ne pouvait pas dire : quels canaux sont
 * actifs, ce qui bloque le cas échéant, et les annonces apparues récemment —
 * consultables même si l'on a raté l'alerte.
 */

import { useEffect, useState } from 'react';
import { Bell, BellOff, Check, TriangleAlert } from 'lucide-react';
import type { ListingView } from '../types.js';
import { Button } from '@/components/ui/button.js';
import { formatArea, formatPrice, formatCity } from '../format.js';
import { disablePush, enablePush, pushEnabled, pushSupported } from '../push.js';
import {
  notificationPermission,
  notificationsSupported,
  readOptIn,
  readSeen,
  requestNotificationPermission,
  writeOptIn,
} from '../notifications.js';

interface NotificationsPanelProps {
  readonly listings: readonly ListingView[];
  readonly onOpen: (id: string) => void;
}

/** Une ligne d'état : ce qui marche, ce qui manque, et pourquoi. */
function Status({
  ok,
  label,
  detail,
}: {
  readonly ok: boolean;
  readonly label: string;
  readonly detail: string;
}): React.JSX.Element {
  return (
    <li className="flex gap-2.5 rounded-xl border border-border p-3">
      <span
        aria-hidden="true"
        className={`pt-0.5 ${ok ? 'text-primary' : 'text-muted-foreground'}`}
      >
        {ok ? <Check className="size-4" /> : <TriangleAlert className="size-4" />}
      </span>
      <span>
        <strong className="font-medium">{label}</strong>
        <span className="block text-sm text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}

export function NotificationsPanel({
  listings,
  onOpen,
}: NotificationsPanelProps): React.JSX.Element {
  const [permission, setPermission] = useState(notificationPermission());
  const [optIn, setOptIn] = useState(readOptIn());
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void pushEnabled().then(setPushOn);
  }, []);

  const active = optIn && permission === 'granted';

  const toggle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    if (active) {
      writeOptIn(false);
      setOptIn(false);
      await disablePush();
      setPushOn(false);
    } else {
      const granted = await requestNotificationPermission();
      setPermission(granted);
      if (granted === 'granted') {
        writeOptIn(true);
        setOptIn(true);
        const failure = await enablePush();
        setError(failure);
        setPushOn(failure === null);
      }
    }
    setBusy(false);
  };

  // « Nouvelles » = jamais vues par le sondage de notification. C'est la même
  // mémoire que celle des alertes : la page montre donc exactement ce qui a été
  // (ou aurait été) signalé.
  const seen = readSeen();
  // Au tout premier passage, la mémoire est vide : tout paraîtrait « nouveau ».
  // On n'annonce donc rien tant qu'elle n'a pas été amorcée.
  const fresh = seen.initialized
    ? listings.filter((listing) => !seen.ids.has(listing.id)).slice(0, 20)
    : [];

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Être prévenu dès qu’une annonce entre dans vos critères.
        </p>
      </div>

      <Button
        onClick={() => void toggle()}
        disabled={busy}
        variant={active ? 'outline' : 'default'}
      >
        {active ? <BellOff className="size-4" /> : <Bell className="size-4" />}
        {busy ? 'Un instant…' : active ? 'Désactiver' : 'Activer les notifications'}
      </Button>

      {error !== null && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        <Status
          ok={permission === 'granted'}
          label="Permission du navigateur"
          detail={
            permission === 'granted'
              ? 'Accordée.'
              : permission === 'denied'
                ? 'Refusée — elle se réactive dans les réglages du navigateur.'
                : 'Pas encore demandée.'
          }
        />
        <Status
          ok={active}
          label="Pendant que le site est ouvert"
          detail={
            active
              ? 'Une alerte apparaît dès qu’une annonce est trouvée.'
              : 'Inactif : activez les notifications ci-dessus.'
          }
        />
        <Status
          ok={pushOn}
          label="Site fermé"
          detail={
            pushOn
              ? 'Votre appareil est abonné : la collecte vous alerte même application fermée.'
              : pushSupported()
                ? 'Pas encore abonné. Activez les notifications ci-dessus.'
                : 'Indisponible ici. Sur iPhone, ajoutez d’abord le site à l’écran d’accueil (Partager → Sur l’écran d’accueil).'
          }
        />
        <Status
          ok
          label="Telegram"
          detail="Canal principal, le plus complet : photo, loyer, surface, téléphone. Réglé sur votre machine."
        />
      </ul>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
          {fresh.length > 0 ? `Nouveautés (${fresh.length})` : 'Nouveautés'}
        </h3>
        {fresh.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Rien de neuf depuis votre dernier passage. Les annonces apparues entre deux visites
            s’afficheront ici, même si vous avez manqué l’alerte.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {fresh.map((listing) => (
              <li key={listing.id}>
                <button
                  type="button"
                  onClick={() => onOpen(listing.id)}
                  className="flex w-full cursor-pointer items-baseline gap-2 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted"
                >
                  <span className="font-semibold">{formatPrice(listing.price.value)}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatArea(listing.area.value)} · {formatCity(listing.city.value)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!notificationsSupported() && (
        <p className="text-sm text-muted-foreground">
          Ce navigateur ne gère pas les notifications. La liste des nouveautés reste consultable
          ci-dessus.
        </p>
      )}
    </section>
  );
}
