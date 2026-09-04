/**
 * Réglage des alertes (§29) — écran Paramètres → Notifications.
 *
 * IL N'Y AVAIT QU'UN INTERRUPTEUR, posé au milieu des paramètres : tout ou
 * rien, pour la seule famille d'alertes qui existait. Or une recherche de
 * logement a plusieurs moments qui méritent qu'on lève les yeux, et ils n'ont
 * pas la même valeur selon les jours.
 *
 * L'ORDRE DE L'ÉCRAN EST CELUI DE LA DÉCISION. D'abord un seul geste — être
 * prévenu, ou non —, qui allume tout : c'est ce que veut quelqu'un qui arrive
 * ici. Le détail vient ensuite, pour éteindre ce qui gêne ; il n'apparaît que
 * si les alertes sont allumées, faute de quoi on réglerait finement quelque
 * chose de muet.
 *
 * L'E-MAIL EST MONTRÉ ÉTEINT ET INERTE. Il n'est pas branché : l'afficher
 * réglable promettrait des messages qui n'arriveraient jamais (§17). Le montrer
 * annoncé vaut mieux que le laisser deviner absent.
 */

import { useEffect, useState } from 'react';
import { ArrowLeft, Bell, Clock, Heart, Mail } from './icons.js';
import type { IconComponent } from './icons.js';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationKind,
  type NotificationPreferences,
} from '@rentfinder/shared';
import { fetchNotificationPreferences, saveNotificationPreferences } from '../api/client.js';
import { disablePush, enablePush, pushEnabled, pushSupported } from '../push.js';
import { readOptIn, requestNotificationPermission, writeOptIn } from '../notifications.js';
import { Button } from '@/components/ui/button.js';
import { Switch } from '@/components/ui/switch.js';
import { SettingsGroup, SettingsRow } from './SettingsRow.js';

interface KindInfo {
  readonly key: NotificationKind;
  readonly label: string;
  readonly hint: string;
  readonly Icon: IconComponent;
  /** `true` quand le canal n'est pas encore en service : montré, non réglable. */
  readonly comingSoon?: boolean;
}

const KINDS: readonly KindInfo[] = [
  {
    key: 'newListings',
    label: 'Nouvelles annonces',
    hint: 'Dès qu’un logement entre dans vos critères.',
    Icon: Bell,
  },
  {
    key: 'applicationReminders',
    label: 'Rappel de candidature',
    hint: 'Un favori mis de côté et jamais contacté : le marché ne patiente pas.',
    Icon: Clock,
  },
  {
    key: 'favoriteGone',
    label: 'Favori qui disparaît',
    hint: 'L’annonce a quitté sa source — elle est probablement louée.',
    Icon: Heart,
  },
  {
    key: 'email',
    label: 'Doubler par e-mail',
    hint: 'Bientôt : les mêmes alertes dans votre boîte, en plus du téléphone.',
    Icon: Mail,
    comingSoon: true,
  },
];

export function NotificationSettingsPanel({
  onBack,
}: {
  readonly onBack: () => void;
}): React.JSX.Element {
  const [on, setOn] = useState(readOptIn());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );

  // L'abonnement push fait foi au chargement : il survit à un vidage du
  // stockage local, là où la préférence de bandeau, non.
  useEffect(() => {
    void pushEnabled().then((subscribed) => {
      if (subscribed) setOn(true);
    });
    void fetchNotificationPreferences().then(setPreferences);
  }, []);

  const toggleMaster = async (): Promise<void> => {
    setError(null);
    if (on) {
      writeOptIn(false);
      setOn(false);
      setBusy(true);
      await disablePush();
      setBusy(false);
      return;
    }

    writeOptIn(true);
    setOn(true);
    setBusy(true);
    const granted = await requestNotificationPermission();
    if (granted !== 'granted') {
      // Le réglage TIENT malgré le refus : les alertes s'afficheront en
      // bandeau. Auparavant un refus ne produisait rien du tout, et
      // l'interrupteur semblait ne pas se retenir.
      setError(
        'Le navigateur refuse les notifications : les alertes s’afficheront en ' +
          'bandeau dans la page. Pour les recevoir hors du site, réautorisez-les ' +
          'dans ses réglages.',
      );
      setBusy(false);
      return;
    }
    if (pushSupported()) setError(await enablePush());
    setBusy(false);
  };

  const toggleKind = (key: NotificationKind, value: boolean): void => {
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    // Écriture immédiate, sans bouton : un interrupteur qui demanderait ensuite
    // de valider ne serait plus un interrupteur.
    void saveNotificationPreferences(next).catch(() =>
      setError('Le réglage n’a pas pu être enregistré.'),
    );
  };

  return (
    <div>
      <header className="mb-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Retour
        </Button>
      </header>

      <h1 className="mb-4 text-xl font-bold">Notifications</h1>

      {/* LE GESTE UNIQUE D'ABORD. Sous le capot il y a deux mécanismes — la
        préférence de ce navigateur pour le bandeau, et l'abonnement que le
        navigateur conserve pour le site fermé. Ils s'allumaient séparément, ce
        qui demandait de comprendre la plomberie pour être prévenu. */}
      <div className="border-border flex items-center gap-3 rounded-xl border p-3">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Recevoir des alertes</span>
          <span className="text-muted-foreground block text-sm">
            {busy
              ? 'Un instant…'
              : on
                ? 'Bandeau dans la page, et notification même site fermé.'
                : 'Aucune alerte ne vous parviendra.'}
          </span>
        </span>
        <Switch
          checked={on}
          disabled={busy}
          onCheckedChange={() => void toggleMaster()}
          aria-label="Recevoir des alertes"
        />
      </div>

      {error !== null && (
        <p
          className="border-border mt-3 rounded-xl border px-3 py-2 text-[0.88rem] text-muted-foreground"
          role="alert"
        >
          {error}
        </p>
      )}

      {on && (
        <SettingsGroup title="Ce dont vous voulez être prévenu">
          {KINDS.map(({ key, label, hint, Icon, comingSoon }) => (
            <SettingsRow
              key={key}
              Icon={Icon}
              tone={comingSoon !== true && preferences[key] ? 'done' : 'muted'}
              label={label}
              hint={hint}
              {...(comingSoon === true ? { badge: 'Bientôt' } : {})}
              trailing={
                <Switch
                  checked={comingSoon === true ? false : preferences[key]}
                  disabled={comingSoon === true}
                  onCheckedChange={(value) => toggleKind(key, value)}
                  aria-label={label}
                />
              }
            />
          ))}
        </SettingsGroup>
      )}
    </div>
  );
}
