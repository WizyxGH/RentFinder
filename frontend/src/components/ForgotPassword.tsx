/**
 * « Mot de passe oublié » — la demande de lien (§26).
 *
 * UNE SEULE RÉPONSE, QUOI QU'IL ARRIVE. Que l'identifiant existe ou non, que le
 * compte porte une adresse ou non, l'écran dit la même chose : « si un compte
 * correspond, un message est parti ». Répondre « compte inconnu » ferait de ce
 * formulaire un annuaire — on l'interroge en boucle et l'on ressort la liste
 * des comptes, identifiants qui servent ensuite ailleurs.
 *
 * C'est délibérément moins agréable : quelqu'un qui se trompe d'identifiant
 * attendra un message qui ne viendra pas. Le texte le dit, pour qu'il pense à
 * vérifier plutôt qu'à recommencer.
 *
 * SAUF SI RIEN N'EST CONFIGURÉ. Là, aucun message ne partira jamais, pour
 * personne : le taire laisserait rafraîchir une boîte en vain (§17).
 */

import { useState } from 'react';
import { ArrowLeft, Mail } from './icons.js';
import { requestPasswordReset } from '../api/client.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';

export function ForgotPassword({ onBack }: { readonly onBack: () => void }): React.JSX.Element {
  const [identifiant, setIdentifiant] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'unconfigured' | 'error'>('idle');

  const submit = async (): Promise<void> => {
    setState('busy');
    setState(await requestPasswordReset(identifiant));
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-[420px] flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Mot de passe oublié</h1>
      <p className="text-muted-foreground mb-5 text-sm">
        Saisissez votre identifiant : un lien de réinitialisation partira vers l’adresse de votre
        compte.
      </p>

      <Card>
        {state === 'sent' ? (
          <div className="flex flex-col gap-3">
            <p className="flex items-start gap-2 text-sm">
              <Mail aria-hidden="true" className="text-primary mt-0.5 size-5 shrink-0" />
              <span>
                Si un compte correspond à cet identifiant et porte une adresse e-mail, un message
                vient de partir. Le lien expire dans une heure et ne fonctionne qu’une fois.
              </span>
            </p>
            <p className="text-muted-foreground text-[0.82rem]">
              Rien reçu au bout de quelques minutes ? Vérifiez vos indésirables, puis l’identifiant
              saisi — nous ne disons pas s’il existe, pour ne pas révéler la liste des comptes.
            </p>
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft aria-hidden="true" className="size-4" /> Revenir à la connexion
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-[0.85rem] font-medium">Identifiant</span>
              <input
                type="text"
                value={identifiant}
                autoComplete="username"
                autoFocus
                onChange={(event) => setIdentifiant(event.target.value)}
                className="w-full text-base"
              />
            </label>

            {state === 'unconfigured' && (
              <p role="alert" className="border-border rounded-lg border px-3 py-2 text-sm">
                L’envoi d’e-mails n’est pas configuré sur cette installation : aucun lien ne peut
                partir. Demandez à l’administrateur de réinitialiser votre mot de passe.
              </p>
            )}
            {state === 'error' && (
              <p role="alert" className="text-bad text-sm">
                La demande n’a pas abouti. Réessayez dans un instant.
              </p>
            )}

            <Button type="submit" disabled={state === 'busy' || identifiant.trim() === ''}>
              {state === 'busy' ? 'Envoi…' : 'Recevoir un lien'}
            </Button>
            <Button type="button" variant="ghost" onClick={onBack}>
              <ArrowLeft aria-hidden="true" className="size-4" /> Retour
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
