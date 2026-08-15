# Base de données

## SQLite local, et pourquoi ça reste léger

La base est un **fichier SQLite local** (`data/local.db`), lu et écrit via
`@libsql/client` en mode fichier (§27). Aucun service cloud. Le projet reste
économe **par construction** — utile pour garder une base compacte et des runs
rapides :

| Mécanisme                                            | Effet                                                                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content_hash` par ligne (`occurrences`, `listings`) | une annonce revue à l'identique ne coûte **aucune** écriture ; seul `last_seen_at` est rafraîchi, en une requête groupée pour tout le lot                              |
| `db.batch()`                                         | les upserts partent groupés, pas ligne à ligne                                                                                                                         |
| table `http_cache` (ETag / Last-Modified)            | une page inchangée répond 304 : zéro téléchargement, zéro parsing, zéro écriture                                                                                       |
| pas d'images, pas de HTML brut, pas de documents     | uniquement des URLs et des données structurées (§11, §27)                                                                                                              |
| payloads JSON compacts                               | les champs rarement filtrés (description, URLs d'images, provenance des scores) vivent dans une colonne `payload` au lieu de multiplier les colonnes et les migrations |

## Schéma (migration `0001_initial.sql`)

| Table               | Rôle                                                                                                                                                                                     | Clés de lecture                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `occurrences`       | une ligne par annonce **et par source** — jamais supprimée, même regroupée (§13)                                                                                                         | `(source_id, source_ref)` unique ; index dédup `(city, area, price)` ; index téléphone |
| `listings`          | une ligne par **logement** (fiche utilisateur), scores et `action_priority` en colonnes pour le tri SQL                                                                                  | index `(matches_criteria, action_priority DESC)`                                       |
| `contact_attempts`  | journal de chaque contact : garde-fou (un contact par annonce) **et** base statistique (§23, §33)                                                                                        | par `listing_id`, par date                                                             |
| `source_state`      | partie mouvante du registre : santé, cooldown, moyenne de production (§5, §63)                                                                                                           | clé `source_id`                                                                        |
| `collection_runs`   | une ligne par source et par run : requêtes, trouvées, nouvelles, stopReason, warnings (§62)                                                                                              | par source, par date                                                                   |
| `http_cache`        | validateurs conditionnels par URL (§30)                                                                                                                                                  | clé `url`                                                                              |
| `events`            | événements bruts pour les statistiques long terme — on enregistre les faits maintenant pour calculer plus tard des taux qu'on ne connaît pas encore (§33)                                | par type, par date                                                                     |
| `listing_history`   | instantané daté écrit à la 1re observation (`baseline`) puis **uniquement** quand loyer/surface/disponibilité changent (§31) — trajectoire d'une annonce, base des baisses de prix (§17) | par `occurrence_id`, par date                                                          |
| `schema_migrations` | suivi des migrations appliquées (§68)                                                                                                                                                    | —                                                                                      |

Conventions : dates ISO 8601 UTC en TEXT ; booléens en INTEGER 0/1 avec NULL =
« non précisé par la source » (§17).

## Cycle de vie des annonces (§32)

Une annonce non revue n'est **jamais** supprimée :

```
active --(2 runs sans la revoir)--> possiblyInactive --(6 runs)--> inactive
```

`missing_runs` est remis à zéro dès qu'elle réapparaît. Seuils dans
`PUBLIC_CONFIG`. Ceci permettra de mesurer la durée de publication réelle et la
relation fraîcheur → taux de visite (V2).

## Migrations (§68)

- Fichiers SQL numérotés : `database/migrations/NNNN_description.sql`.
- Appliquées dans l'ordre, une fois, tracées dans `schema_migrations`.
- `pnpm db:migrate` — exécuté aussi en tête de chaque run de collecte, donc un
  déploiement ne peut pas oublier une migration.
- **Jamais** de modification manuelle du schéma de production. Toute évolution
  = un nouveau fichier (on n'édite pas une migration déjà appliquée).

## Environnements

| Contexte            | Base                                                       | Garantie                                                |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| usage / collecte    | fichier SQLite `data/local.db` (créé automatiquement)      | ignoré par git — rien ne quitte la machine (§26)        |
| autre fichier local | `DATABASE_URL=file:./…`                                    | optionnel                                               |
| tests               | `:memory:` — `TEST_DATABASE_URL`/`VITEST` ont **priorité** | un test ne peut pas toucher votre base de travail (§52) |

Même API libsql dans les trois cas : les tests d'intégration exercent le vrai
code de persistance.

## Mise en route

Aucune. Le fichier `data/local.db` est créé au premier `pnpm collect`, et les
migrations s'appliquent automatiquement. Rien à configurer.
