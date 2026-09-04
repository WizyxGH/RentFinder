/**
 * « Ce site n'est branché sur aucune API ».
 *
 * POURQUOI CET ÉCRAN EXISTE. Sans adresse d'API, l'application se croyait
 * connectée : elle appelait `/api/listings` en chemin relatif, recevait la page
 * d'erreur du serveur de fichiers, et affichait une liste vide. Or une liste
 * vide dit « aucune annonce ne correspond à vos critères » — alors qu'il fallait
 * lire « rien n'est branché ». On a passé du temps à chercher pourquoi la
 * collecte ne ramenait plus rien, alors que la collecte allait très bien (§17).
 *
 * IL DIT QUOI FAIRE, pas seulement ce qui ne va pas. Un écran d'erreur qui
 * n'indique pas le geste suivant oblige à ouvrir la documentation, et c'est
 * exactement le moment où on ne sait pas quoi y chercher.
 */

import { Radio } from './icons.js';

export function UnconfiguredScreen(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-lg px-5 py-16">
      <Radio aria-hidden="true" className="text-muted-foreground mb-4 size-8" />
      <h1 className="text-2xl font-bold tracking-tight">Aucune base connectée</h1>
      <p className="text-muted-foreground mt-3">
        Ce site est bien publié, mais il ne sait pas où chercher vos annonces&nbsp;: l’adresse de
        l’API n’a pas été fournie au moment de sa construction. Vos données ne sont pas perdues —
        elles sont dans votre base, intactes.
      </p>

      <h2 className="mt-8 font-semibold">Pour le rebrancher</h2>
      <ol className="text-muted-foreground mt-2 flex list-decimal flex-col gap-2 pl-5 text-[0.95rem]">
        <li>
          Déployez le Worker&nbsp;: <code>cd packages/worker &amp;&amp; npx wrangler deploy</code>.
          Il affiche son adresse à la fin.
        </li>
        <li>
          Dans le dépôt GitHub,{' '}
          <strong>Settings → Secrets and variables → Actions → Variables</strong>, créez{' '}
          <code>API_URL</code> avec cette adresse.
        </li>
        <li>
          Relancez la publication du site — le prochain <em>push</em> suffit.
        </li>
      </ol>

      <p className="text-muted-foreground mt-6 text-[0.9rem]">
        Le détail de chaque étape se trouve dans <code>docs/deployment.md</code>, section
        «&nbsp;Mise en ligne&nbsp;».
      </p>
    </main>
  );
}
