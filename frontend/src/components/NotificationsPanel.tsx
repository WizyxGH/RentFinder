/**
 * Page des notifications (§29).
 *
 * Regroupe ce que la cloche seule ne pouvait pas dire : quels canaux sont
 * actifs, ce qui bloque le cas échéant, et les annonces apparues récemment —
 * consultables même si l'on a raté l'alerte.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import type { ListingView } from '../types.js';
import {
  formatArea,
  formatDay,
  formatPostalAddress,
  formatPrice,
  formatSourceName,
  formatTime,
} from '../format.js';
import { disablePush, enablePush, pushEnabled, pushSupported } from '../push.js';
import {
  isUnreadAlert,
  notificationPermission,
  readDismissedAlerts,
  notificationsSupported,
  readOptIn,
  requestNotificationPermission,
  writeDismissedAlerts,
  writeOptIn,
} from '../notifications.js';

/** Au-delà, le glissement vaut décision : la ligne est écartée. */
const DISMISS_MIN_PX = 80;

/** Profondeur de l'historique. Au-delà, une annonce n'est plus d'actualité. */
const HISTORY_DAYS = 30;

interface NotificationsPanelProps {
  readonly listings: readonly ListingView[];
  readonly nowMs: number;
  readonly onOpen: (id: string) => void;
  /**
   * Instant de la visite PRÉCÉDENTE : ce qui est arrivé après est « non lu ».
   *
   * Figé par l'appelant à l'ouverture de la page, et non recalculé ici : sans
   * cela, arriver sur l'historique marquerait tout comme lu dans la seconde,
   * et les repères disparaîtraient sous les yeux.
   */
  readonly seenAtMs: number;
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

/** Interrupteur d'un canal d'alerte : son état EST le réglage retenu. */
function Toggle({
  label,
  detail,
  on,
  busy,
  disabled = false,
  onToggle,
}: {
  readonly label: string;
  readonly detail: string;
  readonly on: boolean;
  readonly busy: boolean;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled || busy}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{label}</span>
          <span className="block text-sm text-muted-foreground">
            {busy ? 'Un instant…' : detail}
          </span>
        </span>
        {/* Interrupteur dessiné plutôt qu'une case : l'état se lit de loin. */}
        <span
          aria-hidden="true"
          className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
            on ? 'bg-primary' : 'bg-muted-foreground/30'
          }`}
        >
          <span
            className={`size-5 rounded-full bg-white shadow transition-transform ${
              on ? 'translate-x-5' : ''
            }`}
          />
        </span>
      </button>
    </li>
  );
}

/**
 * Une ligne d'historique.
 *
 * Le prix et la ville ne suffisaient pas à reconnaître l'annonce parmi vingt :
 * la vignette la resitue d'un coup d'œil, l'adresse dit OÙ, et la source dit à
 * qui l'on aura affaire. Sans photo, un cadre neutre — on n'invente rien (§17).
 */
function HistoryRow({
  listing,
  unread,
  onOpen,
  onDismiss,
}: {
  readonly listing: ListingView;
  readonly unread: boolean;
  readonly onOpen: (id: string) => void;
  readonly onDismiss: (id: string) => void;
}): React.JSX.Element {
  // Abscisse du doigt au début du geste. Une `ref` : elle change à chaque
  // touche et ne doit déclencher aucun rendu.
  const swipeFrom = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  const photo = listing.imageUrls[0];
  const place = formatPostalAddress({
    address: listing.address.value,
    postalCode: listing.postalCode.value,
    city: listing.city.value,
    district: listing.district.value,
  });
  const sources = [...new Set(listing.occurrences.map((occurrence) => occurrence.sourceId))];
  // La ligne s'efface à mesure qu'on la pousse : le geste dit ce qu'il fera
  // avant qu'on le relâche.
  const fade = Math.max(0.25, 1 - Math.abs(offset) / (DISMISS_MIN_PX * 2));

  return (
    <button
      type="button"
      onClick={() => onOpen(listing.id)}
      // Le glissement LATÉRAL écarte la ligne ; le vertical reste à la page,
      // sans quoi on ne pourrait plus faire défiler l'historique au doigt.
      style={{ touchAction: 'pan-y', transform: `translateX(${offset}px)`, opacity: fade }}
      onTouchStart={(event) => {
        swipeFrom.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchMove={(event) => {
        const from = swipeFrom.current;
        if (from === null) return;
        setOffset((event.touches[0]?.clientX ?? from) - from);
      }}
      onTouchEnd={() => {
        swipeFrom.current = null;
        if (Math.abs(offset) >= DISMISS_MIN_PX) onDismiss(listing.id);
        setOffset(0);
      }}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-left transition-[background-color,border-color,transform,opacity] duration-150 hover:bg-muted ${
        unread ? 'border-primary/60 bg-primary/5' : 'border-border'
      }`}
    >
      {photo !== undefined ? (
        <img
          src={photo}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-14 shrink-0 rounded-lg bg-muted object-cover"
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden';
          }}
        />
      ) : (
        <span aria-hidden="true" className="size-14 shrink-0 rounded-lg bg-muted" />
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          {unread && (
            <span
              aria-label="Non lue"
              title="Non lue"
              className="size-2 shrink-0 self-center rounded-full bg-primary"
            />
          )}
          <strong className="font-semibold">{formatPrice(listing.price.value)}</strong>
          <span className="text-sm text-muted-foreground">{formatArea(listing.area.value)}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {formatTime(listing.notifiedAt ?? '')}
          </span>
        </span>
        <span className="block truncate text-sm">{place}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {sources.map(formatSourceName).join(', ')}
        </span>
      </span>
    </button>
  );
}

export function NotificationsPanel({
  listings,
  nowMs,
  onOpen,
  seenAtMs,
}: NotificationsPanelProps): React.JSX.Element {
  // Lignes écartées d'un glissement. Persisté : ranger une alerte ne doit pas
  // se défaire au premier rechargement.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(readDismissedAlerts);
  const dismiss = (id: string): void =>
    setDismissed((current) => {
      const next = new Set(current).add(id);
      writeDismissedAlerts(next);
      return next;
    });
  const [permission, setPermission] = useState(notificationPermission());
  // Deux CHOIX distincts, retenus séparément : l'un vaut pour le site ouvert
  // (préférence de ce navigateur), l'autre pour le site fermé (l'abonnement
  // push lui-même, que le navigateur conserve). Un unique interrupteur les
  // liait, et refuser l'un revenait à perdre l'autre.
  const [openOptIn, setOpenOptIn] = useState(readOptIn());
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState<'open' | 'closed' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void pushEnabled().then(setPushOn);
  }, []);

  /** Alerte pendant que le site est ouvert : bandeau, et notification si permise. */
  const toggleOpen = async (): Promise<void> => {
    setError(null);
    if (openOptIn) {
      writeOptIn(false);
      setOpenOptIn(false);
      return;
    }
    setBusy('open');
    // Le BANDEAU ne demande aucune permission : on retient le choix même si le
    // navigateur refuse la notification système. Auparavant un refus ne
    // produisait rien du tout — pas même un message —, et le réglage semblait
    // ne pas se retenir.
    writeOptIn(true);
    setOpenOptIn(true);
    const granted = await requestNotificationPermission();
    setPermission(granted);
    if (granted !== 'granted') {
      setError(
        'Le navigateur refuse les notifications système : les alertes s’afficheront ' +
          'en bandeau dans la page. Pour les recevoir hors du site, réautorisez-les ' +
          'dans les réglages du navigateur.',
      );
    }
    setBusy(null);
  };

  /** Alerte site fermé : l'abonnement push, conservé par le navigateur. */
  const toggleClosed = async (): Promise<void> => {
    setError(null);
    setBusy('closed');
    if (pushOn) {
      await disablePush();
      setPushOn(false);
    } else {
      const granted = await requestNotificationPermission();
      setPermission(granted);
      const failure = granted === 'granted' ? await enablePush() : 'Permission refusée.';
      setError(failure);
      setPushOn(failure === null);
    }
    setBusy(null);
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
      if (dismissed.has(listing.id)) return false;
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

      {/* DEUX interrupteurs : chacun se retient pour lui-même. Un seul bouton
        « Activer les notifications » liait les deux, et un refus de permission
        n'affichait rien du tout — le réglage semblait ne pas tenir. */}
      <ul className="flex flex-col gap-2">
        <Toggle
          label="Pendant que le site est ouvert"
          detail={
            openOptIn
              ? permission === 'granted'
                ? 'Bandeau dans la page et notification du navigateur.'
                : 'Bandeau dans la page — le navigateur refuse les notifications système.'
              : 'Aucune alerte tant que vous consultez le site.'
          }
          on={openOptIn}
          busy={busy === 'open'}
          onToggle={() => void toggleOpen()}
        />
        <Toggle
          label="Site fermé"
          detail={
            pushOn
              ? 'Cet appareil est abonné : la collecte vous alerte application fermée.'
              : pushSupported()
                ? 'Recevoir les alertes même sans avoir le site ouvert.'
                : 'Indisponible ici. Sur iPhone, ajoutez d’abord le site à l’écran d’accueil (Partager → Sur l’écran d’accueil).'
          }
          on={pushOn}
          busy={busy === 'closed'}
          disabled={!pushSupported()}
          onToggle={() => void toggleClosed()}
        />
      </ul>

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
                      <HistoryRow
                        listing={listing}
                        unread={isUnreadAlert(listing, seenAtMs)}
                        onOpen={onOpen}
                        onDismiss={dismiss}
                      />
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
