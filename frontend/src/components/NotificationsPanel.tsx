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
import { formatArea, formatPrice, formatCity, formatDay, formatTime } from '../format.js';
import { disablePush, enablePush, pushEnabled, pushSupported } from '../push.js';
import {
  notificationPermission,
  notificationsSupported,
  readOptIn,
  requestNotificationPermission,
  writeOptIn,
} from '../notifications.js';

/** Profondeur de l'historique. Au-delà, une annonce n'est plus d'actualité. */
const HISTORY_DAYS = 30;

interface NotificationsPanelProps {
  readonly listings: readonly ListingView[];
  readonly nowMs: number;
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
  nowMs,
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

  // HISTORIQUE : les annonces réellement signalées, datées par la collecte.
  // Auparavant cette section comparait la liste courante à une mémoire du
  // navigateur — perdue au premier nettoyage, vide sur un autre appareil, et
  // muette au tout premier passage. La date vient maintenant de la base, donc
  // l'historique est le même partout.
  //
  // Les annonces sans date sont celles notifiées avant que l'horodatage
  // n'existe : on ne les invente pas (§17). Celles devenues louées ou
  // inactives ne sont plus rapatriées et sortent donc de l'historique — c'est
  // le prix à payer pour ne coûter AUCUNE lecture Turso de plus.
  const horizon = nowMs - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const history = listings
    .filter((listing) => {
      const at = listing.notifiedAt;
      return at !== null && at !== undefined && Date.parse(at) >= horizon;
    })
    .sort((a, b) => Date.parse(b.notifiedAt ?? '') - Date.parse(a.notifiedAt ?? ''));

  // Regroupement par jour, l'ordre des annonces étant déjà décroissant.
  const days: { label: string; items: ListingView[] }[] = [];
  for (const listing of history) {
    const label = formatDay(listing.notifiedAt ?? '', nowMs);
    const last = days[days.length - 1];
    if (last?.label === label) last.items.push(listing);
    else days.push({ label, items: [listing] });
  }

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
          {history.length > 0 ? `Historique (${history.length})` : 'Historique'}
        </h3>
        {days.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune alerte sur les {HISTORY_DAYS} derniers jours. Les annonces signalées
            s’afficheront ici, datées — même si vous avez manqué la notification.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {days.map((day) => (
              <div key={day.label}>
                <h4 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {day.label}
                </h4>
                <ul className="flex flex-col gap-1.5">
                  {day.items.map((listing) => (
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
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {formatTime(listing.notifiedAt ?? '')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
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
