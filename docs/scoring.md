# Scoring

Quatre scores sur 100, calculés par `scoring/` pour chaque logement agrégé.
Trois règles transverses, non négociables :

1. **Jamais de donnée inventée** (§17). Un signal absent ne contribue pas et
   figure dans `unknownSignals`. L'interface marque ces scores d'un astérisque
   « calculé sans : … ».
2. **Toujours explicable** (§19). Chaque score rend ses `reasons[]` (code
   stable + libellé + delta), affichées telles quelles dans la fiche.
3. **Confiance affichée**. `confidence ∈ [0,1]` décroît avec chaque signal
   manquant — un score complet et un score calculé sur trois miettes ne se
   présentent pas pareil.

## MATCH — « correspond-il à mes critères ? » (§16)

Critères MVP : ville ∈ {nice}, loyer ≤ 700 €, surface ≥ 14 m² (12 m² à
l'origine, relevé le 2026-08-15). Source unique : `MVP_CRITERIA` dans
`packages/shared/src/criteria.ts` — les docs peuvent dater, le code fait foi.

- Les trois critères actifs sont **éliminatoires** : une violation met
  `matchesCriteria = false` — l'annonce reste collectée et consultable, mais
  sort de la liste principale (§53 scénario 3).
- En deçà des seuils, le score module : loyer plus bas sous le plafond → plus
  de points ; surface au-delà du minimum → bonus dégressif.
- **Un critère inconnu n'élimine pas** : surface non publiée ≠ surface trop
  petite. Le score est rapporté au total réellement évaluable.
- Extension : les critères optionnels (`propertyTypes`, `furnished`…) du type
  `SearchCriteria` sont déjà branchés ; en activer un = le renseigner dans la
  config, aucune modification de structure (§2).

## OPPORTUNITY — « dois-je agir maintenant ? » (§17)

| Facteur                                                   | Poids max |
| --------------------------------------------------------- | --------- |
| Fraîcheur (paliers : < 15 min = 50 pts … < 1 sem = 5 pts) | 50        |
| Téléphone disponible                                      | 20        |
| E-mail disponible                                         | 10        |
| Multi-diffusion (concurrence probable → agir vite)        | 10        |
| Vues/h élevées, favoris — **uniquement si publiés**       | 10 + 5    |

Si la source ne donne pas `publishedAt`, la date de première observation sert
de borne honnête, à 70 % des points, et l'écart est déclaré (« date de
publication non fournie »). Favoris absents = inconnus, jamais zéro.

## VISIT PROBABILITY — « mon contact aboutira-t-il ? » (§18)

**Avertissement méthodologique**, repris dans l'interface : ce score n'est PAS
une probabilité statistique. C'est un indice à base de règles explicites,
utile pour **comparer** les annonces entre elles, pas pour prédire « 84 % de
chances ». Il ne prétend à aucune précision qui n'existe pas.

Base neutre 40, puis : délai depuis publication (contact dans l'heure : +25 ;
annonce de > 3 jours : −20), canal disponible (téléphone +20, e-mail +10,
formulaire +3, rien −15), nature du bailleur, concurrence multi-portails (−10).

Le paramètre `observedStats.visitRateBySource` est prévu pour la V2 : quand le
journal des contacts (§33) aura accumulé des résultats réels, les taux
constatés corrigeront les règles — sans les écraser tant que l'échantillon est
petit.

## RISK — « cette annonce est-elle suspecte ? » (§19)

Voir le détail dans [risk-detection.md](risk-detection.md). L'essentiel :

- **jamais bloquant** — une annonce risquée reste visible avec ses raisons ;
- loyer/m² comparé à une référence configurable (20 €/m² pour Nice, hypothèse
  de travail assumée, pas un prix de marché constaté) ;
- incohérences internes (4 pièces pour 20 m²), contradictions **significatives**
  entre sources (> 15 % loyer, > 10 % surface), identité invérifiable,
  formulations d'arnaque classiques.

## Priorité d'action (tri de la liste, §36)

```
priorité = 0,30·match + 0,35·opportunity + 0,25·visitProbability + 0,10·(100 − risk)
```

L'opportunité pèse le plus lourd : sur un marché tendu, la question de
l'interface est « que dois-je contacter _maintenant_ ? », pas « quelle est la
meilleure affaire dans l'absolu ». Poids volontairement simples et lisibles ;
ils seront réévalués sur données réelles en V3 (§71), pas avant.

## Faire évoluer un score

1. Ajouter la règle avec un `code` stable et un libellé affichable.
2. Si le signal peut manquer : le déclarer dans `unknownSignals`, ajuster
   `confidence`.
3. Ajouter les tests (nominal + signal absent) dans `scoring.test.ts`.
4. Documenter le changement ici et dans le CHANGELOG (§70).
