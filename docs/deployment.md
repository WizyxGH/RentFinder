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

## Pourquoi plus de cloud ?

Les versions antérieures déployaient sur GitHub Pages + Cloudflare Workers +
Turso. Le projet est désormais **volontairement 100% local** : plus simple, sans
quota, sans secret à gérer, et vos données (annonces suivies, statuts, adresses)
ne quittent jamais votre machine — ce qui est le mieux du point de vue de la
confidentialité (§26). L'historique Git conserve l'ancienne architecture cloud
si vous souhaitez y revenir.
