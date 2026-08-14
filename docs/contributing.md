# Guide du contributeur — détails techniques

Complément technique du [CONTRIBUTING.md](../CONTRIBUTING.md) racine. Le sujet
central : ajouter une source proprement.

## Ajouter une source

### 0. Étude préalable — obligatoire

Remplir la fiche de [sources.md](sources.md) : vérifier `robots.txt` **à la
date du jour**, identifier une méthode d'accès conforme (API > flux > sitemap >
HTML — §6), estimer volume et fraîcheur. Si la source interdit l'accès
automatisé : s'arrêter là et documenter le verdict (§10). Ne pas coder d'abord.

### 1. La fixture d'abord (§50)

```bash
# UNE requête, avec l'UA du projet
curl -A "RentFinderBot/0.1" "https://exemple.fr/location-nice" -o /tmp/page.html
```

Réduire à 3-6 annonces représentatives, **anonymiser tout contenu personnel**
(conventions dans `tests/fixtures/README.md`), enregistrer sous
`tests/fixtures/<id>/`. Créer aussi la fixture _dégradée_ : prix absent,
surface absente, format inhabituel, balisage modifié.

### 2. Le parser — fonction pure

`packages/collector/src/sources/<id>/parser.ts` :

- signature type : `parseSearchPage(html, pageUrl) → { listings: RawListing[], hasNextPage, warnings }` ;
- rend des **chaînes brutes** (`priceText: "1 890 €/mois"`), pas de parsing
  métier — c'est le rôle de la normalisation ;
- champ introuvable → omis, jamais deviné (§17) ;
- s'ancrer sur l'URL et les unités du texte, pas sur les classes CSS ;
- émettre un warning si les annonces perdent massivement leur prix (§61).

### 3. Les tests du parser

`parser.test.ts` à côté : fixture nominale (tous champs, dédoublonnage des
liens multiples, pagination), fixture dégradée (chaque cas limite du §50), et
enchaînement `parser → normalizeAll` pour vérifier les valeurs typées finales.

### 4. Le scraper

`sources/<id>/index.ts` : descripteur + boucle de collecte.

```ts
export const MASOURCE_DESCRIPTOR: SourceDescriptor = {
  id: 'masource',
  kind: 'localAgency', // détermine budget et fréquence par défaut
  method: 'html',
  priority: 3,
  schedule: scheduleFor('localAgency'),
  budget: budgetFor('localAgency', { maxPagesPerRun: 2 }),
  enabled: true,
  manualOnly: true, // défaut prudent (§23)
  allowedPaths: ['/location/*'], // chemins robots.txt vérifiés
  notes: 'robots.txt vérifié le AAAA-MM-JJ : …',
};
```

Dans `run()` : n'utiliser que `context.fetch` ; respecter `context.shouldStop()` ;
appliquer l'arrêt anticipé sur ratio de déjà-vu ≥ 0,8 (§9) ; capturer les
erreurs de page dans `warnings` au lieu de lever (§69).

### 5. Déclarer, vérifier, exécuter

1. Ajouter le scraper au tableau `ALL_SCRAPERS` (`sources/index.ts`) — c'est le
   seul point d'enregistrement (§5).
2. Ajouter le cas de dédoublonnage croisé (voir
   [deduplication.md](deduplication.md#vérifier-le-dédoublonnage-dune-nouvelle-source)).
3. `pnpm verify` — la suite complète doit passer.
4. Premier run réel en local (`pnpm collect -- --verbose`) sur base SQLite,
   inspection des annonces produites.
5. Documenter la source dans [sources.md](sources.md) (verdict ✅) et le
   CHANGELOG.

### Désactiver / réactiver une source

`enabled: false` dans le descripteur — le code et les tests restent (§5, §76).
Le scheduler l'ignore ; rien d'autre à toucher.

## Adaptateurs génériques d'agences

Quand plusieurs agences partagent la même plateforme technique (§5, §47) :
écrire l'adaptateur une fois (`sources/agencies/<plateforme>.ts`) comme une
**fabrique** `makeScraper(config) → Scraper`, et instancier une entrée par
agence avec domaine + budget `localAgency`. Chaque instance a son propre
`SourceDescriptor` et apparaît indépendamment dans le registre et la page
Sources.

## Modifier un scraper existant (§60)

Ordre strict : (1) lancer la suite, (2) vérifier les fixtures contre le site
réel, (3) modifier, (4) tests spécifiques, (5) suite complète de
non-régression, (6) build. Un bug corrigé = un test qui le reproduit, conservé
définitivement (§51).

## Conventions de code

- Commits : `feat(scraper): …`, `fix(deduplication): …` (§67).
- Petites fonctions, contrats explicites, configuration déclarative (§75).
- Toute date/heure passe par `Clock` ; tout log passe par `Logger` (expurgation).
- `null` = « la source ne le dit pas ». Ne jamais le convertir en 0 ou en
  chaîne vide.
