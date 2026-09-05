/**
 * Choisir un nouveau mot de passe, depuis le lien reçu par e-mail (§26).
 *
 * L'ÉCRAN NE DIT PAS POURQUOI UN JETON EST REFUSÉ — inconnu, expiré ou déjà
 * servi donnent le même message. La distinction n'aiderait pas le demandeur
 * légitime, qui n'a de toute façon qu'une chose à faire — redemander un lien —,
 * et elle apprendrait à qui essaie au hasard qu'un jeton a existé.
 *
 * LE MOT DE PASSE EST SAISI DEUX FOIS. On ne peut pas le relire ensuite : une
 * faute de frappe enfermerait dehors celui qui vient tout juste de rentrer.
 */

import { useState } from 'react';
import { Check } from './icons.js';
import { resetPassword } from '../api/client.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';

/** Le plancher exigé par le serveur. Le redire ici évite un aller-retour. */
const MIN_PASSWORD = 8;

export function ResetPassword({
  token,
  onDone,
}: {
  readonly token: string;
  readonly onDone: () => void;
}): React.JSX.Element {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'invalid' | 'error'>('idle');

  const mismatch = confirmation !== '' && confirmation !== password;
  const tooShort = password !== '' && password.length < MIN_PASSWORD;

  const submit = async (): Promise<void> => {
    setState('busy');
    setState(await resetPassword(token, password));
  };

  if (state === 'done') {
    return (
      <main className="mx-auto flex min-h-screen max-w-[420px] flex-col justify-center px-4">
        <Card>
          <p className="mb-3 flex items-start gap-2 text-sm">
            <Check aria-hidden="true" className="text-good mt-0.5 size-5 shrink-0" />
            <span>Votre mot de passe est changé. Vous pouvez vous connecter.</span>
          </p>
          <Button onClick={onDone}>Se connecter</Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[420px] flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Nouveau mot de passe</h1>
      <p className="text-muted-foreground mb-5 text-sm">
        {MIN_PASSWORD} caractères au minimum. Ni majuscule ni chiffre imposés : ces règles
        produisent surtout des mots de passe notés sur un papier.
      </p>

      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-[0.85rem] font-medium">Mot de passe</span>
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              className="w-full text-base"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[0.85rem] font-medium">Confirmation</span>
            <input
              type="password"
              value={confirmation}
              autoComplete="new-password"
              onChange={(event) => setConfirmation(event.target.value)}
              className="w-full text-base"
            />
          </label>

          {tooShort && (
            <p className="text-muted-foreground text-[0.82rem]">
              Encore {MIN_PASSWORD - password.length} caractère
              {MIN_PASSWORD - password.length > 1 ? 's' : ''}.
            </p>
          )}
          {mismatch && <p className="text-bad text-[0.82rem]">Les deux saisies diffèrent.</p>}

          {state === 'invalid' && (
            <p role="alert" className="border-border rounded-lg border px-3 py-2 text-sm">
              Ce lien n’est plus valable : il a expiré, il a déjà servi, ou il a été tronqué en
              chemin. Redemandez-en un depuis l’écran de connexion.
            </p>
          )}
          {state === 'error' && (
            <p role="alert" className="text-bad text-sm">
              L’enregistrement a échoué. Réessayez dans un instant.
            </p>
          )}

          <Button
            type="submit"
            disabled={
              state === 'busy' || password.length < MIN_PASSWORD || confirmation !== password
            }
          >
            {state === 'busy' ? 'Enregistrement…' : 'Choisir ce mot de passe'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
