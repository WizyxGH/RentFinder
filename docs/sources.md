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

| Source                          | robots.txt vérifié | Verdict                  | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Laforêt** (laforet.com)       | 2026-08-14         | ✅ **Implémentée**       | Seul `/louer/rechercher?*` est interdit ; les pages `/ville/location-appartement-{ville}-{cp}` et leur pagination sont autorisées. Le site déclare de plus `Allow: /` pour les agents d'IA identifiés (GPTBot, PerplexityBot, AnthropicBot…), signe d'une politique ouverte à l'accès automatisé identifié. Pages SSR facilement parsables, ~30-40 annonces par page couvrant Nice **et** les communes voisines (Cagnes, Beausoleil, Cannes). Excellent rapport information/requête. |
| **Orpi** (orpi.com)             | 2026-08-14         | 🟡 Candidate prioritaire | Interdit `/estate/`, les URLs à paramètres (`orderBy`, `contact`…) et les galeries photos, mais **autorise explicitement** les pages d'annonces filtrées `/annonces-immobilieres-*/fi/N-pieces/` (locations comprises). Sitemap `sitemap-index.xml` disponible. Bon candidat n° 2 : même famille technique que Laforêt (pages listant par ville).                                                                                                                                    |
| **Century 21** (century21.fr)   | 2026-08-14         | 🔴 Écartée               | Les Disallow couvrent les annonces (`location*`, `cp-*`), c'est-à-dire précisément ce qu'on voudrait lire. §10 : on respecte, on n'implémente pas.                                                                                                                                                                                                                                                                                                                                   |
| **Guy Hoquet** (guy-hoquet.com) | 2026-08-14         | 🟠 Prudence              | Bloque nommément ~120 user-agents dont de nombreux outils d'automatisation : politique clairement défensive. Les chemins d'annonces ne sont pas formellement interdits pour `*`, mais l'esprit est hostile à la collecte. Reporter ; réévaluer plus tard.                                                                                                                                                                                                                            |
| **Foncia** (fr.foncia.com)      | 2026-08-14         | 🟡 Candidate             | Disallow ciblés (URLs à paramètres `/*?`, pages avancées, DOM-TOM) ; les pages de location standard ne sont pas interdites, et `?datemaj` est explicitement autorisé — intéressant pour trier par date de mise à jour (§9). Sitemap disponible. À étudier en détail avant implémentation (leur structure Angular/SSR est à vérifier).                                                                                                                                                |
| **Nexity, Square Habitat**      | non vérifié        | ⚪ À étudier             | Vérifier robots.txt + structure avant toute décision.                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Portails

| Source                          | robots.txt vérifié | Verdict                    | Détail                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PAP** (pap.fr)                | 2026-08-14         | 🟡 Candidate (via sitemap) | Interdit toutes les URLs à paramètres (`/*?*`) et les listes filtrées, **mais** publie 9 sitemaps dont `liste_annonces.xml` avec `lastmod` — c'est une méthode d'accès prévue et déclarée (§6). Le mode de collecte pertinent est : lire le sitemap (1 requête), filtrer les URLs de type location/06, ne visiter que les annonces nouvelles. PAP = particuliers, donc contact direct sans agence : forte valeur pour le projet. |
| **Leboncoin** (leboncoin.fr)    | 2026-08-14         | 🔴 Écartée pour le MVP     | `/recherche` et `/api/*` sont interdits ; les pages d'annonces individuelles (`/*/*.html`) sont autorisées mais **inaccessibles sans passer par la recherche**. Protection anti-bot (DataDome) documentée publiquement. Pas de méthode d'accès conforme identifiée à ce jour ; ne pas contourner (§10). Réévaluer si un flux officiel apparaît.                                                                                  |
| **SeLoger** (seloger.com)       | 2026-08-14         | 🔴 Écartée                 | `/classified-search?` interdit, pas de sitemap déclaré, seul Mediapartners-Google est privilégié. Même famille de protection que Leboncoin (groupe AVIV).                                                                                                                                                                                                                                                                        |
| **Logic-Immo** (logic-immo.com) | 2026-08-14         | 🟠 Prudence                | Même groupe que SeLoger. `*/classified-search?*` interdit mais sitemap `sitemap_index.xml` déclaré. À étudier via sitemap uniquement ; faible priorité car recoupe SeLoger.                                                                                                                                                                                                                                                      |
| **Bien'ici** (bienici.com)      | 2026-08-14         | 🟡 Candidate               | `robots.txt` fin : interdit les tris (`*tri=*`) et modes, mais **autorise** `/recherche/*` sans paramètres multiples, et déclare un sitemap. La recherche par ville est faisable en restant dans les chemins autorisés. Site SPA : vérifier si les données sont servies en SSR ou nécessitent l'API (interdite ?). Étude technique requise.                                                                                      |
| **Figaro Immobilier**           | 2026-08-14         | ⚪ Inaccessible à l'étude  | Le domaine refuse nos requêtes d'étude. Reporter.                                                                                                                                                                                                                                                                                                                                                                                |
| **AvendreALouer**               | 2026-08-14         | 🟠 Prudence                | 403 sur `robots.txt` lui-même : protection agressive en périphérie. Reporter.                                                                                                                                                                                                                                                                                                                                                    |
| **MoteurImmo** (moteurimmo.fr)  | 2026-08-14         | 🟠 Cas particulier         | `robots.txt` totalement permissif (`Disallow:` vide). MAIS c'est un agrégateur : collecter un agrégateur produit des données de seconde main (URLs indirectes, fraîcheur dégradée, CGU propres). Utile éventuellement pour la _découverte_ d'agences locales, pas comme source primaire.                                                                                                                                         |

### Agences locales de Nice

Non encore inventoriées individuellement — c'est le prochain travail de fond
(V2, §71). Méthode prévue :

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

## Ordre d'implémentation recommandé

1. **Laforêt** — fait. Sert de source pilote et de référence d'architecture.
2. **Orpi** — même famille (pages ville de réseau), chemins autorisés vérifiés.
3. **PAP via sitemap** — méthode de collecte différente (sitemap → annonces),
   ce qui valide le second mode de collecte du core ; forte valeur (particuliers).
4. **Foncia** — après vérification de la structure des pages.
5. **Bien'ici** — après étude SSR/API.
6. **Adaptateurs d'agences locales** — chantier V2, le plus rentable à terme.

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
