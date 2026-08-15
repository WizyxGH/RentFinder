# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Documenter ici : nouvelles sources, changements d'architecture ou de schéma,
évolutions des scores et du système de contact, corrections importantes (§70).

## [0.11.0] — 2026-08-15

### Ajouté

- **Source BEP Logement — espace abonné (accès payé, §6)** : nouvelle source
  authentifiée `bep-abonnes`. Se connecte avec les identifiants privés de
  l'utilisateur (`.env` : `BEP_SUBSCRIBER_*`, jamais committés) et lit le
  bulletin « Classeurs » — **388 annonces** en 2 requêtes, dont réf, type,
  localisation, surface, loyer (charges comprises), DPE, date de bulletin,
  photos. Inactive proprement si les identifiants sont absents. Filtrée sur
  Nice + critères comme les autres sources (63 à Nice, ~3 dans le budget ≤700 €).
- **Script `capture-bep.mjs`** pour inspecter la structure du bulletin en local.

### Sécurité

- Le scanner de secrets ignore `data/` (captures locales, ignorées par git) —
  évite un faux positif sur les coordonnées d'agences des annonces collectées.
- Test durci : les valeurs `BEP_SUBSCRIBER_*` de `.env.example` doivent rester
  des placeholders (filet contre une saisie dans le mauvais fichier).

## [0.10.0] — 2026-08-15

### Ajouté

- **Filtres réglables depuis l'interface** (§66) : nouvel onglet « Filtres »
  (budget, loyer minimum, surface, exclusions coloc/étudiant). API locale
  `GET`/`PUT /api/config` qui lit/écrit `config/search.json`. Le budget et la
  surface s'appliquent **immédiatement** (filtrage SQL en direct) ; les
  exclusions prennent effet au prochain `pnpm collect`.
- **Filtres prix plancher et location étudiante** : `minPrice` (défaut 250 €,
  écarte les parkings/box mal étiquetés « appartement ») et `excludeStudent`
  (résidences étudiantes / Erasmus / CROUS, sur signaux forts).

## [0.9.0] — 2026-08-15

### Changé — projet désormais 100% local

- **Turso retiré** : la base est un simple fichier SQLite local
  (`data/local.db`) via `@libsql/client` en mode fichier. Plus de compte, plus
  de quota, plus de jeton d'écriture.
- **API Cloudflare Worker supprimée** (`packages/api`) : ses routes portables
  ont été déplacées dans `packages/collector/src/server/routes.ts`, consommées
  par le serveur local (`pnpm local`, 127.0.0.1, sans jeton).
- **Workflows cloud supprimés** : collecte planifiée GitHub Actions et
  déploiement GitHub Pages. La CI (tests) reste.
- `.env` est **chargé automatiquement** par `pnpm collect` et `pnpm local`.
- Documentation entièrement mise à jour (deployment, database, architecture,
  README, privacy, security). L'ancienne architecture cloud reste dans
  l'historique Git.

### Ajouté

- **Distance au lieu de travail** configurable par simple **adresse**
  (`REFERENCE_WORK_ADDRESS`), géocodée via la Base Adresse Nationale.
- Date effective des annonces Apimo (BEP/D'Azur) = plus récente de `datePosted`
  / `dateModified` (convention « mise à jour le… », évite de sur-vieillir une
  annonce rafraîchie).
- Carte de résultats retravaillée (pastille de priorité colorée, prix mis en
  valeur, adresse, pastilles DPE + atouts).
- Fondations de l'accès abonné **BEP payé** (config `.env` + `scripts/capture-bep.mjs`).

## [0.8.0] — 2026-08-15

### Ajouté

- **Plus de données par annonce** : nouvelle **classe énergétique (DPE)** typée
  (alimente aussi le critère `energyClasses`) et **liste d'atouts** affichables
  — étage, ascenseur, balcon, terrasse, jardin, parking, cave, piscine,
  climatisation, meublé, rénové. Extraits des attributs structurés d'Orpi et du
  texte des autres sources, fusionnés (union des sources), affichés en pastilles
  sur la fiche + ligne DPE. Uniquement ce que la source mentionne (§17).
  Validé en réel (DPE + 13 annonces avec atouts).

## [0.7.0] — 2026-08-15

### Ajouté

- **Distance au lieu de travail par géocodage** (§20) : les annonces sans
  coordonnées GPS mais avec une adresse (Foncia, NousGérons, D'Azur…) sont
  géocodées via l'API officielle **Base Adresse Nationale** (gratuite, prévue
  pour l'automatisation — §6), avec cache persistant (`geocode_cache`,
  migration `0004`) : une adresse n'est géocodée qu'une fois (§30). Le lieu de
  travail peut être saisi comme **adresse** (`REFERENCE_WORK_ADDRESS`) ou
  coordonnées. Validé en réel : 52 annonces avec distance travail.
- **Baisses de prix mises en avant** (§17) : l'historique distingue `price-drop`
  de `price-rise`. Une baisse récente (14 j) ajoute un signal d'opportunité
  (+12) et un **badge « Prix en baisse »** vert. Signal factuel, jamais inventé.
- **Filtre parkings / box / garages** : nouveau type de bien `parking`, exclu
  de la liste principale (comme les colocations) — l'utilisateur cherche un
  logement, pas une place de stationnement. Reste consultable en « hors
  critères ».

### Corrigé

- L'empreinte d'une fiche inclut désormais distances et baisse de prix : une
  fiche est réécrite une fois quand ces données dérivées apparaissent (adresse
  enfin géocodée), au lieu de rester figée sur son ancien contenu (§30).

## [0.6.0] — 2026-08-15

### Ajouté

- **Collecte de l'historique** (§31) : nouvelle table `listing_history`
  (migration `0003`). Un instantané daté est écrit à la première observation
  (`baseline`), puis **uniquement** quand le loyer, la surface ou la
  disponibilité changent — jamais à chaque run (§30). Base des futures baisses
  de prix (§17) et de la durée de publication. Validé en réel (16 baselines).

### Documentation

- **Addendum au cahier des charges** (`docs/cahier-des-charges-addendum.md`) :
  retrait officiel de Leboncoin, SeLoger et Bien'ici du périmètre (§3), avec
  justification §6/§10 — ces principes priment sur la liste de sources.

### Vérifié (contre-enquête demandée)

- **123loger** : l'API WordPress (`/wp-json`) n'expose aucun type « annonce » —
  confirmé sans inventaire accessible.
- **studapart** : atteignable via une API Elasticsearch interne
  (`search-api.studapart.com`, POST ES-DSL, non documentée) — jugée trop
  fragile/non officielle pour être implémentée (§6, §75), différée et
  documentée.

## [0.5.1] — 2026-08-15

### Ajouté

- **Bandeau de statistiques** en tête de liste (§33) : pertinentes / à
  contacter / contactées / réponses, d'un coup d'œil, sans page dédiée.

### Vérifié (sources demandées, non retenues faute d'accès conforme)

- **manda.fr** : sitemap = ventes + pages SaaS ; locations en AJAX derrière des
  paramètres interdits. Écartée.
- **123loger.com** : sitemap cassé (1127 fois `/location/`), recherche
  interdite. Écartée.
- **studapart.com** : annonces chargées en AJAX (`itemListElement` vide en
  SSR), sitemap au niveau catégorie. Écartée — obstacle technique, pas
  réglementaire (le robots autorise le crawler générique). Détails dans
  docs/sources.md.

## [0.5.0] — 2026-08-15

### Ajouté

- **Filtre colocation** : nouveau critère `excludeFlatShare` (actif par défaut,
  décision utilisateur) — les colocations sortent de la liste principale mais
  restent collectées et consultables via « hors critères » (§53).
- **Fichier de configuration des filtres** `config/search.json` (+ `config/README.md`) :
  l'utilisateur règle ville, budget, surface, exclusion coloc… sans toucher au
  code (§66). Chargé au démarrage de la collecte, tolérant (JSON invalide →
  défauts + avertissement).
- **Adaptateur générique Apimo/Cello** (`sources/apimo`, §47) : la logique BEP
  a été généralisée en fabrique `makeApimoScraper` ; BEP en est désormais une
  instance, comme **D'Azur Immobilier** (`dazur`, demandée) — ajouter une
  agence Apimo = quelques lignes.
- **Enrichissement par fiche détail** (NousGérons) : les nouvelles annonces
  sont complétées depuis leur fiche (adresse exacte « 42 Bd … », charges
  détaillées, description complète) — « maximum d'informations » demandé (§6 :
  une requête par annonce nouvelle seulement).
- **Extraction d'adresse** depuis le titre des annonces NousGérons.
- Champ `chargesText` dérivé de la description (« Provision pour charges : 50 € »).

### Interface

- **Scores en anneaux de progression circulaires** (SVG inline, demandé).
- **Onglet Sources déplacé en dernier** (Annonces / Profil / Sources).
- Badge et ligne « Colocation » ; relance intégrée au panneau de contact (§34).

### Sources — état

- 7 actives : Laforêt, Orpi, BEP, Foncia, Century 21, NousGérons, D'Azur.
- PAP prête mais désactivée (WAF). Manda, 123loger, Studapart, Guy Hoquet,
  Square Habitat : à l'étude.

## [0.4.0] — 2026-08-15

### Ajouté

- **Source Century 21** (`century21`) : verdict initial « écartée » corrigé après
  relecture du robots.txt — seules les recherches par code postal et par agence
  sont interdites, pas le format par ville (SSR). 19 annonces en 1 requête.
- **Source NousGérons** (`nousgerons`, demandée) : robots.txt ouvert, données
  lues dans le JSON-LD ItemList ; beaucoup de colocations.
- **Champ colocation** (`flatShare`, tri-état §17) de bout en bout : parsing
  (« en colocation » = oui, « colocation possible » = logement entier),
  migration `0002_flat_share`, persistance, fusion, badge sur la carte et
  ligne dans la fiche.
- **Anneaux de progression circulaires** (SVG inline, zéro dépendance) pour les
  4 scores, couleur par plage, chiffre au centre.
- **Refonte UX** : coquille commune avec navigation par onglets persistante
  (Annonces / Sources / Profil), hiérarchie de titres renforcée, section mise
  en avant « 🔥 À contacter maintenant » (priorité ≥ 85) séparée du reste.
- **Relance** dans le panneau de contact (§34) : une annonce déjà contactée
  propose un message de relance bref (`FOLLOW_UP_TEMPLATE`).
- **Test de performance** (§56) : dédoublonnage de 2 000 annonces < 3 s,
  comparaisons bornées bien sous O(n²).
- **Troubleshooting** dans le README (§44).

### Vérifié (revue exhaustive des sources écartées)

- **Century 21** → réhabilitée (ci-dessus). **Nexity** → 403 hostile aux
  clients non-navigateurs, écartée (§10). **Guy Hoquet** → repassée en
  candidate (robots.txt moins hostile qu'estimé), structure à étudier.
  **Square Habitat** → à réétudier. **Logic-Immo, Figaro, AvendreALouer** →
  restent écartées (mêmes protections de groupe / 403).
- **SeLoger / Leboncoin / Bien'ici** restent hors de portée : les scrapers
  open-source existants (Fluximmo, condowatcher, lbcscraper…) sont soit
  obsolètes, soit fondés sur le contournement de DataDome — exactement ce que
  le §10 interdit. Aucune méthode conforme identifiée à ce jour.

## [0.3.0] — 2026-08-15

### Ajouté

- **Source Foncia** (`foncia`) : troisième réseau d'agences — Angular SSR,
  ancrage sur les classes `foncia-card-*`, une requête couvre Nice, et le
  titre des cartes contient l'**adresse complète** du bien (signal de
  dédoublonnage très fort, §14). Première collecte réelle : 15 annonces,
  1 requête, 0 warning.
- **Source PAP** (`pap`) : scraper complet et testé (pages de liste par ville,
  déclarées dans le sitemap officiel ; prix à point de milliers, DPE en classe
  CSS, description avec adresse). **Livrée désactivée** : en collecte réelle,
  le WAF de pap.fr répond 403 aux clients HTTP non-navigateurs même
  honnêtement identifiés (curl 200 / fetch Node 403, même UA et IP). Imiter
  une empreinte de navigateur serait un contournement (§10) — le code reste
  prêt si la politique du site évolue.

### Décisions

- **Bien'ici écartée** : `/recherche/*` est autorisé par le robots.txt mais la
  page est une SPA vide — les données ne passent que par une API interne non
  documentée (§6). Réévaluer si un SSR apparaît.
- Leboncoin et SeLoger restent écartées (aucune méthode d'accès conforme,
  §10) — voir docs/sources.md.

## [0.2.0] — 2026-08-15

### Modifié

- **Critère de surface : minimum relevé de 12 à 14 m²** (décision utilisateur).
  `MVP_CRITERIA.minArea` est la source unique ; les annonces déjà collectées
  sont re-scorées au prochain run de collecte.

### Ajouté

- **Source Orpi** (`orpi`) : deuxième réseau d'agences — robots.txt revérifié
  le 2026-08-15, page ville unique couvrant tous les codes postaux de Nice.
  Première source fournissant les **coordonnées GPS** (signal de dédoublonnage
  très fort, §14) ainsi que quartier, agence, date de création, via l'attribut
  de tracking `data-eulerian-action` traité comme enrichissement fragile — le
  HTML visible fait foi. Le champ JSON `meuble`, contradictoire avec les tags
  affichés, est volontairement ignoré (§17).
- **Source BEP Logement** (`bep`) : première **agence locale** (§3) et première
  source de méthode **sitemap** (§6) — 2 requêtes découvrent toutes les fiches
  avec `lastmod` ; seules les nouvelles des communes cibles sont visitées, les
  connues sont confirmées sans requête via `ScrapeResult.confirmedRefs`
  (nouveau champ du contrat, §32). Fiches lues par JSON-LD schema.org
  (téléphone/e-mail d'agence publiés §21, date de publication, surface),
  HTML en secours.
- **Mode local zéro-cloud** : `pnpm local` sert l'interface et l'API sur
  127.0.0.1 depuis un fichier SQLite créé automatiquement
  (`data/local.db`) quand `TURSO_DATABASE_URL` est absent (hors CI). Les
  routes du Worker sont extraites dans `@rentfinder/api/routes` (portables) et
  réutilisées par le serveur local ; build frontend dédié `--mode selfhost`
  (même origine, pas de jeton — le serveur n'écoute que sur 127.0.0.1).
- Test de dédoublonnage croisé Laforêt × Orpi sur fixtures réelles :
  anti-fusion (veto pièces) et fusion par signal GPS (§53 scénario 2).
- Filtrage des biens non résidentiels (stationnement, local…) au niveau des
  parsers : un parking à 100 €/mois passerait tous les critères MVP.
- `parsePhone` : prise en charge du format « +33-0X… » des JSON-LD Apimo.
- **Interface refaite avec Tailwind CSS v4 + shadcn/ui** (demande utilisateur,
  aligné sur ses autres projets) : thème `light-dark()` sans classes `dark:`,
  composants `Button`/`Card`/`Badge` copiés dans `src/components/ui/`, alias
  `@/` configuré pour `npx shadcn add`. Les éléments `select`/`checkbox`
  restent natifs (§39/§65) et les 44 tests frontend + E2E restent verts.

### Corrigé

- **Les CLI `pnpm collect` / `pnpm db:migrate` ne fonctionnaient pas** :
  `node --experimental-strip-types` ne résout pas les imports `.js` vers des
  sources `.ts`. Ils compilent désormais (`tsc --build`, incrémental) puis
  exécutent `dist/`. Première collecte réelle validée dans la foulée :
  62 annonces (Laforêt 26, Orpi 36), 6 requêtes, 0 warning de parsing.
- Le scraper Orpi dédoublonne ses références entre pages d'un même run (le
  tri de la source bouge entre deux requêtes).
- Config Playwright : `vite preview` écoutait sur `localhost` (résolu IPv6
  sous Windows/Node ≥ 17) tandis que Playwright interrogeait l'IPv4 —
  `--host 127.0.0.1` explicite.

### Sécurité

- Le bundle `dist-local` du mode selfhost est ignoré par git (jamais publié)
  et le serveur local n'écoute que sur 127.0.0.1 — voir `cli/serve.ts`.

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
