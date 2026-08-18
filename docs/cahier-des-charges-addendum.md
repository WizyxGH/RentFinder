# Addendum au cahier des charges

Ce document **corrige** le cahier des charges initial à la lumière de l'étude
technique réelle des sources (§43, §6, §10). Il fait foi en cas de divergence
avec la liste de sources citée au §3.

## Portails retirés du périmètre : Leboncoin, SeLoger, Bien'ici

Le §3 citait Leboncoin, SeLoger et Bien'ici parmi les plateformes visées. Après
vérification (2026-08-15), **ces trois portails sont retirés du périmètre** :
aucune méthode d'accès conforme n'existe, et le §6 (« méthode prévue pour
l'automatisation ») et le §10 (« ne jamais contourner les protections ») —
principes qui priment sur la liste de sources — l'interdisent.

| Portail       | Constat                                                                                                  | Pourquoi c'est rédhibitoire                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Leboncoin** | `/recherche` et `/api/*` interdits par robots.txt ; protection anti-bot DataDome sur les fiches.         | Y accéder exige d'imiter un navigateur / contourner DataDome → viole le §10.                     |
| **SeLoger**   | `/classified-search?` interdit, pas de sitemap d'annonces, protections groupe AVIV.                      | Idem : pas d'accès conforme, contournement requis → §10.                                         |
| **Bien'ici**  | `/recherche/*` autorisé par robots, mais la page est une SPA vide (données via API interne non publiée). | Pas de « méthode prévue pour l'automatisation » (§6) ; l'API interne n'est pas un flux officiel. |

Les scrapers open-source qui « fonctionnent » pour ces sites (Fluximmo,
condowatcher, lbcscraper…) reposent tous sur le contournement de DataDome
(proxies tournants, empreintes de navigateur) : incompatibles avec le §10.

**Conséquence produit** : la couverture repose sur les réseaux d'agences et les
agences locales (Laforêt, Orpi, Century 21, Foncia, BEP, D'Azur, NousGérons…),
qui publient souvent les mêmes biens **et** des biens exclusifs (§3). C'est
cohérent avec l'objectif « ne pas dépendre uniquement des grands portails ».

## Autres sources demandées et écartées

| Source       | Constat                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PAP**      | Pages autorisées et déclarées au sitemap, mais WAF renvoyant 403 aux clients HTTP non-navigateurs. Scraper écrit, livré **désactivé** (réactivable si la politique change). |
| **Nexity**   | 403 hostile aux non-navigateurs.                                                                                                                                            |
| **manda.fr** | Sitemap = ventes + pages SaaS ; locations en AJAX derrière paramètres interdits.                                                                                            |
| **123loger** | Sitemap cassé (1127× `/location/`) ; WordPress sans type de contenu « annonce » ; recherche interdite. Aucun inventaire accessible.                                         |

**Studapart** (initialement différée) a finalement été **implémentée** le
2026-08-18 : son API de recherche est publique et son usage conforme
(`Content-Signal: search=yes, use=reference`, hôte sans robots). Voir
[sources.md](sources.md).

Détail complet et daté : [sources.md](sources.md).

## Principe réaffirmé

La liste de sources du §3 est une **cible**, pas un engagement : une source n'y
entre que si elle offre un accès **conforme et stable**. Mieux vaut moins de
sources fiables qu'un scraper fragile ou contournant une protection. Ce choix
est conforme à la conclusion du §78 : « la stabilité, la maintenabilité et la
qualité des données sont prioritaires sur la quantité de scraping ».
