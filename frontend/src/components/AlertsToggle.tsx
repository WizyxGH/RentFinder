/**
 * L'interrupteur des alertes : être prévenu, ou non.
 *
 * IL A DÉMÉNAGÉ. Il vivait sur la page Notifications, où l'on va pour voir ce
 * qui est passé — pas pour régler quoi que ce soit. Sa place est dans les
 * Paramètres, avec les autres réglages, et la page Notifications n'est plus
 * qu'un historique.
 *
 * UN SEUL BOUTON pour deux mécanismes. Sous le capot il y a la préférence de ce
 * navigateur (le bandeau dans la page) et l'abonnement push que le navigateur
 * conserve (le site fermé) ; ils s'allumaient séparément, ce qui demandait de
 * comprendre la plomberie pour être prévenu. Ils s'allument ensemble.
 *
 * À l'allumage, le bandeau est acquis d'office — il ne demande aucune
 * permission. On tente ensuite la notification du navigateur puis l'abonnement ;
 * s'ils échouent, le réglage TIENT quand même et l'on dit ce qui manque.
 * Auparavant un refus de permission ne produisait rien du tout, et le réglage
 * semblait ne pas se retenir.
 */

import { useEffect, useState } from 'react';
import { disablePush, enablePush, pushEnabled, pushSupported } from '../push.js';
import { readOptIn, requestNotificationPermission, writeOptIn } from '../notifications.js';
import { Switch } from '@/components/ui/switch.js';

export function AlertsToggle(): React.JSX.Element {
  const [on, setOn] = useState(readOptIn());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // L'abonnement push fait foi au chargement : il survit à un vidage du
  // stockage local, là où la préférence de bandeau, non.
  useEffect(() => {
    void pushEnabled().then((subscribed) => {
      if (subscribed) setOn(true);
    });
  }, []);

  const toggle = async (): Promise<void> => {
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

  return (
    <div className="mb-4">
      <div className="border-border flex items-center gap-3 rounded-xl border p-3">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Alertes de nouvelles annonces</span>
          <span className="text-muted-foreground block text-sm">
            {busy
              ? 'Un instant…'
              : on
                ? 'Bandeau dans la page, et notification même site fermé.'
                : 'Aucune alerte.'}
          </span>
        </span>
        <Switch
          checked={on}
          disabled={busy}
          aria-label="Alertes de nouvelles annonces"
          onCheckedChange={() => void toggle()}
        />
      </div>
      {error !== null && (
        <p className="border-destructive/40 bg-destructive/10 mt-2 rounded-lg border px-3 py-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
