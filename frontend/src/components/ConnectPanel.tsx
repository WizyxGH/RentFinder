/**
 * Connexion du site à la base Turso (§28).
 *
 * Deux valeurs saisies une fois, conservées dans le navigateur : elles
 * n'entrent jamais dans le bundle publié, qui est public. Le site n'affiche
 * rien tant qu'elles ne sont pas fournies — c'est la protection d'accès.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button.js';
import { normalizeUrl, testCredentials, urlProblem, writeCredentials } from '../api/turso.js';

const FIELD = 'w-full rounded-lg border border-border bg-card px-3 py-2';

export function ConnectPanel(): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    // Diagnostic AVANT l'appel : une adresse de tableau de bord renvoie un
    // « 405 Not Allowed » d'un serveur sans rapport, illisible pour qui le lit.
    const problem = urlProblem(normalizeUrl(url));
    if (problem !== null) {
      setError(problem);
      setBusy(false);
      return;
    }
    try {
      // On VÉRIFIE avant d'enregistrer : sinon l'interface se rechargerait sur
      // des identifiants faux, avec une erreur bien plus loin et moins claire.
      await testCredentials({ url, token });
      writeCredentials({ url, token });
      window.location.reload();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        /not authorized|401|403/i.test(message)
          ? 'Jeton refusé par Turso. Vérifiez qu’il correspond bien à cette base.'
          : /no such table/i.test(message)
            ? 'Base joignable, mais vide : lancez `pnpm publish:turso` depuis votre machine.'
            : `Connexion impossible : ${message}`,
      );
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto my-10 max-w-md">
      <h2 className="mb-2 text-xl font-semibold">Connexion</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Renseignez l’accès à votre base. Ces valeurs restent dans ce navigateur — elles ne sont ni
        publiées ni transmises ailleurs.
      </p>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Adresse de la base</span>
          <input
            className={FIELD}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="libsql://…turso.io"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Jeton d’accès</span>
          <input
            className={FIELD}
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            required
          />
        </label>

        {error !== null && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy}>
          {busy ? 'Vérification…' : 'Se connecter'}
        </Button>
      </form>

      <p className="mt-5 text-sm text-muted-foreground">
        Les deux valeurs sont sur la page de votre base Turso, bouton <strong>Connect</strong>. Ce
        sont les mêmes que dans votre fichier <code>.env</code>.
      </p>
    </section>
  );
}
