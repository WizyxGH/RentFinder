/**
 * Interrupteur des notifications navigateur (§29).
 *
 * Autonome : il gère lui-même la permission et la préférence (localStorage) ;
 * le sondage des nouvelles annonces vit dans `App`. Absent si le navigateur ne
 * sait pas notifier — mieux vaut ne rien montrer qu'un bouton inerte.
 */

import { useState } from 'react';
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
      className={`shrink-0 cursor-pointer rounded-lg border border-border px-2 py-1 text-base leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {active ? '🔔' : '🔕'}
    </button>
  );
}
