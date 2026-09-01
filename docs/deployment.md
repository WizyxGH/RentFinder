# Installation et usage — 100% local

RentFinder fonctionne **intégralement sur votre machine** : aucun compte cloud,
aucun service à payer, aucune clé d'API. La base est un fichier SQLite, la
collecte et l'interface tournent en local.

## Démarrage

```bash
pnpm install
pnpm collect      # collecte réelle → data/local.db (créée automatiquement)
pnpm local        # interface + API sur http://127.0.0.1:8788
```

- La base est un fichier SQLite (`data/local.db`, ignoré par git).
- Le serveur n'écoute que sur `127.0.0.1` : il n'est joignable ni depuis le
  réseau local ni depuis Internet, donc aucun jeton n'est nécessaire.
- Les migrations s'appliquent automatiquement au démarrage (`pnpm collect` et
  `pnpm local`).
- Relancez `pnpm collect` quand vous voulez rafraîchir ; le scheduler, les
  budgets et le cache s'appliquent comme prévu.

## Configuration privée (`.env`)

Copiez `.env.example` vers `.env` (ignoré par git) et renseignez ce qui vous
concerne. Tout est optionnel — sans `.env`, la collecte fonctionne, simplement
sans distances ni message pré-rempli.

| Variable                                       | Rôle                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `REFERENCE_WORK_ADDRESS` (ou `_LAT`/`_LON`)    | Lieu de travail — géocodé pour afficher le temps de trajet (§20).     |
| `REFERENCE_STATION_ADDRESS` (ou `_LAT`/`_LON`) | Gare de référence.                                                    |
| `TENANT_*`                                     | Profil locataire pour composer les messages de contact (§25).         |
| `BEP_SUBSCRIBER_USER` / `_PASSWORD`            | Accès abonné BEP payé, si vous en avez un (§6).                       |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`      | Notifications Telegram des nouvelles annonces (§29, voir ci-dessous). |
| `COLLECTOR_USER_AGENT`                         | User-Agent du collecteur (identifiable, honnête — §10).               |
| `BACKFILL_ENABLED`                             | Mode backfill, `false` par défaut (§8).                               |

`.env` est chargé automatiquement par `pnpm collect` et `pnpm local`. Ces
valeurs sont privées : jamais committées, jamais journalisées (§26).

## Notifications Telegram + collecte automatique (§29)

Pour être prévenu **sur votre téléphone** dès qu'une annonce entre dans vos
critères :

1. **Créer le bot** dans Telegram : `@BotFather` → `/newbot` → copier le jeton.
2. **Configurer** en une commande — le script vérifie le jeton, trouve votre
   `chat_id` (écrivez un message à votre bot quand il le demande), remplit
   `.env` et envoie un message de test :
   ```bash
   node scripts/setup-telegram.mjs <JETON>
   ```
3. **Planifier la collecte** pour que les notifications arrivent sans rien
   lancer à la main :
   ```powershell
   # Windows
   powershell -ExecutionPolicy Bypass -File scripts\schedule-collect.ps1
   ```
   ```bash
   # macOS/Linux (cron, toutes les 30 min)
   */30 * * * * cd <dépôt> && pnpm collect
   ```

Sans `TELEGRAM_*`, le notifieur reste silencieusement désactivé. La collecte
tourne sur votre machine : ordinateur éteint, pas de notification (limite
assumée du 100 % local). Le notifieur ne signale que les annonces découvertes
**après** son activation, chacune une seule fois.

## Régler les filtres de recherche

Éditez `config/search.json` (ville, budget, surface, exclusions), voir
[config/README.md](../config/README.md). Les changements s'appliquent à la
prochaine collecte.

## Commandes utiles

| Commande                     | Effet                                                     |
| ---------------------------- | --------------------------------------------------------- |
| `pnpm collect`               | un cycle de collecte                                      |
| `pnpm collect -- --verbose`  | collecte avec journalisation détaillée                    |
| `pnpm collect -- --backfill` | descend dans l'historique (exige `BACKFILL_ENABLED=true`) |
| `pnpm local`                 | construit l'interface et lance le serveur local           |
| `pnpm dev`                   | interface en mode démo (données fictives, sans base)      |
| `pnpm verify`                | format + lint + types + tests + secrets                   |

## Vérifier que tout fonctionne

- `pnpm local` puis ouvrez `http://127.0.0.1:8788`.
- La page « Sources » montre l'état et le dernier passage de chaque source.
- Si le port 8788 est occupé : `PORT=8789 pnpm local`.

## Mode cloud optionnel — hébergement gratuit 24/7 (§28)

Le mode local reste le défaut. Le mode cloud s'y AJOUTE pour deux besoins que
le local ne peut pas couvrir : **collecter et notifier PC éteint**, et
**consulter le site depuis le téléphone, partout**. Coût : 0 € (paliers
gratuits). Vos données vivent alors dans une base Turso **privée** (jeton) —
jamais dans le dépôt public ; les documents de candidature, eux, restent
STRICTEMENT locaux (§25 : l'API cloud répond 501 sur ces routes).

```
GitHub Actions (cron 30 min)  →  collecte + notifs Telegram, 24/7
        ↓
Turso (base SQLite cloud privée)
        ↓
Cloudflare Worker (API, jeton obligatoire)
        ↓
GitHub Pages (le site, accessible partout)
```

### Mise en place, par étapes

Chaque étape marche seule : on peut s'arrêter après la première.

#### Étape 1 — le site en ligne (2 minutes)

Settings → Pages → Source « **GitHub Actions** ». Une fois, et c'est tout — le
workflow ne peut pas l'activer lui-même, son jeton peut déployer sur Pages mais
pas créer le site.

Le site se publie à chaque push en **mode démonstration** : il tourne sur des
données fictives, aucune de vos annonces n'est exposée. De quoi vérifier que la
publication fonctionne avant d'aller plus loin.

#### Étape 2 — vos vraies données (~15 minutes)

1. **Turso** ([turso.tech](https://turso.tech), palier gratuit) :

   ```bash
   turso db create rentfinder
   turso db show rentfinder --url      # → libsql://…
   turso db tokens create rentfinder   # → le jeton
   ```

   Puis, depuis votre machine : ces deux valeurs dans `.env`, et
   `pnpm publish:turso` pour y envoyer l'inventaire.

2. **Worker Cloudflare** (compte gratuit) — l'API qui protège vos données :

   ```bash
   cd packages/api
   npx wrangler secret put TURSO_DATABASE_URL
   npx wrangler secret put TURSO_AUTH_TOKEN
   npx wrangler secret put API_ACCESS_TOKEN   # inventez un jeton long
   npx wrangler deploy
   ```

   Renseignez `API_ALLOWED_ORIGIN` (votre URL GitHub Pages) dans
   `packages/api/wrangler.toml`.

3. **Une seule variable GitHub** : `API_URL` = l'URL du Worker
   (Settings → Secrets and variables → Actions → Variables).

Au prochain push, le site quitte le mode démonstration. Le jeton d'accès vous
est demandé une fois dans l'interface — il n'entre jamais dans le bundle.

#### Étape 3 — collecter PC éteint (optionnel)

Pour que la collecte et les notifications Telegram tournent 24/7 :

- **Variable** `CLOUD_COLLECT_ENABLED=true` (l'interrupteur de la collecte
  planifiée), et `COLLECTOR_USER_AGENT`.
- **Secrets** : `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_CHAT_ID`, `REFERENCE_WORK_LAT`/`_LON`, `REFERENCE_STATION_*`, et
  `BEP_SUBSCRIBER_USER`/`_PASSWORD` si vous êtes abonné.

Les points de référence vont en **secrets**, jamais en variables : les variables
sont lisibles par quiconque voit le dépôt.

Sans `CLOUD_COLLECT_ENABLED=true`, la collecte planifiée ne consomme RIEN : un
fork du dépôt reste purement local. Cet interrupteur ne concerne QUE la
collecte — la publication du site n'en dépend pas.

### Historique

Les premières versions utilisaient déjà cette architecture ; elle avait été
retirée en v0.9.0 au profit du 100% local, puis réintroduite en OPTION pour
les notifications 24/7 et l'accès mobile — les deux modes coexistent.

## Hébergement cloud gratuit (optionnel)

Par défaut, RentFinder est **100 % local** (voir [deployment.md](deployment.md)).
Ce document décrit l'option **cloud gratuite** : la collecte tourne 24/7 sans
que votre ordinateur soit allumé, et le site est accessible depuis votre
téléphone, partout.

Tout le code est déjà en place (Worker, workflows, support Turso). Il ne reste
qu'à créer **vos** comptes gratuits et à coller quelques secrets — rien de tout
cela n'est dans le dépôt public (§26).

### Architecture

```
GitHub Actions (cron, gratuit)   → collecte 24/7 + notifications Telegram
        ↓ écrit
Turso (SQLite cloud, gratuit)    → base PRIVÉE (jeton), jamais dans le dépôt
        ↑ lit
Cloudflare Worker (gratuit)      → API protégée par jeton (packages/api)
        ↑ interroge
GitHub Pages / Cloudflare Pages  → le site (bundle public, sans secret)
```

Vos données (annonces suivies, statuts, favoris) vivent dans **Turso**, jamais
dans le dépôt. Vos **documents de candidature restent locaux** : l'API cloud
répond `501` sur `/api/documents` et `/api/config` (fonctionnalités disque).

### Étapes d'activation

#### 1. Base Turso (gratuit)

```bash
turso auth login                        # crée le compte gratuit (navigateur)
turso db create rentfinder
turso db show rentfinder --url          # → TURSO_DATABASE_URL
turso db tokens create rentfinder       # → TURSO_AUTH_TOKEN
```

Appliquez le schéma à la base cloud (une fois) :

```bash
TURSO_DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" pnpm db:migrate
```

#### 2. Worker Cloudflare (gratuit) — l'API

Choisissez un **jeton d'accès** privé (une longue chaîne aléatoire) : c'est lui
que le site vous demandera à la première ouverture.

```bash
cd packages/api
npx wrangler secret put TURSO_DATABASE_URL      # colle l'URL Turso
npx wrangler secret put TURSO_AUTH_TOKEN         # colle le jeton Turso
npx wrangler secret put API_ACCESS_TOKEN         # colle VOTRE jeton d'accès
## API_ALLOWED_ORIGIN (l'URL publique du site) est dans wrangler.toml [vars]
npx wrangler deploy                              # → URL publique du Worker
```

#### 3. Collecte planifiée — GitHub Actions

Dans le dépôt GitHub : **Settings → Secrets and variables → Actions**, ajoutez
les _secrets_ :

| Secret                                    | Valeur                        |
| ----------------------------------------- | ----------------------------- |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | ceux de l'étape 1             |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | pour les notifications (§29)  |
| `BEP_SUBSCRIBER_USER` / `_PASSWORD`       | optionnel (accès abonné payé) |
| `REFERENCE_WORK_ADDRESS`…                 | optionnel (distances, §20)    |

Le workflow `collect.yml` (cron toutes les 20 min) **ne fait rien** tant que
`TURSO_DATABASE_URL` est absent — aucune action involontaire.

#### 4. Le site — GitHub Pages

`deploy-frontend.yml` publie le bundle à chaque push. Réglez la variable
`VITE_API_URL` (l'URL du Worker) et activez Pages (**Settings → Pages**). À la
première ouverture, le site demande votre `API_ACCESS_TOKEN`, conservé dans le
navigateur — jamais dans le bundle (§26).

### Revenir au 100 % local

Retirez `TURSO_DATABASE_URL` de votre environnement : `pnpm collect` et
`pnpm local` repassent automatiquement sur le fichier SQLite local. Les deux
modes partagent le même code de routes et de collecte.
