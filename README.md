# RentFinder

Agrégateur **personnel** d'annonces de location à Nice. Ce n'est pas un énième
site immobilier : c'est un outil dont l'unique objectif est de **maximiser le
nombre de visites obtenues** — trouver vite les logements pertinents sur un
maximum de sources, éliminer les doublons et le bruit, évaluer chaque
opportunité, et permettre de contacter le bailleur en quelques secondes.

Ouvert sur un téléphone, il répond à une seule question :

> **Quelles sont les meilleures annonces que je dois contacter maintenant ?**

## Fonctionnalités

- **Collecte multi-sources** avec scheduler adaptatif : les sources productives
  sont interrogées plus souvent, les sources calmes espacées, les sources en
  erreur mises de côté — jamais de « tout le monde toutes les 10 minutes ».
- **Scraping poli par construction** : User-Agent identifiable, budgets de
  requêtes par source, cache ETag/304, arrêt anticipé en terrain connu, arrêt
  immédiat sur 429, arrêt définitif si une source refuse l'accès automatisé.
  Aucun contournement de protection, jamais.
- **Dédoublonnage** multi-signaux (téléphone, référence, GPS, prix, surface,
  textes) : une seule fiche par logement, **toutes** les occurrences et URLs
  d'origine conservées. Les cas ambigus ne sont pas fusionnés — un doublon
  visible vaut mieux qu'un logement disparu.
- **Fusion avec provenance** : téléphone de Leboncoin + référence du site
  d'agence + DPE de SeLoger sur la même fiche ; les valeurs divergentes sont
  affichées, jamais écrasées en silence.
- **Quatre scores expliqués** — Match, Opportunité, Probabilité de visite,
  Risque — chacun avec ses raisons ligne à ligne et ses angles morts déclarés
  (« calculé sans le nombre de favoris »). Une donnée absente n'est jamais
  inventée.
- **Détection d'arnaques** : prix anormal, incohérences, formulations
  classiques (« clés par courrier », « virement avant visite ») — signalées,
  jamais bloquantes.
- **Distances** vers des points de référence privés (travail, gare), libellés
  neutres, coordonnées jamais versionnées.
- **Contact en mode manuel** : coordonnées + message prêt à envoyer
  ([Modifier] [Copier] [Ouvrir] [J'ai envoyé]) — rien ne part sans votre geste.
  Un mode automatique optionnel existe sous garde-fous stricts, **désactivé par
  défaut**.
- **Suivi** : statuts (Nouveau → Contacté → … → Loué), journal des contacts,
  événements conservés pour les statistiques futures.
- **Coût : 0 €, et 100% local** — tout tourne sur votre machine (fichier SQLite
  - serveur local). Aucun compte, aucun quota, aucun secret cloud à gérer, et
    vos données ne quittent jamais l'appareil.

## Architecture en bref

```
pnpm collect : Scheduler → Scrapers → Normalisation → Dédoublonnage
             → Scoring + distances → SQLite local (data/local.db)
pnpm local   : SQLite → API (127.0.0.1) → Frontend React
```

Vos annonces, statuts et distances restent dans un fichier SQLite local, jamais
publié. Détails, diagramme et décisions : [docs/architecture.md](docs/architecture.md).

**Stack** : TypeScript partout — monorepo pnpm, React + Vite + Tailwind CSS
v4 + shadcn/ui (frontend), Node 22 (collecteur + serveur local), cheerio
(parsing), SQLite via `@libsql/client` (base), Vitest + Playwright (tests).

## Démarrage rapide

Prérequis : Node ≥ 20.10, pnpm 9 (`corepack enable`).

```bash
git clone <votre-fork> && cd rentfinder
pnpm install
pnpm collect      # collecte réelle → data/local.db (créée automatiquement)
pnpm local        # → http://127.0.0.1:8788 : l'interface sur VOS données
```

Relancez `pnpm collect` quand vous voulez rafraîchir (le scheduler et les
budgets s'appliquent). `data/` est ignoré par git.

### Mode démo (sans réseau, sans base)

```bash
pnpm dev          # → http://localhost:5173, interface sur données fictives
```

C'est aussi l'environnement des tests. Installation détaillée et configuration
privée (`.env`) : [docs/deployment.md](docs/deployment.md).

## Commandes

| Commande                      | Effet                                                                       |
| ----------------------------- | --------------------------------------------------------------------------- |
| `pnpm dev`                    | frontend en mode démo                                                       |
| `pnpm local`                  | mode local complet : interface + API sur `data/local.db`                    |
| `pnpm collect`                | un cycle de collecte (`-- --backfill`, `-- --verbose`)                      |
| `pnpm db:migrate`             | applique les migrations                                                     |
| `pnpm test` / `pnpm test:e2e` | tests Node / scénarios Playwright                                           |
| `pnpm verify`                 | **tout** : format, lint, types, tests, secrets — à lancer avant tout commit |
| `pnpm check:secrets`          | scanner de secrets seul                                                     |

## Documentation

| Document                                    | Contenu                                                              |
| ------------------------------------------- | -------------------------------------------------------------------- |
| [architecture.md](docs/architecture.md)     | composants, flux, décisions, limites                                 |
| [sources.md](docs/sources.md)               | étude datée des sources (robots.txt, verdicts, priorités)            |
| [scraping.md](docs/scraping.md)             | règles de collecte, garanties du core, diagnostic d'un scraper cassé |
| [scheduler.md](docs/scheduler.md)           | fréquences adaptatives                                               |
| [deduplication.md](docs/deduplication.md)   | signaux, vetos, fusion, provenance                                   |
| [scoring.md](docs/scoring.md)               | les 4 scores et la priorité d'action                                 |
| [risk-detection.md](docs/risk-detection.md) | signaux d'arnaque                                                    |
| [contact.md](docs/contact.md)               | mode manuel, garde-fous du mode auto, relances                       |
| [database.md](docs/database.md)             | schéma, migrations, économie d'écritures                             |
| [privacy.md](docs/privacy.md)               | cartographie des données, les six barrières anti-fuite               |
| [deployment.md](docs/deployment.md)         | mise en production pas à pas                                         |
| [contributing.md](docs/contributing.md)     | **ajouter une source**, conventions                                  |

## Principes non négociables

1. **Respect des sources** — pas de contournement de CAPTCHA, d'anti-bot, de
   rate limit ni de `robots.txt` ; une source hostile est abandonnée, pas
   forcée. Identité du bot toujours annoncée.
2. **Pas de données inventées** — un champ que la source ne publie pas est
   « inconnu », dans le modèle comme à l'écran.
3. **Rien de personnel dans le dépôt** — il est public ; six barrières
   automatiques l'assurent ([privacy.md](docs/privacy.md)).
4. **Aucun message sans action humaine** en mode manuel — le mode par défaut.
5. **Économie** — minimum de requêtes, d'écritures et de minutes CI pour le
   maximum d'information utile.

## Limites connues

- Le mode automatique de contact n'a **pas d'envoi implémenté** (garde-fous
  seulement) : il n'arrivera qu'après une collecte éprouvée, comme prévu.
- Six sources actives (Laforêt, Orpi, BEP Logement, Foncia, Century 21,
  NousGérons) ; PAP est implémentée mais désactivée (son WAF refuse les
  clients non-navigateurs, qu'on ne contourne pas) — l'[étude des
  sources](docs/sources.md) détaille chaque verdict.
- Distances à vol d'oiseau corrigées (× 1,3), pas des itinéraires.
- Leboncoin, SeLoger et Bien'ici restent **écartés** : pas de méthode d'accès
  conforme (les scrapers open-source existants contournent DataDome, ce que le
  projet s'interdit — §10).
- Les crons GitHub Actions peuvent avoir quelques minutes de retard.

## Roadmap

- **MVP (actuel)** : pipeline complet, 6 sources actives (Laforêt, Orpi — GPS
  —, BEP Logement — agence locale, sitemap —, Foncia — adresses —, Century 21,
  NousGérons — colocations) + PAP prête mais désactivée, colocation détectée,
  mode local zéro-cloud, 4 scores en anneaux, dédoublonnage, contact manuel +
  relance, frontend mobile (Tailwind CSS + shadcn/ui), CI, docs, 349 tests
  dont 18 scénarios E2E.
- **V2** : adaptateurs génériques d'agences locales (le parser BEP/Apimo est
  le premier candidat), davantage d'agences niçoises, relances automatisées,
  statistiques (taux de réponse par source/heure/délai), historique des
  changements de prix.
- **V3** : scores calibrés sur les résultats réels, scheduler optimisé
  dynamiquement, automatisation avancée.

## Troubleshooting

| Symptôme                                                                       | Cause probable et remède                                                                                                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm collect` n'exécute aucune source                                         | Le scheduler estime qu'aucune n'est due (intervalles §7). Vérifier la page Sources ; pour forcer, supprimer `data/local.db` (repart de zéro) ou attendre l'intervalle. |
| Une source est `blocked`                                                       | Elle a répondu 401/403 : le scraper s'arrête définitivement et ne tentera aucun contournement (§10). Voir son verdict dans [docs/sources.md](docs/sources.md).         |
| Une source est `cooldown`                                                      | HTTP 429 reçu : repos automatique (durée dans la page Sources), les autres sources continuent.                                                                         |
| `Le port 8788 est déjà utilisé` au `pnpm local`                                | Un serveur tourne déjà — ouvrir http://127.0.0.1:8788, ou `PORT=8789 pnpm local`.                                                                                      |
| L'interface locale affiche « Interface non construite »                        | Lancer `pnpm local` (qui construit), pas `pnpm --filter @rentfinder/collector serve` seul.                                                                             |
| 0 annonce alors que la collecte a réussi                                       | Les annonces sont hors critères (≤ 700 €, ≥ 14 m², Nice). Cocher « Afficher les annonces hors critères ».                                                              |
| Un parser ne trouve plus de prix (warning « structure probablement modifiée ») | Le site a changé son HTML : suivre la procédure de réparation de [docs/scraping.md](docs/scraping.md#diagnostiquer-un-scraper-cassé-69).                               |
| `TURSO_DATABASE_URL manquant` en CI                                            | Normal : en CI le fallback local est désactivé — configurer le secret.                                                                                                 |

## Licence

[MIT](LICENSE). Le code est libre ; son **usage** doit rester conforme aux CGU
des sites consultés et au droit applicable (RGPD compris). Ce projet est conçu
pour un usage personnel de recherche de logement, à faible volume.
