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

### Mise en place (une fois, ~20 min)

1. **Turso** ([turso.tech](https://turso.tech), palier gratuit) :
   `turso db create rentfinder` puis `turso db show rentfinder --url` et
   `turso db tokens create rentfinder`. Notez l'URL (`libsql://…`) et le jeton.
2. **Secrets GitHub** (Dépôt → Settings → Secrets and variables → Actions) :
   - Secrets : `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TELEGRAM_BOT_TOKEN`,
     `TELEGRAM_CHAT_ID`, `BEP_SUBSCRIBER_USER`/`_PASSWORD` (optionnel),
     `REFERENCE_WORK_LAT`/`_LON` (ou `_ADDRESS`), `REFERENCE_STATION_*`.
   - Variables : `CLOUD_COLLECT_ENABLED=true` (l'interrupteur général),
     `COLLECTOR_USER_AGENT`, `API_URL` (l'URL du Worker, étape 3).
3. **Worker Cloudflare** (compte gratuit) :
   ```bash
   cd packages/api
   npx wrangler secret put TURSO_DATABASE_URL
   npx wrangler secret put TURSO_AUTH_TOKEN
   npx wrangler secret put API_ACCESS_TOKEN   # inventez un jeton fort
   npx wrangler deploy
   ```
   Renseignez `API_ALLOWED_ORIGIN` (votre URL GitHub Pages) dans
   `packages/api/wrangler.toml`, et l'URL du Worker dans la variable GitHub
   `API_URL`.
4. **GitHub Pages** : Settings → Pages → Source « GitHub Actions ». Le workflow
   `deploy-frontend.yml` publie l'interface à chaque push.
5. Ouvrez le site → il demande votre **jeton d'accès** (`API_ACCESS_TOKEN`) —
   saisi une fois, conservé dans le navigateur, jamais dans le dépôt (§26).

Sans `CLOUD_COLLECT_ENABLED=true`, les workflows ne consomment RIEN : un fork
du dépôt reste purement local.

### Historique

Les premières versions utilisaient déjà cette architecture ; elle avait été
retirée en v0.9.0 au profit du 100% local, puis réintroduite en OPTION pour
les notifications 24/7 et l'accès mobile — les deux modes coexistent.
