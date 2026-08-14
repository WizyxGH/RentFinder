# Scheduler adaptatif

## Pourquoi pas « tout le monde toutes les 10 minutes »

Le §7 l'interdit explicitement, et pour de bonnes raisons : les sources n'ont
ni le même rythme de publication, ni la même tolérance à la charge. Un site
d'agence locale qui publie deux annonces par semaine n'a aucune raison d'être
interrogé toutes les 10 minutes — cela gaspille des minutes GitHub Actions et
use la bienveillance de la source.

## Architecture en deux étages

```
GitHub Actions (cron */20 min)          ← réveil, PAS décision
        ↓
planRun()                               ← décision, par source
        ↓
sources sélectionnées (max 6 par run)
```

Le cron GitHub ne décide de rien : il réveille le scheduler interne, qui
examine chaque source et rend une décision **motivée** (`ScheduleDecision.reason`,
journalisée puis visible dans la page Sources).

## Calcul de l'intervalle effectif

`effectiveInterval()` (`scheduler/scheduler.ts`) part de l'intervalle de base
de la famille et l'adapte :

| Situation                                       | Effet                              |
| ----------------------------------------------- | ---------------------------------- |
| moyenne glissante ≥ 3 nouvelles annonces/run    | intervalle ÷ 2 (borné au plancher) |
| 0 nouvelle annonce et déjà exécutée avec succès | intervalle × 2 (borné au plafond)  |
| n erreurs consécutives                          | intervalle × 2ⁿ (borné au plafond) |

Fréquences de départ par famille (`core/budgets.ts`, configurables — §7) :

| Famille       | base   | plancher | plafond |
| ------------- | ------ | -------- | ------- |
| portal        | 20 min | 10 min   | 3 h     |
| agencyNetwork | 45 min | 30 min   | 6 h     |
| localAgency   | 2 h    | 1 h      | 24 h    |
| aggregator    | 1 h    | 30 min   | 12 h    |

La moyenne glissante (`averageNewListingCount`, pondération 0,7/0,3) lisse les
à-coups : une page exceptionnellement riche ne suffit pas à doubler la cadence.

## Règles d'exclusion (avant tout calcul d'intervalle)

Dans l'ordre :

1. `enabled: false` dans le registre → jamais exécutée (§5).
2. santé `blocked` → jamais exécutée ; la source a refusé l'accès automatisé,
   on ne revient pas frapper à la porte (§10).
3. santé `disabled` → jamais exécutée (désactivation après échecs graves).
4. `cooldownUntil` dans le futur → attendre la fin du repos post-429.

## Quota par run et équité

`maxSourcesPerRun` (6 par défaut) borne la durée du job GitHub Actions (§29,
§30). Les sources éligibles sont triées par priorité croissante **puis par
ancienneté d'exécution** : une source de priorité 3 finit toujours par passer,
même si des priorités 1 sont éligibles à chaque tick. Les reportées reçoivent
la raison explicite « quota de sources par run atteint ».

## Tester une modification du scheduler

Toutes les décisions sont des fonctions pures de
`(descriptor, state, nowMs)` — aucun accès réseau ni base. Les tests dans
`scheduler/scheduler.test.ts` couvrent chaque règle ; en ajouter une = ajouter
son test (§49.1).
