/**
 * Écran de connexion (§26).
 *
 * Il n'apparaît QUE dans le mode publié, où un Worker garde le jeton de la
 * base et tient les sessions. En local il n'a pas lieu d'être : le serveur
 * n'écoute que sur 127.0.0.1, il n'y a personne d'autre devant la machine.
 *
 * PAS D'INSCRIPTION ICI, et ce n'est pas un oubli : un site ouvert à
 * l'inscription est un site que n'importe qui remplit. Les comptes se créent
 * en ligne de commande, depuis la machine qui a déjà accès à la base.
 *
 * LE MESSAGE D'ERREUR NE DISTINGUE PAS identifiant inconnu et mot de passe
 * faux. C'est délibéré : la différence n'apprendrait rien à qui possède un
 * compte, et dirait à un inconnu lesquels existent.
 */

import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { login } from '../api/client.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';

export function LoginScreen({
  onSignedIn,
}: {
  readonly onSignedIn: () => void;
}): React.JSX.Element {
  const [identifiant, setIdentifiant] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const failure = await login(identifiant, password);
    setBusy(false);
    if (failure === null) {
      onSignedIn();
      return;
    }
    setError(failure);
    // Le mot de passe est effacé, l'identifiant non : c'est presque toujours le
    // premier qu'on a raté, et retaper les deux agace pour rien.
    setPassword('');
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-[420px] flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Recherche Nice</h1>
      <p className="text-muted-foreground mb-5 text-sm">Connectez-vous pour voir vos annonces.</p>

      <Card>
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
              // 16 px sur mobile : en dessous, iOS zoome à la mise au point.
              className="w-full text-base"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[0.85rem] font-medium">Mot de passe</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              className="w-full text-base"
            />
          </label>

          {error !== null && (
            <p
              role="alert"
              className="border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm"
            >
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy || identifiant === '' || password === ''}>
            <LogIn aria-hidden="true" className="size-4" />
            {busy ? 'Connexion…' : 'Se connecter'}
          </Button>
        </form>
      </Card>

      <p className="text-muted-foreground mt-4 text-[0.82rem]">
        Les annonces sont communes à tous les comptes ; vos favoris, votre suivi et vos recherches
        enregistrées n’appartiennent qu’à vous.
      </p>
    </main>
  );
}
