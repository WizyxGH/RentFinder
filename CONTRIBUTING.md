# Contribuer à RentFinder

Projet principalement personnel, mais conçu pour être compréhensible et
modifiable par quelqu'un qui le découvre (§72). Merci de lire ceci avant toute
Pull Request.

## Installation

```bash
corepack enable          # active pnpm
pnpm install
pnpm dev                 # frontend en mode démo — aucun secret requis
pnpm verify              # la vérification complète doit passer sur main
```

## Architecture en deux phrases

Un monorepo pnpm : `packages/shared` (types et contrats, zéro logique),
`packages/collector` (collecte → normalisation → dédoublonnage → scoring →
Turso), `packages/api` (Worker Cloudflare à jeton), `frontend/` (React).
Commencez par [docs/architecture.md](docs/architecture.md).

## Règles de sécurité et de confidentialité — bloquantes

Le dépôt est **public**. Toute PR doit passer `pnpm check:secrets` et Gitleaks.

- Jamais de vraie donnée personnelle, même en exemple : e-mails en
  `example.invalid`, téléphones en `06 00 00 00 xx`, noms inventés.
- Jamais de jeton, cookie, URL Turso réelle — y compris dans les messages de
  commit et les captures d'écran.
- Les fixtures HTML sont anonymisées à la main avant d'entrer dans le dépôt
  ([tests/fixtures/README.md](tests/fixtures/README.md)).
- Détail complet : [docs/privacy.md](docs/privacy.md).

## Règles de scraping — bloquantes

Aucune PR n'est acceptée si elle : contourne une protection (CAPTCHA,
anti-bot, rate limit), ignore un `robots.txt`, déguise le User-Agent en
navigateur, réessaie après un 429, télécharge des images, ou ajoute une source
sans fiche d'étude dans [docs/sources.md](docs/sources.md). Voir
[docs/scraping.md](docs/scraping.md).

## Ajouter une source

Le cas de contribution le plus utile. Mode d'emploi pas à pas :
[docs/contributing.md](docs/contributing.md#ajouter-une-source). Résumé :
étude robots.txt datée → fixtures anonymisées (nominale + dégradée) → parser
pur → tests → scraper → enregistrement dans `ALL_SCRAPERS` → `pnpm verify`.

## Tests

- Tout bug corrigé s'accompagne d'un test qui le reproduit, conservé
  définitivement (§51). Ne jamais supprimer ou désactiver un test pour faire
  passer une implémentation ; si le comportement attendu change réellement,
  modifier le test explicitement et le documenter dans la PR et le CHANGELOG.
- Les tests sont déterministes : horloge injectée (`Clock`), fixtures locales,
  aucun accès réseau, jamais la base de production (§59, §52).
- Couverture : priorité aux parties critiques (parsing, dédoublonnage, scoring,
  scheduler, contact, sécurité), pas au pourcentage global (§58).

## Pull Requests

1. Branche depuis `main`, commits `type(portée): description` —
   `feat(scraper): add orpi source`, `fix(deduplication): handle missing phone`.
2. `pnpm verify` vert en local.
3. PR : le _pourquoi_ autant que le _quoi_ ; entrée CHANGELOG pour tout
   changement notable (nouvelle source, schéma, scores, contact).
4. La CI (format, lint, types, tests, E2E, secrets) doit être verte — une
   régression la fait échouer, c'est voulu.
