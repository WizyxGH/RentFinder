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

| Variable                                       | Rôle                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `REFERENCE_WORK_ADDRESS` (ou `_LAT`/`_LON`)    | Lieu de travail — géocodé pour afficher le temps de trajet (§20). |
| `REFERENCE_STATION_ADDRESS` (ou `_LAT`/`_LON`) | Gare de référence.                                                |
| `TENANT_*`                                     | Profil locataire pour composer les messages de contact (§25).     |
| `BEP_SUBSCRIBER_USER` / `_PASSWORD`            | Accès abonné BEP payé, si vous en avez un (§6).                   |
| `COLLECTOR_USER_AGENT`                         | User-Agent du collecteur (identifiable, honnête — §10).           |
| `BACKFILL_ENABLED`                             | Mode backfill, `false` par défaut (§8).                           |

`.env` est chargé automatiquement par `pnpm collect` et `pnpm local`.

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

## Pourquoi plus de cloud ?

Les versions antérieures déployaient sur GitHub Pages + Cloudflare Workers +
Turso. Le projet est désormais **volontairement 100% local** : plus simple, sans
quota, sans secret à gérer, et vos données (annonces suivies, statuts, adresses)
ne quittent jamais votre machine — ce qui est le mieux du point de vue de la
confidentialité (§26). L'historique Git conserve l'ancienne architecture cloud
si vous souhaitez y revenir.
