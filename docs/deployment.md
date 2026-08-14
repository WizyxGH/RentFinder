# Déploiement

Architecture 100 % gratuite (§28) : GitHub (code + Actions + Pages), Turso
(base), Cloudflare Workers (API). Aucun composant payant.

## 1. Base Turso

```bash
# Installer le CLI : https://docs.turso.tech/cli/installation
turso auth signup
turso db create rentfinder
turso db show rentfinder --url          # → TURSO_DATABASE_URL
turso db tokens create rentfinder       # → TURSO_AUTH_TOKEN
```

## 2. Secrets et variables GitHub

Dans _Settings → Secrets and variables → Actions_ :

**Secrets** (jamais visibles) :

| Nom                                               | Contenu                                        |
| ------------------------------------------------- | ---------------------------------------------- |
| `TURSO_DATABASE_URL`                              | URL libsql de l'étape 1                        |
| `TURSO_AUTH_TOKEN`                                | jeton d'écriture                               |
| `REFERENCE_WORK_LAT` / `REFERENCE_WORK_LON`       | coordonnées du lieu de travail (§20 — privées) |
| `REFERENCE_STATION_LAT` / `REFERENCE_STATION_LON` | coordonnées de la gare                         |

**Variables** (non sensibles) :

| Nom                                                | Exemple                                                     |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `COLLECTOR_USER_AGENT`                             | `RentFinderBot/0.1 (+https://github.com/<vous>/rentfinder)` |
| `API_URL`                                          | URL du Worker (étape 3)                                     |
| `REFERENCE_WORK_LABEL` / `REFERENCE_STATION_LABEL` | `Travail` / `Gare` (libellés neutres)                       |
| `BACKFILL_ENABLED` / `AUTO_CONTACT_ENABLED`        | absents ou `false` (défaut sûr)                             |

Sans les secrets `REFERENCE_*`, tout fonctionne — simplement sans distances.

## 3. API Cloudflare Worker

```bash
cd packages/api
# Éditer wrangler.toml : API_ALLOWED_ORIGIN = votre URL GitHub Pages
npx wrangler login
npx wrangler secret put TURSO_DATABASE_URL
npx wrangler secret put TURSO_AUTH_TOKEN
npx wrangler secret put API_ACCESS_TOKEN     # openssl rand -base64 32
npx wrangler deploy                          # → notez l'URL du Worker
```

Reportez l'URL du Worker dans la variable `API_URL` du dépôt.

## 4. GitHub Pages

_Settings → Pages → Source : GitHub Actions._ Le workflow
`deploy-frontend.yml` construit et publie à chaque push touchant `frontend/`
ou `packages/shared/`. Il vérifie par grep qu'aucun motif de secret n'est dans
le bundle avant de publier.

## 5. Collecte

Le workflow `collect.yml` tourne sur cron (~20 min ; GitHub ne garantit pas la
ponctualité). Premier lancement manuel : _Actions → Collecte → Run workflow_.
Les migrations s'appliquent automatiquement en tête de run.

## 6. Première utilisation

1. Ouvrir l'URL GitHub Pages sur votre téléphone.
2. Saisir le jeton `API_ACCESS_TOKEN` (conservé dans le navigateur).
3. Renseigner le profil locataire (bouton « Profil » — reste sur l'appareil).

## Développement local

```bash
pnpm install
pnpm dev                                   # frontend en mode démo (données fictives)
cp .env.example .env                       # puis remplir pour le mode connecté
pnpm db:migrate && pnpm collect            # collecte locale (SQLite ou Turso selon .env)
pnpm collect -- --verbose                  # journalisation détaillée
cd packages/api && npx wrangler dev        # API locale
```

## Vérifier un déploiement

- `GET <API_URL>/api/stats` avec `Authorization: Bearer <jeton>` → compteurs.
- Sans jeton → 401 ; jeton serveur absent → 503 (l'API est fermée par défaut).
- Page « Sources » du frontend → santé et dernier passage de chaque source.

## Rotation des jetons

- API : `wrangler secret put API_ACCESS_TOKEN` puis ressaisir dans l'interface.
- Turso : `turso db tokens create` + mise à jour des deux emplacements
  (secrets Actions et Worker), puis `turso db tokens revoke` sur l'ancien.
