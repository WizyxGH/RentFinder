# Hébergement cloud gratuit (optionnel)

Par défaut, RentFinder est **100 % local** (voir [deployment.md](deployment.md)).
Ce document décrit l'option **cloud gratuite** : la collecte tourne 24/7 sans
que votre ordinateur soit allumé, et le site est accessible depuis votre
téléphone, partout.

Tout le code est déjà en place (Worker, workflows, support Turso). Il ne reste
qu'à créer **vos** comptes gratuits et à coller quelques secrets — rien de tout
cela n'est dans le dépôt public (§26).

## Architecture

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

## Étapes d'activation

### 1. Base Turso (gratuit)

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

### 2. Worker Cloudflare (gratuit) — l'API

Choisissez un **jeton d'accès** privé (une longue chaîne aléatoire) : c'est lui
que le site vous demandera à la première ouverture.

```bash
cd packages/api
npx wrangler secret put TURSO_DATABASE_URL      # colle l'URL Turso
npx wrangler secret put TURSO_AUTH_TOKEN         # colle le jeton Turso
npx wrangler secret put API_ACCESS_TOKEN         # colle VOTRE jeton d'accès
# API_ALLOWED_ORIGIN (l'URL publique du site) est dans wrangler.toml [vars]
npx wrangler deploy                              # → URL publique du Worker
```

### 3. Collecte planifiée — GitHub Actions

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

### 4. Le site — GitHub Pages

`deploy-frontend.yml` publie le bundle à chaque push. Réglez la variable
`VITE_API_URL` (l'URL du Worker) et activez Pages (**Settings → Pages**). À la
première ouverture, le site demande votre `API_ACCESS_TOKEN`, conservé dans le
navigateur — jamais dans le bundle (§26).

## Revenir au 100 % local

Retirez `TURSO_DATABASE_URL` de votre environnement : `pnpm collect` et
`pnpm local` repassent automatiquement sur le fichier SQLite local. Les deux
modes partagent le même code de routes et de collecte.
