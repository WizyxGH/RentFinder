/**
 * Registre des sources et contrat des scrapers (§5, §10, §47, §76).
 *
 * Un scraper est un plugin : il déclare ce qu'il sait faire, reçoit un contexte
 * qui lui impose son budget de requêtes, et rend des annonces brutes. Il n'a
 * accès ni à la base, ni au scoring, ni au système de contact — ce qui garantit
 * qu'une source cassée ne peut pas casser le reste (§69, §76).
 */

import type { IsoDateTime, SourceId } from './provenance.js';
import type { RawListing } from './listing.js';
import type { SearchCriteria } from './criteria.js';

/** Famille de source, utilisée pour le tri et les fréquences par défaut (§7). */
export type SourceKind = 'portal' | 'agencyNetwork' | 'localAgency' | 'aggregator';

/**
 * Manière dont les annonces sont obtenues. Ordre de préférence décroissant :
 * une API officielle est toujours préférée au HTML (§6).
 */
export type CollectionMethod = 'officialApi' | 'rssFeed' | 'sitemap' | 'html';

/**
 * État de santé d'une source (§63, §69).
 *
 * - `healthy`   : dernière exécution réussie.
 * - `degraded`  : parse partiellement cassé ou erreurs répétées, on continue.
 * - `cooldown`  : 429 récent, la source est mise au repos (§10).
 * - `disabled`  : désactivée manuellement ou après échecs graves.
 * - `blocked`   : la source interdit explicitement l'accès automatisé. On
 *                 s'arrête, on ne contourne pas (§10).
 */
export type SourceHealth = 'healthy' | 'degraded' | 'cooldown' | 'disabled' | 'blocked';

/**
 * Budget de requêtes propre à chaque source (§10).
 * Aucune de ces valeurs n'est codée en dur dans un scraper (§7).
 */
export interface RateLimitBudget {
  /** Plafond de requêtes par minute pour cette source. */
  readonly requestsPerMinute: number;
  /** Délai minimal entre deux requêtes, en millisecondes. */
  readonly delayBetweenRequestsMs: number;
  /** Requêtes simultanées autorisées. `1` est le défaut prudent. */
  readonly maxConcurrentRequests: number;
  /** Plafond de pages par exécution — empêche tout parcours exhaustif (§8). */
  readonly maxPagesPerRun: number;
  /** Plafond d'annonces par exécution. */
  readonly maxListingsPerRun: number;
  /** Nombre de tentatives après échec réseau. */
  readonly retryLimit: number;
  /** Multiplicateur du backoff exponentiel entre deux tentatives. */
  readonly backoffFactor: number;
  /** Durée de mise au repos après un HTTP 429, en secondes (§10). */
  readonly cooldownSecondsAfter429: number;
  /** Nombre d'erreurs consécutives au-delà duquel on arrête l'exécution. */
  readonly maxConsecutiveErrors: number;
}

/** Fréquences d'interrogation, exprimées en minutes (§7). */
export interface SourceSchedule {
  /** Intervalle visé quand la source produit régulièrement du neuf. */
  readonly baseIntervalMinutes: number;
  /** Plancher : on n'interroge jamais plus souvent, même très active. */
  readonly minIntervalMinutes: number;
  /** Plafond : on finit toujours par revenir, même si la source dort. */
  readonly maxIntervalMinutes: number;
}

/**
 * Déclaration statique d'une source — la fiche du registre (§5).
 * Ces données sont publiques et versionnées.
 */
export interface SourceDescriptor {
  readonly id: SourceId;
  readonly name: string;
  readonly domain: string;
  readonly kind: SourceKind;
  readonly method: CollectionMethod;

  /** 1 = priorité maximale. Départage les sources quand le temps manque (§7). */
  readonly priority: number;

  readonly schedule: SourceSchedule;
  readonly budget: RateLimitBudget;

  /** `false` désactive la source sans supprimer son code (§5, §76). */
  readonly enabled: boolean;

  /**
   * `true` interdit tout contact automatique via cette source (§23).
   * À utiliser dès que l'automatisation n'est manifestement pas appropriée.
   */
  readonly manualOnly: boolean;

  /**
   * Chemins que le `robots.txt` de la source autorise et sur lesquels le
   * scraper s'appuie. Documenté ici pour que la conformité soit auditable
   * sans relire le code (§10).
   */
  readonly allowedPaths: readonly string[];

  /** Note libre : conditions d'accès, limites connues, points d'attention. */
  readonly notes: string;
}

/**
 * État d'exécution d'une source, mis à jour à chaque run et persisté (§5, §63).
 */
export interface SourceRuntimeState {
  readonly sourceId: SourceId;
  readonly health: SourceHealth;

  readonly lastRunAt: IsoDateTime | null;
  readonly lastSuccessAt: IsoDateTime | null;
  readonly last429At: IsoDateTime | null;
  readonly lastBlockedAt: IsoDateTime | null;
  /** Fin de la mise au repos ; aucune requête n'est émise avant cette date. */
  readonly cooldownUntil: IsoDateTime | null;

  readonly consecutiveErrors: number;
  /** Nouvelles annonces trouvées lors de la dernière exécution — pilote la fréquence (§7). */
  readonly lastNewListingCount: number;
  /** Moyenne glissante des nouvelles annonces, pour lisser les à-coups. */
  readonly averageNewListingCount: number;
}

// ---------------------------------------------------------------------------
// Contrat d'exécution d'un scraper
// ---------------------------------------------------------------------------

/** Réponse HTTP réduite à ce dont un scraper a besoin. */
export interface FetchResult {
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  /** `true` si le serveur a répondu 304 : le contenu n'a pas changé (§30). */
  readonly notModified: boolean;
}

/**
 * Ce que le cœur fournit au scraper. Le scraper n'a pas le droit d'émettre une
 * requête réseau autrement que par `fetch` : c'est ce point de passage unique
 * qui applique le rate limiting, le cache, les en-têtes conditionnels et
 * l'arrêt sur 429 (§10, §30).
 */
export interface ScrapeContext {
  readonly criteria: SearchCriteria;
  /** Mode `live` (nouveautés) ou `backfill` (historique, bridé) — §8. */
  readonly mode: 'live' | 'backfill';

  /**
   * Émet une requête sous contrôle du budget de la source.
   *
   * GET par défaut (avec cache conditionnel ETag). Un `method`/`body` permet
   * d'interroger une API JSON (§6 : une API publique prime sur le HTML) —
   * dans ce cas, pas de cache conditionnel (une réponse POST n'est pas
   * revalidable par ETag).
   */
  readonly fetch: (
    url: string,
    init?: {
      readonly headers?: Record<string, string>;
      readonly method?: 'GET' | 'POST';
      readonly body?: string;
      /**
       * `'manual'` rend la réponse de redirection telle quelle (statut 30x,
       * en-tête `location`) SANS suivre le saut. Permet de résoudre un lien de
       * tracking en URL canonique sans jamais télécharger la page de
       * destination — donc sans accès automatisé au portail visé (§10).
       */
      readonly redirect?: 'follow' | 'manual';
    },
  ) => Promise<FetchResult>;

  /**
   * Vrai si la référence est déjà connue en base. Permet l'arrêt anticipé :
   * le scraper cesse de paginer quand il retombe dans du déjà-vu (§9).
   */
  readonly isKnown: (sourceRef: string) => boolean;

  /** Journalisation structurée, sans secret ni donnée personnelle (§62). */
  readonly log: (event: string, fields?: Record<string, unknown>) => void;

  /** `true` quand le budget est épuisé : le scraper doit s'arrêter proprement. */
  readonly shouldStop: () => boolean;
}

/** Ce qu'un scraper rend au terme d'une exécution. */
export interface ScrapeResult {
  readonly sourceId: SourceId;
  readonly listings: readonly RawListing[];
  /**
   * Références que la source CONFIRME encore publiées sans que leur fiche ait
   * été re-téléchargée. Cas d'usage : une source à sitemap voit toutes ses
   * annonces vivantes dans le sitemap (une requête), mais ne re-visite que les
   * nouvelles (§30). Sans cette confirmation, les annonces connues passeraient
   * à tort en `possiblyInactive` (§32). Optionnel : les scrapers à pagination
   * n'en ont pas besoin.
   */
  readonly confirmedRefs?: readonly string[];
  /**
   * Références que la source affiche comme DÉJÀ LOUÉES/VENDUES (bandeau sur la
   * fiche). Le cœur marque alors ces annonces `rented` : hors liste active,
   * mais conservées pour les favoris et les statistiques (§32, §33).
   */
  readonly rentedRefs?: readonly string[];
  /** Nombre de requêtes HTTP réellement émises — sert au suivi du coût (§62). */
  readonly requestCount: number;
  /** Pages parcourues avant arrêt. */
  readonly pagesFetched: number;
  /** Raison de l'arrêt, journalisée telle quelle (§9, §62). */
  readonly stopReason: StopReason;
  /** Erreurs non fatales rencontrées ; n'empêchent pas de rendre des annonces. */
  readonly warnings: readonly string[];
}

/** Pourquoi une exécution s'est terminée (§9, §10). */
export type StopReason =
  | 'completed'
  | 'knownTerritory'
  | 'maxPages'
  | 'maxListings'
  | 'rateLimited'
  | 'tooManyErrors'
  | 'blocked'
  | 'notModified';

/**
 * Le contrat que tout scraper implémente (§47).
 *
 * Un scraper ne fait QUE collecter et extraire. Il ne normalise pas, ne
 * dédoublonne pas, ne score pas et n'écrit pas en base.
 */
export interface Scraper {
  readonly descriptor: SourceDescriptor;
  /**
   * Exécute une collecte. Ne doit jamais lancer d'exception pour une erreur
   * attendue (page absente, HTML modifié) : la remonter via `warnings` et
   * `stopReason` pour que les autres sources continuent (§69).
   */
  run(context: ScrapeContext): Promise<ScrapeResult>;
}
