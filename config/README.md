# Configuration des filtres

`search.json` règle **vos critères de recherche** : ce qui est collecté, ce qui
apparaît dans la liste principale, et ce qui déclenche une notification.
Éditez-le et relancez `pnpm collect`, ou réglez-le depuis l'onglet **Alertes**
de l'interface — les deux écrivent dans le même fichier.

> Ne pas confondre avec la modale **« Trier et filtrer »** de la liste : celle-ci
> n'affine que l'AFFICHAGE des annonces déjà collectées, sans rien changer à la
> collecte ni aux notifications.

Ce fichier est **public** (versionné dans le dépôt) : il ne contient que des
critères génériques, jamais de donnée personnelle. Vos points de référence
privés (travail, gare) vont dans `.env` — voir [`.env.example`](../.env.example)
et [docs/privacy.md](../docs/privacy.md).

Robustesse : toute clé inconnue est ignorée sans risque, et un JSON invalide
n'interrompt pas la collecte (les valeurs par défaut s'appliquent, avec un
avertissement). Le bouton **Réinitialiser** de l'onglet Alertes restaure les
valeurs par défaut.

## Le principe à retenir

**Une donnée ABSENTE n'exclut jamais une annonce.** Un bien sans prix publié
passe le filtre de prix ; un bien dont la source ne dit pas s'il est meublé
passe le filtre meublé. On préfère montrer une annonce imparfaitement décrite
que d'en perdre une bonne par manque d'information.

## Où l'on cherche

| Champ               | Type            | Défaut     | Effet                                                                                                                     |
| ------------------- | --------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `cities`            | liste de textes | `["nice"]` | Communes recherchées, **en minuscules sans accent** (`"saint-laurent-du-var"`). Hors de cette liste → hors critères.      |
| `maxCommuteMinutes` | nombre (min)    | `60`       | Trajet maximum vers le point « Travail » défini dans `.env`. Sans point de référence configuré, ce réglage est inopérant. |

## Combien, et quelle taille

| Champ      | Type        | Défaut | Effet                                                                                                 |
| ---------- | ----------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `minPrice` | nombre (€)  | `250`  | Loyer plancher. Sert surtout à écarter parkings, box et caves mal étiquetés « appartement » (~100 €). |
| `maxPrice` | nombre (€)  | `700`  | Loyer plafond, charges comprises.                                                                     |
| `minArea`  | nombre (m²) | `20`   | Surface minimum, comparaison inclusive (`surface ≥ minArea`).                                         |

## Quel type de bien

| Champ              | Type    | Défaut  | Effet                                                                                                                              |
| ------------------ | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `excludeFlatShare` | booléen | `true`  | Écarte les colocations de la liste principale. Elles restent collectées et consultables en « hors critères ».                      |
| `excludeStudent`   | booléen | `true`  | Écarte les logements étudiants (résidences, annonces « étudiant/erasmus »), par mots-clés du titre, de la description et de l'URL. |
| `furnishedFilter`  | texte   | `"all"` | `"all"`, `"furnished"` (meublés seulement) ou `"unfurnished"` (non meublés seulement).                                             |
| `propertyTypes`    | liste   | absent  | Restreint aux types cités : `apartment`, `house`, `studio`, `loft`, `duplex`, `other`. Omettre la clé = tous les types.            |

## Qui loue

| Champ            | Type  | Défaut  | Effet                                                                                                                                                  |
| ---------------- | ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `landlordFilter` | texte | `"all"` | `"private"` masque les agences connues mais garde les particuliers **et les bailleurs inconnus** (dont les alertes e-mail). `"agency"` fait l'inverse. |

## Réglages techniques

| Champ                  | Type          | Défaut | Effet                                                                                                             |
| ---------------------- | ------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `referencePricePerSqm` | nombre (€/m²) | `20`   | Loyer de référence au m². Sert au score de RISQUE (une annonce très en dessous est signalée). **Ne filtre rien.** |
| `maxSourcesPerRun`     | nombre        | `6`    | Sources visitées par passage. Les 40 sources sont parcourues à tour de rôle, les moins récemment vues d'abord.    |

## Clés à ne pas utiliser

`minRooms`, `maxRooms`, `districts` et `energyClasses` existent dans le type
`SearchCriteria` mais **ne sont appliquées nulle part** dans le scoring : les
renseigner n'aurait aucun effet. Elles sont conservées pour un usage futur.
