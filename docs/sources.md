# Étude des sources — Nice

Ce document est l'inventaire prévu au §43 du cahier des charges : avant de coder
des scrapers, identifier les sources réellement pertinentes pour Nice et les
classer. Il est le **préalable obligatoire** à tout nouveau scraper — on n'ajoute
pas une source qui n'a pas sa fiche ici.

Les observations `robots.txt` datées ci-dessous ont été faites le **2026-08-14**.
Un `robots.txt` peut changer à tout moment : **revérifier avant d'implémenter**,
et noter la date de vérification dans le descripteur de la source
(`SourceDescriptor.notes`).

## Principes de sélection (rappel)

- Une API publique ou un flux officiel est toujours préféré au HTML (§6).
- Une source qui interdit l'accès automatisé n'est **pas** collectée — on
  n'implémente pas de contournement, quelle que soit sa valeur (§10).
- Le classement privilégie : couverture locale / pertinence / coût de collecte /
  simplicité / stabilité (§43).
- Les agences locales sont une priorité stratégique : leurs annonces sont
  parfois absentes des grands portails (§3).

## État des vérifications

### Réseaux d'agences

| Source                          | robots.txt vérifié | Verdict                       | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Laforêt** (laforet.com)       | 2026-08-14         | ✅ **Implémentée**            | Seul `/louer/rechercher?*` est interdit ; les pages `/ville/location-appartement-{ville}-{cp}` et leur pagination sont autorisées. Le site déclare de plus `Allow: /` pour les agents d'IA identifiés (GPTBot, PerplexityBot, AnthropicBot…), signe d'une politique ouverte à l'accès automatisé identifié. Pages SSR facilement parsables, ~30-40 annonces par page couvrant Nice **et** les communes voisines (Cagnes, Beausoleil, Cannes). Excellent rapport information/requête.                                                                             |
| **Orpi** (orpi.com)             | 2026-08-15         | ✅ **Implémentée**            | `/recherche/*` et les URLs à paramètres (`agency=`, `contact=`, `orderBy=`…) sont interdits ; la page ville `/location-immobiliere-nice/` et sa pagination `?page=N` ne le sont pas. Cartes très riches : prix, surface, pièces, agence, quartier, date de création et **coordonnées GPS** (attribut de tracking `data-eulerian-action`, traité comme enrichissement fragile — le HTML visible fait foi). ~15 annonces/page couvrant tous les codes postaux de Nice en une requête. Première collecte réelle le 2026-08-15 : 36 annonces, 2 requêtes, 0 warning. |
| **Century 21** (century21.fr)   | 2026-08-15         | ✅ **Implémentée**            | Verdict initial « écartée » CORRIGÉ après relecture : seules les recherches par code postal (`cp-…`) et par agence sont interdites — le format par ville `/annonces/location-appartement/v-nice/` ne l'est pas, s'affiche en SSR (`meta robots: index`) et couvre tout le stock en une requête. Première collecte réelle le 2026-08-15 : 19 annonces, 1 requête, 0 warning.                                                                                                                                                                                      |
| **Guy Hoquet** (guy-hoquet.com) | 2026-08-15         | 🟠 Candidate — travail requis | robots.txt n'interdit que des endpoints techniques (le bot générique passe). MAIS les annonces sont éparpillées sur 18+ sous-sitemaps « requêtes-métiers » (Nice absent du principal, 45 000 URLs) et la page `/biens/result` semble exiger des paramètres. Implémentable mais demande de localiser l'URL SEO Nice et de vérifier qu'elle n'est pas sous paramètres restreints. Reporté.                                                                                                                                                                         |
| **Foncia** (fr.foncia.com)      | 2026-08-15         | ✅ **Implémentée**            | Disallow ciblés (URLs à paramètres `/*?` sauf `?datemaj`) ; les pages `/location/{ville}/{type}` ne sont pas interdites. Angular **SSR** : ancrage sur les classes `foncia-card-*` (jamais les attributs générés `_ngcontent-*`). Une page ≈ tout Nice en une requête, **avec l'adresse complète du bien dans le titre** — signal de dédoublonnage très fort (§14). Pagination à paramètres interdite → non utilisée. Première collecte réelle le 2026-08-15 : 15 annonces, 1 requête, 0 warning.                                                                |
| **Nexity** (nexity.fr)          | 2026-08-15         | 🔴 Écartée                    | HTTP 403 dès `robots.txt` pour un client HTTP identifié : hostile aux non-navigateurs (§10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Portails

| Source                          | robots.txt vérifié | Verdict                            | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PAP** (pap.fr)                | 2026-08-15         | 🟠 **Implémentée mais DÉSACTIVÉE** | robots.txt : `/*?*` et `/recherche/*` interdits, mais les pages `/annonce/locations-{ville}-g{id}` sont autorisées ET déclarées dans le sitemap `liste_annonces.xml`. Scraper complet écrit et testé (cartes riches : prix, pièces, chambres, surface, DPE, description). **MAIS** en collecte réelle, le WAF répond 403 aux clients HTTP non-navigateurs, même honnêtement identifiés (vérifié : curl 200 / fetch Node 403, même UA et même IP → filtrage d'empreinte client). Imiter un navigateur serait un contournement (§10) → `enabled: false`. Réévaluer périodiquement. |
| **Leboncoin** (leboncoin.fr)    | 2026-08-14         | 🔴 Écartée pour le MVP             | `/recherche` et `/api/*` sont interdits ; les pages d'annonces individuelles (`/*/*.html`) sont autorisées mais **inaccessibles sans passer par la recherche**. Protection anti-bot (DataDome) documentée publiquement. Pas de méthode d'accès conforme identifiée à ce jour ; ne pas contourner (§10). Réévaluer si un flux officiel apparaît.                                                                                                                                                                                                                                  |
| **SeLoger** (seloger.com)       | 2026-08-14         | 🔴 Écartée                         | `/classified-search?` interdit, pas de sitemap déclaré, seul Mediapartners-Google est privilégié. Même famille de protection que Leboncoin (groupe AVIV).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Logic-Immo** (logic-immo.com) | 2026-08-14         | 🟠 Prudence                        | Même groupe que SeLoger. `*/classified-search?*` interdit mais sitemap `sitemap_index.xml` déclaré. À étudier via sitemap uniquement ; faible priorité car recoupe SeLoger.                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Bien'ici** (bienici.com)      | 2026-08-15         | 🔴 Écartée (SPA)                   | Le robots.txt autorise `/recherche/*` sans paramètres, mais la page servie est une **SPA vide** (15 Ko, 0 annonce dans le HTML) : les données ne viennent que d'appels JavaScript vers une API interne non documentée. L'exploiter ne serait pas une « méthode d'accès prévue » (§6), et un navigateur headless serait coûteux et fragile. Réévaluer si un SSR ou un flux officiel apparaît.                                                                                                                                                                                     |
| **Figaro Immobilier**           | 2026-08-14         | ⚪ Inaccessible à l'étude          | Le domaine refuse nos requêtes d'étude. Reporter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **AvendreALouer**               | 2026-08-14         | 🟠 Prudence                        | 403 sur `robots.txt` lui-même : protection agressive en périphérie. Reporter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **MoteurImmo** (moteurimmo.fr)  | 2026-08-14         | 🟠 Cas particulier                 | `robots.txt` totalement permissif (`Disallow:` vide). MAIS c'est un agrégateur : collecter un agrégateur produit des données de seconde main (URLs indirectes, fraîcheur dégradée, CGU propres). Utile éventuellement pour la _découverte_ d'agences locales, pas comme source primaire.                                                                                                                                                                                                                                                                                         |

### Agences locales

| Source                              | robots.txt vérifié | Verdict            | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BEP Logement** (bep-logement.com) | 2026-08-15         | ✅ **Implémentée** | Agence Antibes/Nice (plateforme Cello/Apimo), demandée explicitement. robots.txt permissif (seul `/app_dev.php` interdit) + sitemap déclaré : collecte par **sitemap** (2 requêtes découvrent ~780 fiches avec `lastmod` ; seules les fiches nouvelles des communes cibles sont visitées, ~8/run max ; les connues sont confirmées via le sitemap sans requête). Fiches avec JSON-LD schema.org complet : téléphone + e-mail d'agence, date de publication, surface, pièces. Communes cibles : Nice et continuité urbaine (liste dans le descripteur). Première source de méthode `sitemap` — valide le second mode de collecte du core. |

### Autres agences locales de Nice

Non encore inventoriées individuellement — travail de fond continu. Méthode :

1. Recenser les agences niçoises indépendantes (annuaire FNAIM, cartes, pages
   « agences » des réseaux) et noter l'URL de leur site.
2. Identifier la **plateforme technique** de chaque site. La majorité des sites
   d'agences françaises sont générés par une poignée de prestataires
   (Ubiflow, Apimo, Hektor/La Boîte Immo, Netty, WebGenery…). Un seul adaptateur
   générique par plateforme couvre alors des dizaines d'agences (§5, §47).
3. Vérifier robots.txt + CGU de chaque site avant activation.
4. Configurer chaque agence comme une _instance_ de l'adaptateur : domaine,
   chemin de recherche, budget `localAgency` (1 page, 4 s de délai, 1-4 h
   d'intervalle — §7).

### Square Habitat

| Source                                | Vérifié    | Verdict    | Détail                                                                                                                                                                                                                                     |
| ------------------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Square Habitat** (squarehabitat.fr) | 2026-08-15 | 🔴 Écartée | Le `robots.txt` interdit précisément les pages de résultats et de fiches location : `/resultat-location`, `/resultats-agence` et `/sh-*/louer-appartement-*.aspx`. Les annonces qu'on voudrait lire sont donc hors d'accès conforme (§10). |

### Sources demandées mais NON retenues (accès non conforme)

Étudiées à la demande de l'utilisateur ; aucune ne viole le §10 (on ne
contourne rien), mais aucune n'offre d'accès conforme aux annonces de Nice.

| Source            | Vérifié    | Verdict    | Détail                                                                                                                                                                                                                                                                  |
| ----------------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **manda.fr**      | 2026-08-15 | 🔴 Écartée | Gestion locative / estimation. Le sitemap ne contient que des annonces de **vente** et des pages SaaS ; les locations passent par `/location-immobiliere?…` (paramètres interdits par robots.txt) et sont chargées en AJAX. Pas de liste de locations Nice exploitable. |
| **123loger.com**  | 2026-08-15 | 🔴 Écartée | Location entre particuliers (WordPress). Sitemap **cassé** : 1127 entrées identiques `/location/` (aucune fiche individuelle) ; la recherche `/search/` est interdite. Inventaire non explorable.                                                                       |
| **studapart.com** | 2026-08-15 | 🔴 Écartée | Logement étudiant. La page ville rend le compte (« 122 offres ») mais `itemListElement` est **vide** : les annonces sont chargées en AJAX, le sitemap Drupal ne descend qu'au niveau catégorie. Pas d'accès conforme par fiche. Réévaluer si un flux/SSR apparaît.      |

Note studapart : son `robots.txt` autorise le crawler générique (`Content-Signal: search=yes, use=reference`) et n'exclut que les bots d'entraînement d'IA ; l'obstacle est purement technique (AJAX), pas réglementaire.

## Ordre d'implémentation recommandé

1. **Laforêt** — fait. Sert de source pilote et de référence d'architecture.
2. **Orpi** — fait (2026-08-15). Première source avec GPS : signal de
   dédoublonnage très fort.
3. **BEP Logement** — fait (2026-08-15). Première agence locale et première
   source `sitemap` ; les deux modes de collecte du core sont validés.
4. **Foncia** — fait (2026-08-15). Adresse complète dans les cartes.
5. **PAP** — implémentée mais désactivée (WAF anti-client-HTTP, voir tableau).
6. **Adaptateurs d'agences locales** (Apimo/Cello, Ubiflow, Hektor…) — le
   parser BEP est le premier candidat à généraliser (§47) ; prochain chantier
   le plus rentable.

## Fiche à remplir pour toute nouvelle source

```
Source            :
URL               :
Type              : portal | agencyNetwork | localAgency | aggregator
robots.txt vérifié le :
Chemins autorisés utilisés :
Méthode           : officialApi | rssFeed | sitemap | html
Volume estimé (annonces pertinentes Nice) :
Fraîcheur (délai de publication constaté) :
Difficulté technique :
Risque de blocage :
Priorité          :
manualOnly        : oui | non (§23)
```
