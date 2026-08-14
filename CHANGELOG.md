# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Documenter ici : nouvelles sources, changements d'architecture ou de schéma,
évolutions des scores et du système de contact, corrections importantes (§70).

## [0.1.0] — 2026-08-14

Fondations complètes du MVP.

### Ajouté

- **Monorepo** pnpm + TypeScript strict : `shared` (types/contrats), `collector`
  (pipeline), `api` (Worker Cloudflare), `frontend` (React + Vite).
- **Modèle de données** à quatre étages (`RawListing` → `NormalizedListing` →
  `AggregatedListing` → `ScoredListing`), avec provenance par champ
  (`MergedField`) et convention `null` = « non fourni par la source ».
- **Core de collecte** : client HTTP unique (UA identifiable, budgets, jitter,
  backoff, cache ETag/304, arrêt sur 429/403), rate limiter par source, horloge
  injectable, logger à expurgation automatique, registre de sources.
- **Scheduler adaptatif** : intervalle par source selon productivité et
  erreurs, quota par run, équité par ancienneté, cooldown post-429.
- **Source Laforêt** (`laforet`) : première source réelle — robots.txt vérifié
  le 2026-08-14, pages `/ville/location-appartement-nice-*`, arrêt anticipé en
  terrain connu, fixtures anonymisées nominale + dégradée.
- **Normalisation** française : nombres (« 1 890 », « 1.250,50 »), surfaces,
  pièces, téléphones E.164, dates relatives (« il y a 4 min »).
- **Dédoublonnage** : blocage anti-O(n²), similarité multi-signaux avec vetos
  (villes, surfaces, loyers, pièces, GPS), union-find, fusion conservant les
  conflits ; les paires ambiguës ne fusionnent pas.
- **Scores** Match / Opportunité / Probabilité de visite / Risque, tous
  expliqués (raisons + signaux inconnus + confiance), priorité d'action pour le
  tri ; détection d'arnaques par motifs.
- **Distances** à vol d'oiseau (× 1,3 urbain) vers points de référence privés.
- **Base Turso/libsql** : migration initiale, repository économe
  (content-hash : zéro écriture pour une annonce inchangée), cycle de vie
  active → possiblyInactive → inactive, journal des runs, événements.
- **API** Cloudflare Worker : jeton Bearer temps-constant, CORS restreint,
  fermée par défaut, routes listings/sources/stats/tracking/contact.
- **Frontend** mobile-first (3 vues, zéro dépendance hors React) : liste triée
  par priorité d'action, fiche avec sources et scores détaillés, contact
  manuel ([Modifier][Copier][Ouvrir][J'ai envoyé]), profil locataire stocké
  sur l'appareil, page d'état des sources, mode démo sans configuration.
- **Garde-fous du contact automatique** (évaluation seule, aucun envoi) :
  interrupteur global OFF, manualOnly, un contact par annonce, seuils, quotas,
  cooldown.
- **Tests** : 267 au total — 223 unitaires/intégration Node (pipeline complet
  sur SQLite mémoire, scénarios 1-3 et 5-7 du cahier des charges, sécurité),
  26 tests frontend, 18 scénarios E2E Playwright (mobile + desktop).
- **CI/CD** : workflow CI (format, lint, types, tests, build, E2E, secrets ×2),
  collecte planifiée centralisée, déploiement Pages avec grep anti-secret.
- **Documentation** : README, 12 documents `docs/`, étude datée des sources.

### Corrigé

- Parsing des surfaces : le motif `m²` se terminait par `\b`, qui ne peut pas
  matcher après « ² » (caractère non-mot) — toutes les surfaces étaient lues
  comme absentes. Test de non-régression ajouté (§51).
- Extraction de la ville Laforêt : « 690 €/mois NICE (06000) » capturait
  « mois NICE » ; le motif exige désormais une majuscule initiale. Test ajouté.

### Décisions notables

- Leboncoin et SeLoger **écartés** (pas de méthode d'accès conforme — §10) ;
  Century 21 écartée (robots.txt interdit les annonces) ; verdicts détaillés
  dans docs/sources.md.
- Les conflits de fusion sont conservés dès 1 € d'écart (§15) ; le score de
  risque n'alerte qu'au-delà de 15 % (loyer) / 10 % (surface).
