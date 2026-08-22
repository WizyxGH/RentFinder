# Configuration des filtres

`search.json` règle **vos filtres de recherche**. Éditez-le, enregistrez, puis
relancez `pnpm collect` : les annonces sont re-scorées au prochain run.

Ce fichier est **public** (versionné) : il ne contient que des critères
génériques, jamais de donnée personnelle. Vos coordonnées privées (lieu de
travail, gare) vont dans `.env` — voir [`.env.example`](../.env.example) et
[docs/privacy.md](../docs/privacy.md).

Toute clé inconnue est ignorée sans risque ; un JSON invalide n'interrompt pas
la collecte (les filtres par défaut s'appliquent, avec un avertissement).

## Champs

| Champ                  | Type            | Défaut     | Effet                                                                                                                                          |
| ---------------------- | --------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `cities`               | liste de textes | `["nice"]` | Villes recherchées, en minuscules sans accent. Une annonce hors de ces villes sort de la liste principale.                                     |
| `maxPrice`             | nombre (€)      | `700`      | Loyer mensuel maximum. Au-delà → hors critères.                                                                                                |
| `minPrice`             | nombre (€)      | `250`      | Loyer minimum. Écarte surtout les parkings/box/caves mal étiquetés « appartement » (~100 €). Un bien sans prix publié n'est jamais exclu.      |
| `minArea`              | nombre (m²)     | `16`       | Surface minimum. En deçà → hors critères.                                                                                                      |
| `excludeFlatShare`     | booléen         | `true`     | `true` : les colocations sont exclues de la liste principale (elles restent collectées, visibles via « Afficher les annonces hors critères »). |
| `excludeStudent`       | booléen         | `true`     | `true` : exclut les locations étudiantes (résidences étudiantes, Erasmus/CROUS). Un studio simplement « idéal étudiant » n'est PAS exclu.      |
| `referencePricePerSqm` | nombre (€/m²)   | `20`       | Loyer de référence au m² pour la détection de risque (§19). Hypothèse de travail, pas un prix de marché officiel.                              |

## Champs optionnels supplémentaires

Décommentables en les ajoutant au JSON (voir le type `SearchCriteria` dans
`packages/shared/src/criteria.ts`) :

| Champ           | Type    | Exemple                   | Effet                                                  |
| --------------- | ------- | ------------------------- | ------------------------------------------------------ |
| `furnished`     | booléen | `true`                    | N'accepte que meublé (`true`) ou non meublé (`false`). |
| `propertyTypes` | liste   | `["apartment", "studio"]` | Restreint aux types de biens indiqués.                 |
| `minRooms`      | nombre  | `2`                       | Nombre de pièces minimum.                              |
| `energyClasses` | liste   | `["A", "B", "C", "D"]`    | Classes DPE acceptées.                                 |

Une annonce dont la source ne publie pas l'information n'est **jamais** exclue
sur ce seul motif (§17 : on n'élimine pas sur une donnée absente).

## Rappel : ce qui ne va PAS ici

Les données personnelles restent hors du dépôt (§26) et se configurent dans
`.env` : profil locataire (`TENANT_*`), points de référence (`REFERENCE_*`),
identifiants privés (`BEP_SUBSCRIBER_*`).
