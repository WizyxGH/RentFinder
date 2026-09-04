# Installation et usage

Deux moitiés, et une seule façon de les brancher :

- **la COLLECTE** tourne où vous voulez — votre machine (fichier SQLite) ou
  GitHub Actions (base Turso, PC éteint) ;
- **le SITE** est publié par GitHub Pages et parle à un **Worker Cloudflare**,
  seul détenteur du jeton de la base.

Coût : 0 €, tout tient dans les paliers gratuits.

> Il a existé un troisième chemin : un serveur local qui servait aussi le site
> depuis la machine. Il a été retiré — deux chemins pour le même écran, c'était
> deux fois les mêmes cas à tenir, et le site publié fait tout ce que l'autre
> faisait.

## Démarrage

```bash
pnpm install
pnpm collect      # collecte réelle → data/local.db (créée automatiquement)
pnpm verify       # format + lint + types + tests + secrets
```

- La base locale est un fichier SQLite (`data/local.db`, ignoré par git).
- Les migrations s'appliquent automatiquement au démarrage de la collecte.
- Relancez `pnpm collect` quand vous voulez rafraîchir ; le scheduler, les
  budgets et le cache s'appliquent comme prévu.

Pour VOIR ces données, il faut le site publié (plus bas) : c'est lui, via le
Worker, qui les affiche. `pnpm dev` ne montre que le mode démonstration.

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
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`        | Base cloud. Absents, la collecte écrit dans le fichier local.         |
| `COLLECTOR_USER_AGENT`                           | User-Agent du collecteur (identifiable, honnête — §10).               |
| `BACKFILL_ENABLED`                               | Mode backfill, `false` par défaut (§8).                               |

`.env` est chargé automatiquement par les commandes de collecte. Ces valeurs
sont privées : jamais committées, jamais journalisées (§26). Les secrets du
Worker, eux, ne passent PAS par `.env` — voir l'étape 4.

## Notifications Web Push (§29)

C'est la COLLECTE qui émet, directement vers le service de push du navigateur :
aucun serveur intermédiaire. Sans les clés `VAPID_*`, le canal reste
silencieusement désactivé. Le notifieur ne signale que les annonces découvertes
**après** son activation, chacune une seule fois — et jamais deux fois le même
logement vu par deux sources.

1. **Générer les clés**, une fois :

   ```bash
   npx web-push generate-vapid-keys
   ```

   ```
   VAPID_PUBLIC_KEY=…      # part aussi dans le site : ce n'est PAS un secret
   VAPID_PRIVATE_KEY=…     # reste côté collecte
   VAPID_SUBJECT=mailto:vous@example.invalid
   ```

   Sans la clé publique au build du site, le navigateur ne peut pas s'abonner.

2. **S'abonner** : onglet Notifications → **Activer**. La page indique ensuite
   ce qui fonctionne et ce qui bloque.

Sur **Android**, l'alerte porte la photo, le loyer, le quartier, le téléphone et
deux boutons — de quoi décider et appeler sans ouvrir le site. Sur **iPhone**,
il faut d'abord ajouter le site à l'écran d'accueil (iOS 16.4+), et Apple
n'affiche ni image ni boutons : titre et texte seulement.

## Régler les critères de recherche

**Depuis le site** : « Trier et filtrer » → « Ce qui est collecté et signalé ».
Le budget et la surface s'appliquent immédiatement ; les exclusions (colocation,
location étudiante) prennent effet à la collecte suivante — elles demandent le
texte de l'annonce, pas un nombre.

Il n'y a **plus de fichier de configuration**. `config/search.json` a été
retiré : il portait les mêmes réglages que la base, les deux ne disaient pas
toujours la même chose, et rien n'indiquait lequel faisait autorité. Les
critères vivent dans la table `app_settings`, ce qui leur permet de suivre d'un
appareil à l'autre — et, depuis les comptes, d'appartenir à chacun. Les valeurs
de départ sont celles de `packages/shared/src/criteria.ts`.

## Commandes utiles

| Commande                     | Effet                                                     |
| ---------------------------- | --------------------------------------------------------- |
| `pnpm collect`               | un cycle de collecte                                      |
| `pnpm collect -- --verbose`  | collecte avec journalisation détaillée                    |
| `pnpm collect -- --backfill` | descend dans l'historique (exige `BACKFILL_ENABLED=true`) |
| `pnpm publish:turso`         | pousse l'inventaire local vers la base cloud              |
| `pnpm dev`                   | interface seule, en mode démonstration                    |
| `pnpm verify`                | format + lint + types + tests + secrets                   |

La page « Sources » du site montre l'état et le dernier passage de chaque
source : c'est là qu'on vérifie que tout tourne.

## Mise en ligne

```
GitHub Actions (cron 20 min)  → collecte 24/7 et notifications Web Push
        ↓ écrit
Turso (SQLite cloud)          → base PRIVÉE, jeton jamais publié
        ↑ lit
Worker Cloudflare             → l'API, les sessions, les pièces du dossier
        ↑ appelle                (R2), et le SEUL détenteur du jeton Turso
GitHub Pages                  → le site (bundle public, sans aucun secret)
```

**POURQUOI UN WORKER, alors que le site parlait directement à Turso.** Le jeton
vivait alors dans le navigateur. Il ouvrait toute la base — donc aucun mot de
passe ne pouvait être vérifié : un écran de connexion posé devant se serait
contourné en changeant une variable dans la console. Le Worker déplace ce jeton
hors de portée ; le navigateur ne reçoit plus qu'un cookie de session signé.

C'est ce qui rend le **multi-compte** possible : les annonces sont communes,
mais favoris, suivi, archivage et recherches enregistrées appartiennent à
chacun (`listing_user_state`), et les pièces du dossier aussi.

### 1. Base Turso

```bash
turso auth login                        # compte gratuit (navigateur)
turso db create rentfinder
turso db show rentfinder --url          # → TURSO_DATABASE_URL
turso db tokens create rentfinder       # → TURSO_AUTH_TOKEN
```

Placez ces deux valeurs dans `.env`, appliquez le schéma, puis publiez ce que
vous avez déjà collecté :

```bash
pnpm db:migrate
pnpm publish:turso        # --dry-run pour voir sans écrire
```

Le schéma part en entier ; les données seulement pour les annonces et l'état des
sources — jamais les caches de géocodage ni l'historique de contacts.

### 2. Le site — GitHub Pages

**Settings → Pages**, source « **GitHub Actions** ». Une fois, et c'est tout :
le workflow ne peut pas l'activer lui-même, son jeton peut déployer sur Pages
mais pas créer le site. `deploy-frontend.yml` publie ensuite à chaque push.

Tant que le site n'est relié à aucune API, il affiche un écran de connexion —
jamais de données fictives.

### 3. Collecte planifiée — GitHub Actions

**Settings → Secrets and variables → Actions** :

| Secret                                               | Valeur                        |
| ---------------------------------------------------- | ----------------------------- |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`            | ceux de l'étape 1             |
| `VAPID_PUBLIC_KEY` / `_PRIVATE_KEY`                  | pour les notifications (§29)  |
| `BEP_SUBSCRIBER_USER` / `_PASSWORD`                  | optionnel (accès abonné payé) |
| `REFERENCE_WORK_LAT` / `_LON`, `REFERENCE_STATION_*` | optionnel (distances, §20)    |

Plus la _variable_ `CLOUD_COLLECT_ENABLED=true`, l'interrupteur de la collecte
planifiée. Sans elle, `collect.yml` **ne fait rien** : un fork du dépôt ne
consomme rien et ne déclenche aucune action involontaire.

Les points de référence vont en **secrets**, jamais en variables : les variables
sont lisibles par quiconque voit le dépôt.

### 4. L'API et les comptes — Worker Cloudflare

```bash
cd packages/worker

# Les trois secrets. Ils ne sont NI dans le dépôt, NI dans le bundle, NI dans .env.
npx wrangler secret put TURSO_DATABASE_URL   # libsql://…
npx wrangler secret put TURSO_AUTH_TOKEN     # le jeton, qui quitte le navigateur
npx wrangler secret put SESSION_SECRET       # une longue chaîne aléatoire, à vous

# L'espace des pièces du dossier de candidature (§25), une fois.
npx wrangler r2 bucket create rentfinder-documents

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

### Les pièces du dossier de candidature (§25)

Elles vivent dans le seau R2 créé à l'étape 4, **rangées par compte**
(`<utilisateur>/<fichier>`) : un dossier contient une fiche de paie et une pièce
d'identité, il n'y a pas de pièces communes. PDF et images, 10 Mo par pièce.

Elles étaient auparavant sur le disque de la machine qui servait le site — ce
qui les rendait inatteignables depuis le téléphone, alors qu'une candidature
s'envoie d'où l'on est.

**Rien n'est jamais envoyé automatiquement** (§24) : le site dépose, liste,
consulte et supprime ; c'est vous qui joignez. Sans le binding `DOCUMENTS`,
l'API répond `501` et l'écran se tait, plutôt que d'accepter des fichiers pour
les perdre.

### Sans Worker : l'accès direct à Turso

Le site sait aussi interroger Turso directement, avec l'adresse et le jeton
saisis à la première ouverture et conservés dans le navigateur. C'est plus
simple, mais il n'y a alors **ni connexion, ni comptes séparés, ni pièces du
dossier** : quiconque ouvre la page et connaît le jeton voit tout.
