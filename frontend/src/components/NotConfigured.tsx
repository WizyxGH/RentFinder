/**
 * Écran du site publié tant qu'aucune API n'est configurée.
 *
 * Remplace les données fictives : sur un site en ligne, des annonces inventées
 * n'apportent rien et laissent croire que l'outil ne trouve que ça. On explique
 * plutôt ce qui manque et comment y remédier.
 */

export function NotConfigured(): React.JSX.Element {
  return (
    <section className="mx-auto my-10 max-w-lg text-center">
      <h2 className="mb-2 text-xl font-semibold">Interface non connectée</h2>
      <p className="mb-6 text-muted-foreground">
        Le site est bien publié, mais il n’est relié à aucune base : il n’a donc aucune annonce à
        afficher. Vos données restent sur votre machine tant que le mode cloud n’est pas monté.
      </p>

      <ol className="mx-auto flex max-w-md flex-col gap-3 text-left text-sm">
        {[
          [
            'Créer la base',
            'turso db create rentfinder, puis pnpm publish:turso pour y envoyer votre inventaire.',
          ],
          [
            'Déployer l’API',
            'Dans packages/api : npx wrangler deploy, avec le jeton d’accès en secret.',
          ],
          [
            'Renseigner l’URL',
            'Variable de dépôt API_URL = l’adresse du Worker. Le prochain push connecte le site.',
          ],
        ].map(([title, detail], index) => (
          <li key={title} className="flex gap-3 rounded-xl border border-border p-3">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary"
            >
              {index + 1}
            </span>
            <span>
              <strong className="font-medium">{title}</strong>
              <span className="block text-muted-foreground">{detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-6 text-sm text-muted-foreground">
        En attendant, tout fonctionne en local : <code>pnpm collect</code> puis{' '}
        <code>pnpm local</code>.
      </p>
    </section>
  );
}
