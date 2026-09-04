/**
 * « Le service est momentanément indisponible ».
 *
 * POURQUOI CET ÉCRAN EXISTE. Sans adresse d'API, l'application se croyait
 * connectée : elle appelait `/api/listings` en chemin relatif, recevait la page
 * d'erreur du serveur de fichiers, et affichait une liste vide. Or une liste
 * vide dit « aucune annonce ne correspond à vos critères » — alors qu'il fallait
 * lire « rien n'est branché ». On a cherché du côté de la collecte, qui allait
 * très bien (§17).
 *
 * DEUX PUBLICS, DEUX MESSAGES. Un visiteur n'a que faire de `wrangler deploy` et
 * des variables d'un dépôt GitHub : ce sont nos affaires, pas les siennes, et
 * les afficher sur un site payant donne l'impression d'un chantier. Il lit donc
 * une phrase, et rien d'autre.
 *
 * La marche à suivre reste accessible à qui doit la lire : dépliée pendant le
 * développement, et écrite dans la console du navigateur dans tous les cas —
 * c'est le premier endroit qu'on ouvre quand un site ne montre rien.
 */

import { useEffect } from 'react';

/** Ce qu'il faut faire, pour la console et pour le mode développement. */
const FIX_STEPS = [
  'Déployer le Worker : cd packages/worker && npx wrangler deploy',
  'Créer la variable API_URL du dépôt (Settings → Secrets and variables → Actions → Variables) avec l’adresse affichée',
  'Republier le site (un push suffit)',
];

export function UnconfiguredScreen(): React.JSX.Element {
  // La console plutôt que la page : c'est là qu'on regarde quand un site ne
  // montre rien, et le visiteur n'y va jamais.
  useEffect(() => {
    console.error(
      ['[Maïoun] VITE_API_URL est vide : le site n’est relié à aucune API.', ...FIX_STEPS].join(
        '\n  • ',
      ),
    );
  }, []);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Service momentanément indisponible</h1>
      <p className="text-muted-foreground mt-3">
        Nous ne parvenons pas à joindre vos annonces pour l’instant. Rien n’est perdu&nbsp;:
        réessayez dans quelques instants.
      </p>
      <p className="mt-6">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-primary text-primary-foreground cursor-pointer rounded-full px-6 py-3 font-medium"
        >
          Réessayer
        </button>
      </p>

      {/* Vite remplace `import.meta.env.DEV` par `false` au build : ce bloc et
        son texte disparaissent entièrement du bundle publié. */}
      {import.meta.env.DEV && (
        <div className="border-border mt-10 rounded-xl border p-4 text-left">
          <p className="font-semibold">Développement — VITE_API_URL est vide</p>
          <ol className="text-muted-foreground mt-2 list-decimal pl-5 text-[0.9rem]">
            {FIX_STEPS.map((step) => (
              <li key={step} className="mt-1">
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </main>
  );
}
