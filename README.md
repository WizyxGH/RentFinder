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
- **Fusion avec provenance** : téléphone du site d'agence + adresse exacte de
  Foncia + DPE de Saint Roch sur la même fiche ; les valeurs divergentes sont
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
- **Suivi** : statuts (Nouveau → Contacté → … → Loué), journal des contacts
  (avec les pièces déclarées jointes), consulté/archivé/favori persistants,
  classement affiné par vos préférences (affinité transparente), page Stats.
- **Notifications** : Telegram après chaque collecte (téléphone, app fermée) et
  notifications navigateur site ouvert — chaque annonce signalée une seule fois.
- **Documents de candidature** : pièces déposées une fois (onglet Profil),
  stockées uniquement en local (`data/`, hors dépôt), jamais envoyées
  automatiquement.
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

### Notifications Telegram + collecte automatique (§29)

Pour être prévenu **sur votre téléphone** dès qu'une annonce entre dans vos
critères, sans lancer la collecte à la main :

1. **Créer le bot** (90 s, la seule étape manuelle — un bot appartient à votre
   compte Telegram) : écrire à `@BotFather` → `/newbot` → copier le jeton, puis :

   ```bash
   node scripts/setup-telegram.mjs <JETON>
   ```

   Le script vérifie le jeton, trouve votre `chat_id` tout seul (écrivez
   n'importe quoi à votre bot quand il vous le demande), remplit `.env` (privé,
   jamais committé) et envoie un message de test. Options dans `.env.example`.

2. **Planifier la collecte** (Windows) :

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\schedule-collect.ps1
   # toutes les 30 min par défaut ; -IntervalMinutes 15 pour changer,
   # -Remove pour désinstaller.
   ```

   Chaque collecte pousse alors les nouveautés sur Telegram. La tâche tourne en
   local, tant que l'ordinateur est allumé (limite assumée du choix zéro-cloud).
   Sur macOS/Linux, un `cron` équivalent : `*/30 * * * * cd <dépôt> && pnpm collect`.

Sans ces variables, le notifieur reste silencieusement désactivé.

## Commandes

| Commande                      | Effet                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`                    | frontend en mode démo                                                           |
| `pnpm local`                  | mode local complet : (re)construit l'interface puis sert sur `data/local.db`    |
| `pnpm serve`                  | démarrage **instantané** (sans reconstruire — si l'interface n'a pas changé)    |
| `pnpm collect`                | un cycle de collecte (`-- --backfill`, `-- --verbose`) + notif Telegram         |
| `schedule-collect.ps1`        | planifie `pnpm collect` (Windows) pour des notifs automatiques (voir ci-dessus) |
| `pnpm db:migrate`             | applique les migrations                                                         |
| `pnpm test` / `pnpm test:e2e` | tests Node / scénarios Playwright                                               |
| `pnpm verify`                 | **tout** : format, lint, types, tests, secrets — à lancer avant tout commit     |
| `pnpm check:secrets`          | scanner de secrets seul                                                         |

## Documentation

| Document                                | Contenu                                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](docs/architecture.md) | composants et flux, puis par sections : scoring, détection de risque, dédoublonnage, scheduler, scraping, base de données, contact |
| [sources.md](docs/sources.md)           | étude datée des sources (robots.txt, verdicts, priorités)                                                                          |
| [deployment.md](docs/deployment.md)     | installation locale, `.env`, notifications Telegram, et option cloud gratuite (Turso + Worker + Actions + Pages)                   |
| [privacy.md](docs/privacy.md)           | cartographie des données, les six barrières anti-fuite                                                                             |

Pour **contribuer / ajouter une source**, voir [CONTRIBUTING.md](CONTRIBUTING.md).

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
- 20 sources actives (portails, réseaux et agences niçoises — dont les
  adaptateurs génériques Apimo et La Boîte Immo/Hektor, et Studapart par API) ;
  PAP est implémentée mais désactivée (son WAF refuse les clients
  non-navigateurs, qu'on ne contourne pas) — l'[étude des
  sources](docs/sources.md) détaille chaque verdict.
- Distances à vol d'oiseau corrigées (× 1,3), pas des itinéraires.
- Leboncoin, SeLoger et Bien'ici restent **écartés** : DataDome + interdiction
  explicite de l'accès automatisé (Leboncoin), qu'on ne contourne pas (§10).
  Seule voie restante : l'import d'alertes e-mail, non construite à ce jour.
- Les notifications ne sont pas de l'instantané : elles partent au rythme des
  collectes (tâche planifiée + intervalles adaptatifs par source, §7).
- La collecte tourne sur votre machine : ordinateur éteint, pas de collecte ni
  de notification (limite assumée du choix 100 % local).

## Roadmap

- **Actuel** : pipeline complet, 20 sources actives (portails + réseaux +
  agences niçoises via les adaptateurs génériques Apimo et Hektor, Studapart
  par API publique) + PAP prête mais désactivée ; mode local zéro-cloud ;
  4 scores en anneaux ; dédoublonnage multi-signaux ; contact manuel + relance
  - trace des pièces envoyées ; affinité et page Stats ; notifications Telegram
    et navigateur ; documents de candidature locaux ; frontend mobile
    (Tailwind CSS + shadcn/ui) ; docs et suite Vitest + Playwright.
- **Ensuite** : import d'alertes e-mail (seule voie conforme pour
  Leboncoin/SeLoger/Bien'ici), davantage d'agences, relances automatisées,
  historique des prix enrichi.
- **Plus tard** : scores calibrés sur les résultats réels, scheduler optimisé
  dynamiquement.

## Troubleshooting

| Symptôme                                                                       | Cause probable et remède                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm collect` n'exécute aucune source                                         | Le scheduler estime qu'aucune n'est due (intervalles §7). Vérifier la page Sources ; pour forcer, supprimer `data/local.db` (repart de zéro) ou attendre l'intervalle.          |
| Une source est `blocked`                                                       | Elle a répondu 401/403 : le scraper s'arrête définitivement et ne tentera aucun contournement (§10). Voir son verdict dans [docs/sources.md](docs/sources.md).                  |
| Une source est `cooldown`                                                      | HTTP 429 reçu : repos automatique (durée dans la page Sources), les autres sources continuent.                                                                                  |
| `Le port 8788 est déjà utilisé` au `pnpm local`                                | Un serveur tourne déjà — ouvrir http://127.0.0.1:8788, ou `PORT=8789 pnpm local`.                                                                                               |
| L'interface locale affiche « Interface non construite »                        | Lancer `pnpm local` (qui construit), pas `pnpm --filter @rentfinder/collector serve` seul.                                                                                      |
| 0 annonce alors que la collecte a réussi                                       | Les annonces sont hors critères (≤ 700 €, ≥ 14 m², Nice). Cocher « Afficher les annonces hors critères ».                                                                       |
| Un parser ne trouve plus de prix (warning « structure probablement modifiée ») | Le site a changé son HTML : suivre la procédure de réparation dans la section « scraping » de [docs/architecture.md](docs/architecture.md).                                     |
| Pas de notification Telegram                                                   | Vérifier `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` dans `.env` (voir le script d'installation) ; le notifieur ne signale que les annonces découvertes **après** son activation. |

## Licence

[MIT](LICENSE). Le code est libre ; son **usage** doit rester conforme aux CGU
des sites consultés et au droit applicable (RGPD compris). Ce projet est conçu
pour un usage personnel de recherche de logement, à faible volume.
