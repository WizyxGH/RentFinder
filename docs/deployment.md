# Installation et usage

Deux modes coexistent, et le même code les sert : **local** (tout sur votre
machine) et **publié** (collecte dans GitHub Actions, site sur GitHub Pages,
API sur un Worker Cloudflare). Ce document couvre les deux, dans cet ordre.

RentFinder fonctionne **intégralement sur votre machine** : aucun compte cloud,
aucun service à payer, aucune clé d'API. La base est un fichier SQLite, la
collecte et l'interface tournent en local.

## Démarrage

```bash
pnpm install
pnpm collect      # collecte réelle → data/local.db (créée automatiquement)
pnpm dev          # l'interface, en mode démonstration
```

- La base est un fichier SQLite (`data/local.db`, ignoré par git).
- Le serveur n'écoute que sur `127.0.0.1` : il n'est joignable ni depuis le
  réseau local ni depuis Internet, donc aucun jeton n'est nécessaire.
- Les migrations s'appliquent automatiquement au démarrage (`pnpm collect` et
  la collecte).
- Relancez `pnpm collect` quand vous voulez rafraîchir ; le scheduler, les
  budgets et le cache s'appliquent comme prévu.

## Configuration privée (`.env`)

Copiez `.env.example` vers `.env` (ignoré par git) et renseignez ce qui vous
concerne. Tout est optionnel — sans `.env`, la collecte fonctionne, simplement
sans distances ni message pré-rempli.

| Variable                                         | Rôle                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `REFERENCE_WORK_ADDRESS` (ou `_LAT`/`_LON`)      | Lieu de travail — géocodé pour afficher le temps de trajet (§20).     |
| `REFERENCE_STATION_ADDRESS` (ou `_LAT`/`_LON`)   | Gare de référence.                                                    |
| `TENANT_*`                                       | Profil locataire pour composer les messages de contact (§25).         |
| `BEP_SUBSCRIBER_USER` / `_PASSWORD`              | Accès abonné BEP payé, si vous en avez un (§6).                       |
| `VAPID_PUBLIC_KEY` / `_PRIVATE_KEY` / `_SUBJECT` | Notifications Web Push des nouvelles annonces (§29, voir ci-dessous). |
| `COLLECTOR_USER_AGENT`                           | User-Agent du collecteur (identifiable, honnête — §10).               |
| `BACKFILL_ENABLED`                               | Mode backfill, `false` par défaut (§8).                               |

`.env` est chargé automatiquement par les commandes de collecte. Ces
valeurs sont privées : jamais committées, jamais journalisées (§26).

## Notifications + collecte automatique (§29)

Pour être prévenu **sur votre téléphone** dès qu'une annonce entre dans vos
critères :

1. **Générer les clés VAPID** une fois, et les mettre dans `.env` :
   ```bash
   npx web-push generate-vapid-keys
   # VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, puis VAPID_SUBJECT=mailto:vous@example.invalid
   ```
   La clé PUBLIQUE entre aussi dans le bundle du site (`VAPID_PUBLIC_KEY` au
   build) : sans elle, le navigateur ne peut pas s'abonner.
2. **S'abonner** depuis le site : cloche en haut à droite → « Site fermé ». Sur
   iPhone, ajoutez d'abord le site à l'écran d'accueil (Partager → Sur l'écran
   d'accueil) : hors de ce mode, Safari n'expose pas l'API.
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

C'est la COLLECTE qui émet, directement vers le service de push du navigateur :
aucun serveur intermédiaire. Sans les clés `VAPID_*`, le canal reste
silencieusement désactivé. Le notifieur ne signale que les annonces découvertes
**après** son activation, chacune une seule fois.

## Régler les filtres de recherche

**Depuis le site** : « Trier et filtrer » → « Ce qui est collecté et signalé ».
Le budget et la surface s'appliquent immédiatement ; les exclusions
(colocation, location étudiante) prennent effet à la collecte suivante — elles
demandent le texte de l'annonce, pas un nombre.

Il n'y a **plus de fichier de configuration**. `config/search.json` a été
retiré : il portait les mêmes réglages que la base, les deux ne disaient pas
toujours la même chose, et rien n'indiquait lequel faisait autorité. Les
critères vivent dans la table `app_settings`, ce qui leur permet de suivre d'un
appareil à l'autre — et, depuis les comptes, d'appartenir à chacun.

Les valeurs de départ, tant que rien n'a été réglé, sont celles de
`packages/shared/src/criteria.ts`.

## Commandes utiles

| Commande                     | Effet                                                     |
| ---------------------------- | --------------------------------------------------------- |
| `pnpm collect`               | un cycle de collecte                                      |
| `pnpm collect -- --verbose`  | collecte avec journalisation détaillée                    |
| `pnpm collect -- --backfill` | descend dans l'historique (exige `BACKFILL_ENABLED=true`) |
| `pnpm dev`                   | interface seule ; écran de connexion tant qu'aucune base  |
| `pnpm verify`                | format + lint + types + tests + secrets                   |

## Vérifier que tout fonctionne

- La page « Sources » montre l'état et le dernier passage de chaque source.

## Mode cloud optionnel — hébergement gratuit 24/7 (§28)

Le mode local reste le défaut. Le mode cloud s'y AJOUTE pour deux besoins que
le local ne peut pas couvrir : **collecter et notifier PC éteint**, et
**consulter le site depuis le téléphone, partout**. Coût : 0 € (paliers
gratuits). Vos données vivent alors dans une base Turso **privée** (jeton) —
jamais dans le dépôt public ; les documents de candidature, eux, restent
STRICTEMENT locaux (§25) : le site publié n'y a pas accès.

```
GitHub Actions (cron 30 min)  →  collecte et notifications Web Push, 24/7
        ↓
Turso (base SQLite cloud privée)
        ↑  lu directement par le site
GitHub Pages (le site, accessible partout)
```

### Mise en place, par étapes

Chaque étape marche seule : on peut s'arrêter après la première.

#### Étape 1 — le site en ligne (2 minutes)

Settings → Pages → Source « **GitHub Actions** ». Une fois, et c'est tout — le
workflow ne peut pas l'activer lui-même, son jeton peut déployer sur Pages mais
pas créer le site.

Le site se publie à chaque push. Tant qu'il n'est relié à aucune base, il
affiche un écran de connexion — jamais de données fictives. De quoi vérifier
que la publication fonctionne avant d'aller plus loin.

#### Étape 2 — vos vraies données (~10 minutes)

Le site interroge Turso DIRECTEMENT : aucun service intermédiaire, aucun compte
de plus que Turso.

1. **Turso** ([turso.tech](https://turso.tech), palier gratuit) : créez une base
   `rentfinder`, puis relevez son adresse et un jeton (bouton **Connect** sur la
   page de la base). Placez-les dans `.env` :

   ```
   TURSO_DATABASE_URL=libsql://…turso.io
   TURSO_AUTH_TOKEN=…
   ```

2. **Publiez l'inventaire** : `pnpm publish:turso`. Le schéma part en entier,
   les données seulement pour les annonces et l'état des sources — jamais les
   caches de géocodage ni l'historique de contacts.

3. **Ouvrez le site** : il demande ces deux mêmes valeurs, une fois. Elles
   restent dans votre navigateur, jamais dans le dépôt.

Ce jeton donne accès en lecture ET écriture — c'est ce qui permet de mettre un
favori ou de noter un contact depuis le téléphone. En cas de fuite, le dommage
reste réparable : les annonces se régénèrent, et rien de personnel n'est publié.

#### Étape 3 — notifications sur le téléphone (optionnel)

**Web Push** — alerte même application fermée, sans installer d'application.
L'alerte porte la photo, le loyer, la surface, l'adresse, la disponibilité, le
téléphone et la priorité, avec un bouton « Appeler » : de quoi décider et agir
sans ouvrir le site.

Générez une paire de clés puis placez-les dans `.env` et dans les secrets du
dépôt :

```bash
npx web-push generate-vapid-keys
```

```
VAPID_PUBLIC_KEY=…      # part dans le site : ce n'est PAS un secret
VAPID_PRIVATE_KEY=…     # reste privée, côté collecte
VAPID_SUBJECT=mailto:vous@example.invalid
```

Puis, sur le site : onglet **Notifications** → **Activer**. La page indique
ensuite ce qui fonctionne et ce qui bloque.

Sur **Android**, la notification porte la photo, le loyer, le quartier, le
téléphone et deux boutons. Sur **iPhone**, il faut d'abord ajouter le site à
l'écran d'accueil (iOS 16.4+), et Apple n'affiche ni image ni boutons : titre
et texte seulement.

#### Étape 4 — collecter PC éteint (optionnel)

Pour que la collecte et les notifications tournent 24/7 :

- **Variable** `CLOUD_COLLECT_ENABLED=true` (l'interrupteur de la collecte
  planifiée), et `COLLECTOR_USER_AGENT`.
- **Secrets** : `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `REFERENCE_WORK_LAT`/`_LON`,
  `REFERENCE_STATION_*`, et `BEP_SUBSCRIBER_USER`/`_PASSWORD` si abonné.

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

Tout le code est en place. Il ne reste qu'à créer **votre** compte Turso et à
coller deux valeurs — rien de tout cela n'est dans le dépôt public (§26).

### Architecture

```
GitHub Actions (cron, gratuit)  → collecte 24/7 et notifications Web Push
        ↓ écrit
Turso (SQLite cloud, gratuit)   → base PRIVÉE, jeton jamais publié
        ↑ lit
Worker Cloudflare (gratuit)     → l'API, les sessions, et le SEUL détenteur
        ↑ appelle                  du jeton Turso
GitHub Pages                    → le site (bundle public, sans aucun secret)
```

**POURQUOI UN WORKER, alors que le site parlait directement à Turso.** Le jeton
vivait alors dans le navigateur. Il ouvrait toute la base — donc aucun mot de
passe ne pouvait être vérifié : un écran de connexion posé devant se serait
contourné en changeant une variable dans la console. Le Worker déplace ce jeton
hors de portée ; le navigateur ne reçoit plus qu'un cookie de session signé.

C'est ce qui rend le **multi-compte** possible : les annonces sont communes,
mais favoris, suivi, archivage et recherches enregistrées appartiennent à
chacun (`listing_user_state`).

Vos données (annonces suivies, statuts, favoris) vivent dans **Turso**, jamais
dans le dépôt. Vos **documents de candidature restent locaux** : ils touchent
le disque de votre machine, et l'API publiée répond donc `501` sur
`/api/documents` et `/api/config`.

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

#### 2. Publier l'inventaire

```bash
pnpm publish:turso        # --dry-run pour voir sans écrire
```

Le site demandera l'adresse de la base et son jeton à la première ouverture —
les deux valeurs de votre `.env`. Elles restent dans le navigateur.

#### 3. Collecte planifiée — GitHub Actions

Dans le dépôt GitHub : **Settings → Secrets and variables → Actions**, ajoutez
les _secrets_ :

| Secret                                    | Valeur                        |
| ----------------------------------------- | ----------------------------- |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | ceux de l'étape 1             |
| `VAPID_PUBLIC_KEY` / `_PRIVATE_KEY`       | pour les notifications (§29)  |
| `BEP_SUBSCRIBER_USER` / `_PASSWORD`       | optionnel (accès abonné payé) |
| `REFERENCE_WORK_ADDRESS`…                 | optionnel (distances, §20)    |

Le workflow `collect.yml` (cron toutes les 20 min) **ne fait rien** tant que
`TURSO_DATABASE_URL` est absent — aucune action involontaire.

#### 4. Le site — GitHub Pages

`deploy-frontend.yml` publie le bundle à chaque push ; il suffit d'activer Pages
(**Settings → Pages**, source « GitHub Actions »). À la première ouverture, le
site demande l'adresse de votre base et son jeton — conservés dans le
navigateur, jamais dans le bundle (§26).

#### 5. L'API et les comptes — Worker Cloudflare

Sans cette étape, le site reste utilisable avec l'accès direct à Turso, mais il
n'y a **ni connexion ni comptes séparés** : quiconque ouvre la page et connaît
le jeton voit tout.

```bash
cd packages/worker

# Les trois secrets. Ils ne sont NI dans le dépôt, NI dans le bundle.
npx wrangler secret put TURSO_DATABASE_URL   # libsql://…
npx wrangler secret put TURSO_AUTH_TOKEN     # le jeton, qui quitte le navigateur
npx wrangler secret put SESSION_SECRET       # une longue chaîne aléatoire, à vous

npx wrangler deploy                          # affiche l'URL du Worker
```

Puis, une fois par personne :

```bash
pnpm --filter @rentfinder/worker user:add
```

La commande demande un identifiant et un mot de passe **sans l'afficher**, et
n'écrit que son empreinte (PBKDF2, 210 000 tours). Elle ne prend pas le mot de
passe en argument : il resterait dans l'historique du terminal.

Il n'y a **pas d'écran d'inscription** sur le site, et c'est voulu : un site
ouvert à l'inscription est un site que n'importe qui remplit.

Enfin, deux réglages se répondent :

- `ALLOWED_ORIGIN` dans `packages/worker/wrangler.toml` = l'adresse du site
  (`https://<vous>.github.io`). Un `*` serait refusé par les navigateurs dès
  lors qu'on envoie un cookie — et il le serait à raison.
- `VITE_API_URL` du build du site = l'URL du Worker.

### Revenir au 100 % local

Retirez `TURSO_DATABASE_URL` de votre environnement : `pnpm collect` et
`pnpm collect` repassent automatiquement sur le fichier SQLite local. Les deux
modes partagent le même code de routes et de collecte.
