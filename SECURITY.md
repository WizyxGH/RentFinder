# Sécurité

## Signaler une vulnérabilité

Ouvrez un **avis de sécurité privé** GitHub (_Security → Advisories → Report a
vulnerability_) plutôt qu'une issue publique, en particulier pour tout ce qui
touche à l'exposition de données personnelles ou à l'authentification de l'API.
Les issues publiques restent adaptées aux problèmes sans impact de
confidentialité.

## Modèle de menace en bref

Le dépôt est public ; les données (annonces, contacts, localisation) sont
privées et **ne quittent jamais la machine** : le projet est 100% local, la
base est un fichier SQLite (`data/`, ignoré par git) et le serveur n'écoute que
sur `127.0.0.1`. Il n'y a donc ni service exposé, ni jeton, ni données
publiées. Les surfaces sensibles restantes : les identifiants privés dans
`.env` (accès abonné BEP, profil) et l'injection via le HTML scrapé.

## Gestion des secrets

- Aucun secret dans le dépôt, jamais : ils vivent dans `.env` local (ignoré par
  git).
- Interdiction de committer des credentials — appliquée par deux mécanismes
  bloquants en CI : scanner maison (`pnpm check:secrets`) et Gitleaks sur
  l'historique.
- Les logs expurgent automatiquement jetons, e-mails et téléphones avant
  écriture (`packages/collector/src/core/logger.ts`).
- Données fictives obligatoires dans tests et fixtures : `example.invalid`,
  `06 00 00 00 xx`.

## Données privées

Cartographie complète, barrières et procédure en cas de fuite (révocation
d'abord, nettoyage ensuite) : [docs/privacy.md](docs/privacy.md).

## Périmètre

Ce projet est un outil personnel auto-hébergé : il n'y a ni multi-utilisateurs,
ni données de tiers confiées au projet. Les vulnérabilités les plus sensibles
sont donc : contournement d'authentification de l'API, fuite de secrets via
CI/logs/bundle, et injection via le contenu HTML scrapé.
