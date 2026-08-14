# Scraping — règles et fonctionnement

## Principe directeur

> Maximum d'informations utiles / minimum de requêtes (§6).

Et sa contrepartie éthique :

> Si une source devient hostile ou interdit l'accès automatisé, on **arrête**
> le scraper. On ne contourne jamais un CAPTCHA, une protection anti-bot, un
> rate limit ou un `robots.txt` (§10).

## Ce que le core garantit à votre place

Tout scraper reçoit un `ScrapeContext` ; il n'a **pas le droit** d'appeler
`fetch` global. Le `context.fetch` fourni applique automatiquement :

| Garantie                                                        | Implémentation                                                        | Où                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| User-Agent honnête et identifiable                              | `RentFinderBot/x.y (+url du dépôt)` — jamais un faux navigateur       | `core/http-client.ts`                      |
| Délai minimal entre requêtes + jitter 25 %                      | `RateLimiter.acquire()`                                               | `core/rate-limiter.ts`                     |
| Plafond de requêtes/minute (fenêtre glissante)                  | idem                                                                  | idem                                       |
| Arrêt immédiat sur HTTP 429, sans retry, cooldown persisté      | `RateLimitedError` → la source passe en `cooldown`                    | `core/http-client.ts` + `pipeline.ts`      |
| Arrêt définitif sur 401/403                                     | `BlockedError` → la source passe en `blocked`, plus jamais sollicitée | idem                                       |
| Retry avec backoff exponentiel plafonné (erreurs 5xx seulement) | `backoffDelayMs(attempt)`                                             | `core/rate-limiter.ts`                     |
| Cache conditionnel ETag / If-Modified-Since                     | table `http_cache`, réponse 304 = zéro téléchargement                 | `core/http-client.ts` + `db/repository.ts` |
| Budget de pages et d'annonces par run                           | `maxPagesPerRun`, `maxListingsPerRun` + `context.shouldStop()`        | `core/budgets.ts`                          |

Les budgets par famille de source sont dans `core/budgets.ts` et se surchargent
par source — **jamais** codés en dur dans un scraper (§7, §10).

## Arrêt anticipé (§9)

`context.isKnown(sourceRef)` dit si une référence est déjà en base. La
convention, implémentée dans le scraper Laforêt et à reproduire partout :

```
si (annonces déjà connues / annonces de la page) ≥ 0.8 → STOP
```

On est retombé dans du déjà-vu ; paginer plus loin coûterait des requêtes pour
rien. En mode `live`, une seule page par point d'entrée suffit généralement :
les nouveautés remontent en tête.

## LIVE vs BACKFILL (§8)

- `live` (défaut) : cherche les nouveautés, 1 page par point d'entrée.
- `backfill` : descend volontairement dans l'historique (3 pages max chez
  Laforêt). Il exige **deux** activations simultanées : le drapeau
  `--backfill` **et** `BACKFILL_ENABLED=true`. L'un sans l'autre exécute un
  run live avec un avertissement. Jamais automatique, jamais exhaustif.

## Interdictions absolues

- Télécharger, stocker ou proxyfier des images — seules les **URLs** publiques
  sont conservées (§11). Ne pas télécharger une image « juste pour un hash ».
- Stocker le HTML brut (§27, §30).
- Récupérer une coordonnée masquée derrière une protection (§21).
- Réessayer après un 429 (§10).

## Écrire un scraper — contrat

Voir le mode d'emploi complet dans [contributing.md](contributing.md#ajouter-une-source).
Résumé du contrat (`@rentfinder/shared`) :

```ts
interface Scraper {
  descriptor: SourceDescriptor; // fiche du registre (§5)
  run(context: ScrapeContext): Promise<ScrapeResult>;
}
```

- `run` ne lève **jamais** pour une erreur attendue (page absente, HTML
  changé) : elle la remonte via `warnings` et `stopReason`, afin que les autres
  sources continuent (§69).
- Le parser (`parser.ts`) est une fonction pure `HTML → RawListing[]`, testée
  contre des fixtures locales (§50). Il rend des **chaînes brutes** ; le typage
  est le travail de la normalisation.
- S'ancrer sur ce qui est stable : forme des URLs, unités du texte
  (« €/mois », « m² »), jamais sur des classes CSS générées.

## Surveillance d'une source réelle (§61)

Le parser Laforêt montre le motif : si une page rend des annonces mais
qu'aucune ne contient de prix, il émet un warning « structure probablement
modifiée ». Ces warnings remontent dans `collection_runs.warnings` et la source
passe en `degraded` si elle ne produit plus rien — le tout **sans requête
supplémentaire** : ce sont les exécutions normales qui détectent l'anomalie.

## Diagnostiquer un scraper cassé (§69)

1. Ouvrir la page « Sources » du frontend (ou `GET /api/sources`) : santé,
   dernier succès, erreurs consécutives.
2. Lire le dernier run dans `collection_runs` (stopReason, warnings).
3. Télécharger la page réelle **une fois** (curl avec l'UA du projet), la
   comparer à la fixture.
4. Mettre à jour la fixture (anonymisée) puis le parser, tests d'abord (§60).
5. La suite de non-régression complète doit passer avant de considérer la
   réparation terminée.
