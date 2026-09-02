/**
 * Interrupteur des notifications navigateur (§29).
 *
 * Autonome : il gère lui-même la permission et la préférence (localStorage) ;
 * le sondage des nouvelles annonces vit dans `App`. Absent si le navigateur ne
 * sait pas notifier — mieux vaut ne rien montrer qu'un bouton inerte.
 */

import { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { disablePush, enablePush, pushSupported } from '../push.js';
import {
  notificationPermission,
  notificationsSupported,
  readOptIn,
  requestNotificationPermission,
  writeOptIn,
} from '../notifications.js';

export function NotificationBell(): React.JSX.Element | null {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    notificationPermission(),
  );
  const [optIn, setOptIn] = useState<boolean>(() => readOptIn());

  if (!notificationsSupported()) return null;

  const active = optIn && permission === 'granted';
  const blocked = permission === 'denied';

  const toggle = async (): Promise<void> => {
    if (active) {
      writeOptIn(false);
      setOptIn(false);
      void disablePush();
      return;
    }
    let granted = permission;
    if (granted !== 'granted') {
      granted = await requestNotificationPermission();
      setPermission(granted);
    }
    if (granted === 'granted') {
      writeOptIn(true);
      setOptIn(true);
      // On s'abonne AUSSI au push : sans lui, les notifications s'arrêtent dès
      // que l'onglet se ferme. L'échec n'empêche pas les notifications site
      // ouvert, qui viennent d'être activées (§69).
      if (pushSupported()) void enablePush();
    }
  };

  const label = blocked
    ? 'Notifications bloquées dans les réglages du navigateur'
    : active
      ? 'Désactiver les notifications de nouvelles annonces'
      : 'Activer les notifications de nouvelles annonces';

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={blocked}
      aria-pressed={active}
      title={label}
      aria-label={label}
      // `size-9` : 36 px, seuil en deçà duquel une cible se vise mal au doigt.
      className={`flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {active ? (
        <Bell aria-hidden="true" className="size-4" />
      ) : (
        <BellOff aria-hidden="true" className="size-4" />
      )}
    </button>
  );
}
