/**
 * Accès aux données (§27, §30).
 *
 * Toute la discipline d'économie d'écritures est concentrée ici :
 *
 *   - chaque ligne porte un `content_hash` calculé sur ses champs métier ;
 *   - avant d'écrire, on compare ; si rien n'a changé, on n'écrit pas ;
 *   - `last_seen_at` seul est rafraîchi pour une annonce inchangée, en lot ;
 *   - les écritures partent groupées plutôt qu'une par annonce.
 *
 * C'est ce qui permet de rester dans le free tier Turso avec plusieurs runs
 * par heure.
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  MessageListing,
  NormalizedListing,
  ScoredListing,
  SourceId,
  SourceRuntimeState,
} from '@rentfinder/shared';
import { CURRENT_USER } from '@rentfinder/shared';
import { actionPriority } from '@rentfinder/shared';
import type { InValue } from '@libsql/client';
import type { Database } from './client.js';
import type { CacheEntry, HttpCacheStore } from '../core/http-client.js';
import type { GeocodeCacheStore } from '../core/geocode.js';
import type { TransitCacheStore } from '../core/transit.js';

/** Instruction SQL prête pour `db.batch`. */
type Statement = { sql: string; args: InValue[] };

/** État antérieur minimal d'une occurrence, pour la détection de changement. */
interface PreviousOccurrence {
  readonly hash: string;
  readonly firstSeenAt: string;
  readonly price: number | null;
  readonly area: number | null;
  readonly availableAt: string | null;
}

/**
 * Construit l'instruction d'historique (§31), ou `null` s'il n'y a rien à
 * consigner (annonce connue dont ni loyer, ni surface, ni disponibilité n'ont
 * changé). À la première observation, une ligne « baseline » fixe le point de
 * départ de la trajectoire.
 */
function historyStatement(
  listing: NormalizedListing,
  previous: PreviousOccurrence | undefined,
): Statement | null {
  let change: string;
  if (previous === undefined) {
    change = 'baseline';
  } else {
    const changed: string[] = [];
    if (previous.price !== listing.price) {
      // Distinguer baisse et hausse : une baisse est un signal d'opportunité
      // (§17), directement requêtable pour la mise en avant.
      const bothKnown = previous.price !== null && listing.price !== null;
      changed.push(bothKnown && listing.price < previous.price ? 'price-drop' : 'price-rise');
    }
    if (previous.area !== listing.area) changed.push('area');
    if (previous.availableAt !== listing.availableAt) changed.push('availability');
    if (changed.length === 0) return null;
    change = changed.length === 1 ? (changed[0] as string) : 'multiple';
  }

  return {
    sql: `INSERT INTO listing_history
            (id, occurrence_id, source_id, source_ref, price, area, available_at, change, recorded_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      randomUUID(),
      listing.id,
      listing.sourceId,
      listing.sourceRef,
      listing.price,
      listing.area,
      listing.availableAt,
      change,
      listing.scrapedAt,
    ],
  };
}

/** Empreinte stable des champs métier d'une occurrence. */
export function occurrenceHash(listing: NormalizedListing): string {
  // Volontairement limité aux champs dont un changement mérite une écriture :
  // `lastSeenAt` et `scrapedAt` en sont exclus, sans quoi tout changerait à
  // chaque run et l'optimisation n'aurait plus aucun effet.
  const material = JSON.stringify([
    listing.title,
    listing.description,
    listing.price,
    listing.charges,
    listing.area,
    listing.rooms,
    listing.propertyType,
    listing.furnished,
    listing.flatShare,
    listing.dpe,
    listing.maxOccupants,
    listing.features,
    listing.address,
    listing.city,
    listing.postalCode,
    listing.latitude,
    listing.longitude,
    listing.contact.phone,
    listing.contact.email,
    listing.contact.agencyName,
    listing.publishedAt,
    listing.availableAt,
    listing.imageUrls,
  ]);
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/** Empreinte d'une fiche agrégée et scorée. */
export function listingHash(listing: ScoredListing): string {
  const material = JSON.stringify([
    listing.price.value,
    listing.area.value,
    listing.rooms.value,
    listing.city.value,
    listing.title.value,
    listing.lifecycle,
    listing.tracking,
    listing.occurrences.map((o) => o.id).sort(),
    listing.scores.match.value,
    listing.scores.opportunity.value,
    listing.scores.visitProbability.value,
    listing.scores.risk.value,
    // Distances et baisse de prix : données dérivées affichées. Les inclure
    // garantit qu'une fiche est réécrite une fois quand elles apparaissent
    // (ex. adresse enfin géocodée), sans churn ensuite car elles sont stables.
    listing.distances.map((d) => `${d.label}:${d.durationMinutes}`).sort(),
    listing.priceDropped,
    // Contenu du payload affiché : sans ces champs dans le hash, une fiche
    // dont les photos, le DPE ou la description apparaissent après coup ne
    // serait JAMAIS réécrite (l'économie d'écriture § 30 deviendrait une perte
    // de données). Champs stables entre deux collectes → pas de churn.
    //
    // LA LISTE ÉTAIT INCOMPLÈTE, et le manque coûtait. Le montant des charges a
    // été retrouvé sur 131 occurrences en relisant leur description ; il n'a
    // atteint que 44 fiches, parce qu'il ne figurait pas ici — la fiche était
    // jugée « inchangée » et jamais réécrite. Même chose pour la colocation, le
    // quartier, le meublé, la disponibilité et le téléphone : tous s'affichent,
    // tous peuvent apparaître après coup. La règle est simple — CE QUI
    // S'AFFICHE DOIT ÊTRE DANS LE HASH.
    listing.imageUrls.length,
    listing.imageUrls[0] ?? null,
    listing.dpe.value,
    listing.maxOccupants.value,
    listing.features,
    listing.description.value,
    listing.charges.value,
    listing.flatShare.value,
    listing.furnished.value,
    listing.district.value,
    listing.availableAt.value,
    listing.contact.phone,
    // Coordonnées : sans elles dans le hash, une fiche enfin géocodée ne serait
    // jamais réécrite → absente de la vue carte (§ 30 vs perte de données).
    listing.latitude.value,
    listing.longitude.value,
    listing.address.value,
  ]);
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

const boolToInt = (value: boolean | null): number | null => (value === null ? null : value ? 1 : 0);

export interface UpsertReport {
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  /** Fiches orphelines supprimées après fusion — absent si aucune. */
  readonly removed?: number;
}

/** Un point de l'historique de l'inventaire (§33). */
export interface DailyStat {
  readonly day: string;
  readonly matching: number;
  readonly uncertain: number;
  readonly rented: number;
  readonly total: number;
  readonly activeSources: number;
}

export interface Repository {
  /**
   * Fait vieillir les annonces d'une source qui ne les re-liste jamais (§32).
   * Le temps écoulé remplace le décompte d'absences, qui n'a pas de sens ici.
   */
  readonly expireByAge: (
    sourceId: string,
    thresholds: { possiblyInactiveAfterDays: number; inactiveAfterDays: number },
  ) => Promise<void>;

  /** Combien d'occurrences vivantes cette source compte aujourd'hui. */
  readonly activeOccurrenceCount: (sourceId: string) => Promise<number>;

  /** Abonnements Web Push actifs (§29). */
  readonly pushSubscriptions: () => Promise<
    readonly { endpoint: string; p256dh: string; auth: string }[]
  >;
  /** Retire un abonnement périmé — le service de push l'a déclaré mort. */
  readonly removePushSubscription: (endpoint: string) => Promise<void>;

  /** Écrit l'instantané du jour (une ligne par jour, réécrite à chaque passage). */
  readonly recordDailyStat: () => Promise<void>;
  /** Historique de l'inventaire, du plus ancien au plus récent. */
  readonly dailyStats: (limit?: number) => Promise<readonly DailyStat[]>;

  /** Références déjà connues pour une source — alimente l'arrêt anticipé (§9). */
  knownRefs(sourceId: SourceId): Promise<Set<string>>;
  upsertOccurrences(listings: readonly NormalizedListing[]): Promise<UpsertReport>;
  allActiveOccurrences(): Promise<NormalizedListing[]>;
  /**
   * Rattrape les fiches ORPHELINES qu'une fusion passée a laissées derrière
   * elle (§14).
   *
   * La purge de `saveListings` épargne toute fiche portant une décision de
   * l'utilisateur — un favori, un archivage, un « contactée ». C'est la bonne
   * règle : elle ne peut pas savoir si cette décision a été recopiée ailleurs.
   * Résultat, une fiche fusionnée AVANT que le transfert d'état n'existe reste
   * en base et s'affiche en doublon.
   *
   * On retrouve ici sa remplaçante par les occurrences que sa charge utile
   * énumère, on lui transmet la décision, puis on supprime la ligne morte. Une
   * orpheline dont les occurrences se sont dispersées sur plusieurs fiches est
   * laissée telle quelle : on ne saurait pas à qui attribuer la décision (§17).
   *
   * @returns le nombre de fiches absorbées.
   */
  absorbOrphanListings(): Promise<number>;
  /**
   * Réaligne l'identifiant des occurrences sur leur clé naturelle
   * `source_id:source_ref` (§68 — rattrapage).
   *
   * Un changement passé du schéma de référence des alertes e-mail a laissé des
   * lignes dont l'`id` porte l'ancienne forme alors que `source_ref` porte la
   * nouvelle. Toute re-collecte de ces annonces échouait alors sur la
   * contrainte d'unicité `(source_id, source_ref)`.
   *
   * Ne touche jamais une ligne dont l'identifiant cible est déjà pris. Le cas
   * est hors d'atteinte tant que `UNIQUE (source_id, source_ref)` tient — d'où
   * l'absence de test dédié — mais la garde coûte une sous-requête et évite
   * qu'un rattrapage écrase une annonce.
   *
   * @returns le nombre d'identifiants réalignés.
   */
  realignOccurrenceIds(): Promise<number>;
  /**
   * Réécrit les champs DÉRIVÉS DU TEXTE d'occurrences déjà en base — adresse et
   * atouts (voir `rederiveFromText`). Sert au rattrapage quand l'extraction
   * s'améliore.
   *
   * Volontairement distinct d'`upsertOccurrences`, qui remet `lifecycle` à
   * `active` et `missing_runs` à zéro : un rattrapage ne doit RESSUSCITER
   * aucune annonce disparue de sa source (§32).
   *
   * @returns le nombre d'occurrences réécrites.
   */
  updateDerivedFields(occurrences: readonly NormalizedListing[]): Promise<number>;
  /** Ids d'occurrences avec une baisse de loyer depuis `sinceIso` (§17, §31). */
  recentPriceDropIds(sinceIso: string): Promise<Set<string>>;
  saveListings(listings: readonly ScoredListing[]): Promise<UpsertReport>;
  /**
   * Marque « loué » les fiches contenant une occurrence `sourceId:ref`.
   * @returns le nombre de fiches effectivement marquées.
   */
  markRented(sourceId: SourceId, refs: readonly string[]): Promise<number>;
  loadSourceState(sourceId: SourceId): Promise<SourceRuntimeState>;
  saveSourceState(state: SourceRuntimeState): Promise<void>;
  recordRun(entry: CollectionRunRecord): Promise<void>;
  /**
   * Élague les journaux : traces d'exécution, historique des changements,
   * événements. Rend le nombre de lignes supprimées.
   */
  pruneLogs(nowMs: number): Promise<number>;

  /** Incrémente le compteur d'absence et fait évoluer le cycle de vie (§32). */
  markMissing(
    sourceId: SourceId,
    seenRefs: ReadonlySet<string>,
    thresholds: LifecycleThresholds,
  ): Promise<void>;
  /**
   * Annonces à signaler : dans les critères, actives, jamais notifiées, et de
   * priorité suffisante (§29). Triées par priorité décroissante.
   */
  pendingNotifications(minPriority: number): Promise<NotifiableListing[]>;
  /**
   * Clés `prix|surface|ville|pièces` des annonces actives issues UNIQUEMENT de
   * sources directes (agences), jamais des alertes e-mail. Sert à taire la
   * notification d'une annonce e-mail dont un équivalent direct — meilleur
   * (téléphone, lien direct, frais) — existe déjà (§29). L'annonce e-mail reste
   * visible sur le site : seule sa notification est supprimée.
   */
  directListingSpecKeys(): Promise<ReadonlySet<string>>;
  /** Marque des annonces comme notifiées, pour ne jamais les re-signaler. */
  markNotified(ids: readonly string[]): Promise<void>;
  /**
   * Annonces pertinentes, actives, dotées d'un e-mail de contact et pour
   * lesquelles aucun brouillon n'a encore été créé (§22). Triées par priorité.
   */
  pendingDrafts(): Promise<DraftableListing[]>;
  /** Marque des annonces « brouillon créé », pour ne pas en recréer. */
  markDrafted(ids: readonly string[]): Promise<void>;
  /**
   * Réglage applicatif partagé avec le site (§66), en JSON. `null` si absent :
   * la valeur du fichier `config/search.json` fait alors seule autorité.
   */
  readSetting(key: string): Promise<string | null>;
  /** Écrit un réglage applicatif, écrasant le précédent. */
  writeSetting(key: string, value: string): Promise<void>;
  /** Bascule le favori d'une annonce. */
  setListingFavorite(listingId: string, favorite: boolean): Promise<void>;
  httpCache(): HttpCacheStore;
  geocodeCache(): GeocodeCacheStore;
  transitCache(): TransitCacheStore;
}

/** Vue légère d'une annonce pour composer une notification. */
export interface NotifiableListing {
  readonly id: string;
  readonly title: string | null;
  readonly price: number | null;
  readonly area: number | null;
  readonly rooms: number | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  /** Adresse de rue si publiée (numéro + voie) — pour un lien Maps précis (§20). */
  readonly address: string | null;
  /** Quartier si publié (ex. Orpi « Madeleine »), à défaut de rue exacte. */
  readonly district: string | null;
  /** Date d'emménagement possible (ISO) si publiée — pour l'afficher (§17, §20). */
  readonly availableAt: string | null;
  readonly actionPriority: number;
  /** URL de la fiche d'origine (première occurrence), si disponible. */
  readonly url: string | null;
  /** Photos (URLs du site d'origine, §11) — 10 au plus, ce qu'une alerte peut porter. */
  readonly photoUrls: readonly string[];
  /** Source de l'occurrence principale (ex. `email-alerts`), pour le dédoublonnage. */
  readonly sourceId: string | null;
  /** Téléphone publié : affiché dans la notif, tappable pour appeler (§21). */
  readonly phone: string | null;
}

/** Annonce éligible à un BROUILLON Gmail : pertinente et dotée d'un e-mail (§22). */
export interface DraftableListing {
  readonly id: string;
  /** Adresse e-mail de contact (destinataire du brouillon). */
  readonly email: string;
  /** Rue publiée (§20), pour situer le logement dans le message. `null` sinon. */
  readonly address: string | null;
  /** Quartier publié (§20), à défaut de rue. `null` sinon. */
  readonly district: string | null;
  /** Vue minimale pour composer le message (structurellement un MessageListing). */
  readonly listing: MessageListing;
}

/**
 * Clé de rapprochement d'une annonce sur ses caractéristiques observables
 * (loyer, surface, ville, pièces). Prix et surface sont arrondis à l'entier
 * pour absorber les écarts d'affichage entre sources (« 16 » vs « 16,4 »).
 * `null` si les signaux fiables manquent — on ne rapproche pas dans le vide (§17).
 */
export function listingSpecKey(
  price: number | null,
  area: number | null,
  city: string | null,
  rooms: number | null,
): string | null {
  if (price === null || area === null || city === null) return null;
  return `${Math.round(price)}|${Math.round(area)}|${city.toLowerCase()}|${rooms ?? '?'}`;
}

/**
 * Clé de REPLI, sans la ville : « loyer|surface|pièces ».
 *
 * Les alertes e-mail ne publient pas toujours la commune ; la clé stricte vaut
 * alors `null` et aucun rapprochement n'était tenté — d'où des notifications en
 * double (même bien vu par une agence ET par le portail). Toutes les sources du
 * projet ne couvrent que l'agglomération niçoise, et cette clé ne sert QU'À
 * taire une notification redondante (jamais à fusionner des fiches, §14) : le
 * risque d'une confusion reste sans conséquence, la fiche restant visible.
 */
export function looseSpecKey(
  price: number | null,
  area: number | null,
  rooms: number | null,
): string | null {
  if (price === null || area === null) return null;
  return `${Math.round(price)}|${Math.round(area)}|${rooms ?? '?'}`;
}

export interface LifecycleThresholds {
  readonly possiblyInactiveAfter: number;
  readonly inactiveAfter: number;
}

export interface CollectionRunRecord {
  readonly id: string;
  readonly sourceId: SourceId;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly requestCount: number;
  readonly pagesFetched: number;
  readonly listingsFound: number;
  readonly listingsNew: number;
  readonly listingsUpdated: number;
  readonly duplicates: number;
  readonly errors: number;
  readonly stopReason: string;
  readonly warnings: readonly string[];
}

/** État par défaut d'une source jamais exécutée. */
function defaultState(sourceId: SourceId): SourceRuntimeState {
  return {
    sourceId,
    health: 'healthy',
    lastRunAt: null,
    lastSuccessAt: null,
    last429At: null,
    lastBlockedAt: null,
    cooldownUntil: null,
    consecutiveErrors: 0,
    lastNewListingCount: 0,
    averageNewListingCount: 0,
  };
}

/**
 * Consigne une décision PERSONNELLE sur une annonce.
 *
 * Ces états — vu, archivé, favori, statut de suivi, alerte envoyée, brouillon
 * écrit — vivent encore dans des colonnes de `listings`, où le reste du code
 * les lit. Ils vivent AUSSI, depuis la migration 19, dans
 * `listing_user_state`, rattachés à un utilisateur : c'est là qu'ils iront le
 * jour où l'application en portera plusieurs, et une fiche partagée ne peut
 * pas garder le favori de l'un pour l'autre.
 *
 * ÉCRIRE AUX DEUX ENDROITS PLUTÔT QUE DE FIGER UNE COPIE : une table remplie
 * une fois par la migration puis laissée de côté aurait divergé dès le
 * lendemain, et la bascule serait partie de données fausses. Le coût est une
 * ligne écrite de plus par CLIC — un favori, un changement de statut : rien
 * au regard des milliers de lignes que lit une collecte (§30).
 */
async function recordUserState(
  db: Database,
  listingIds: readonly string[],
  patch: Readonly<Record<string, string | number | null>>,
): Promise<void> {
  if (listingIds.length === 0) return;
  const columns = Object.keys(patch);
  if (columns.length === 0) return;
  const now = new Date().toISOString();
  // `notified_at` garde sa PREMIÈRE valeur : une annonce re-signalée plus
  // tard ne doit pas remonter l'historique.
  const updates = columns
    .map((column) =>
      column === 'notified_at'
        ? `${column} = COALESCE(listing_user_state.${column}, excluded.${column})`
        : `${column} = excluded.${column}`,
    )
    .concat('updated_at = excluded.updated_at');
  await db.batch(
    listingIds.map((listingId) => ({
      sql: `INSERT INTO listing_user_state (user_id, listing_id, ${columns.join(', ')}, updated_at)
            VALUES (?, ?, ${columns.map(() => '?').join(', ')}, ?)
            ON CONFLICT(user_id, listing_id) DO UPDATE SET ${updates.join(', ')}`,
      args: [CURRENT_USER, listingId, ...columns.map((column) => patch[column] ?? null), now],
    })),
    'write',
  );
}

export function createRepository(db: Database): Repository {
  return {
    async knownRefs(sourceId) {
      const result = await db.execute({
        sql: 'SELECT source_ref FROM occurrences WHERE source_id = ?',
        args: [sourceId],
      });
      return new Set(result.rows.map((row) => String(row['source_ref'])));
    },

    async upsertOccurrences(listings) {
      if (listings.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };

      // Une seule lecture pour tout le lot : on récupère les empreintes
      // existantes afin de décider quoi écrire (§30).
      const ids = listings.map((listing) => listing.id);
      const placeholders = ids.map(() => '?').join(',');
      const existing = await db.execute({
        sql: `SELECT id, content_hash, first_seen_at, price, area, available_at
              FROM occurrences WHERE id IN (${placeholders})`,
        args: ids,
      });

      const known = new Map(
        existing.rows.map((row) => [
          String(row['id']),
          {
            hash: String(row['content_hash']),
            firstSeenAt: String(row['first_seen_at']),
            price: row['price'] === null ? null : Number(row['price']),
            area: row['area'] === null ? null : Number(row['area']),
            availableAt: row['available_at'] === null ? null : String(row['available_at']),
          },
        ]),
      );

      const inserts: Statement[] = [];
      const touches: string[] = [];
      let inserted = 0;
      let updated = 0;

      for (const listing of listings) {
        const hash = occurrenceHash(listing);
        const previous = known.get(listing.id);

        if (previous !== undefined && previous.hash === hash) {
          // Annonce identique : on ne réécrit rien d'autre que la date de
          // dernière observation, groupée plus bas en une seule requête.
          touches.push(listing.id);
          continue;
        }

        // §31 : consigner l'historique — baseline à la 1re observation, puis
        // uniquement quand loyer / surface / disponibilité changent.
        const historyRow = historyStatement(listing, previous);
        if (historyRow !== null) inserts.push(historyRow);

        if (previous === undefined) inserted += 1;
        else updated += 1;

        const payload = JSON.stringify(occurrencePayload(listing));

        inserts.push({
          sql: `
            INSERT INTO occurrences (
              id, source_id, source_ref, source_url, title, price, charges, charges_included,
              area, rooms, bedrooms, property_type, furnished, flat_share, city, postal_code,
              address, latitude, longitude, contact_phone, contact_email, contact_agency,
              contact_reference, published_at, available_at, first_seen_at, last_seen_at,
              scraped_at, lifecycle, payload, content_hash, missing_runs
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
            ON CONFLICT(source_id, source_ref) DO UPDATE SET
              -- L'identifiant est DÉRIVÉ de la clé naturelle. Viser cette
              -- dernière plutôt que lui rend l'écriture insensible à un
              -- changement de schéma d'identifiant : la ligne existante est
              -- retrouvée et son id remis d'aplomb, là où viser l'identifiant
              -- tentait une insertion et violait la contrainte d'unicité.
              id = excluded.id,
              source_url = excluded.source_url,
              title = excluded.title,
              price = excluded.price,
              charges = excluded.charges,
              charges_included = excluded.charges_included,
              area = excluded.area,
              rooms = excluded.rooms,
              bedrooms = excluded.bedrooms,
              property_type = excluded.property_type,
              furnished = excluded.furnished,
              flat_share = excluded.flat_share,
              city = excluded.city,
              postal_code = excluded.postal_code,
              address = excluded.address,
              latitude = excluded.latitude,
              longitude = excluded.longitude,
              contact_phone = excluded.contact_phone,
              contact_email = excluded.contact_email,
              contact_agency = excluded.contact_agency,
              contact_reference = excluded.contact_reference,
              published_at = excluded.published_at,
              available_at = excluded.available_at,
              last_seen_at = excluded.last_seen_at,
              scraped_at = excluded.scraped_at,
              lifecycle = 'active',
              payload = excluded.payload,
              content_hash = excluded.content_hash,
              missing_runs = 0
          `,
          args: [
            listing.id,
            listing.sourceId,
            listing.sourceRef,
            listing.sourceUrl,
            listing.title,
            listing.price,
            listing.charges,
            boolToInt(listing.chargesIncluded),
            listing.area,
            listing.rooms,
            listing.bedrooms,
            listing.propertyType,
            boolToInt(listing.furnished),
            boolToInt(listing.flatShare),
            listing.city,
            listing.postalCode,
            listing.address,
            listing.latitude,
            listing.longitude,
            listing.contact.phone,
            listing.contact.email,
            listing.contact.agencyName,
            listing.contact.reference,
            listing.publishedAt,
            listing.availableAt,
            // La date de première observation d'une annonce connue est
            // préservée : elle sert à mesurer la durée de publication (§31).
            previous?.firstSeenAt ?? listing.firstSeenAt,
            listing.lastSeenAt,
            listing.scrapedAt,
            'active',
            payload,
            hash,
          ],
        });
      }

      if (touches.length > 0) {
        const seenAt = listings[0]?.lastSeenAt ?? new Date().toISOString();
        inserts.push({
          sql: `UPDATE occurrences SET last_seen_at = ?, missing_runs = 0, lifecycle = 'active'
                WHERE id IN (${touches.map(() => '?').join(',')})`,
          args: [seenAt, ...touches],
        });
      }

      if (inserts.length > 0) await db.batch(inserts, 'write');

      return { inserted, updated, unchanged: touches.length };
    },

    async allActiveOccurrences() {
      const result = await db.execute(
        `SELECT * FROM occurrences WHERE lifecycle IN ('active', 'possiblyInactive')`,
      );
      return result.rows.map(rowToOccurrence);
    },

    async absorbOrphanListings() {
      const orphans = await db.execute(
        `SELECT id, payload FROM listings WHERE ${ORPHAN_PREDICATE}`,
      );
      if (orphans.rows.length === 0) return 0;

      // Le rattachement ACTUEL de chaque occurrence, en UNE lecture. La version
      // précédente interrogeait la base une fois par orpheline : autant
      // d'allers-retours vers Turso, facturés et lents, pour une donnée qui
      // tient en une table (§30).
      const groups = await db.execute(
        `SELECT id, group_id FROM occurrences WHERE group_id IS NOT NULL`,
      );
      const groupByOccurrence = new Map(
        groups.rows.map((row) => [String(row['id']), String(row['group_id'])]),
      );

      // Successeur = la fiche qui porte aujourd'hui les occurrences de
      // l'orpheline, telles que sa charge utile les énumère.
      const predecessors = new Map<string, string[]>();
      for (const row of orphans.rows) {
        const orphanId = String(row['id']);
        const successors = new Set(
          occurrenceIdsOf(row['payload'])
            .map((id) => groupByOccurrence.get(id))
            .filter((id): id is string => id !== undefined && id !== orphanId),
        );
        // Un seul successeur, sinon on ne saurait pas à qui donner la décision.
        const [successor] = successors;
        if (successors.size !== 1 || successor === undefined) continue;
        predecessors.set(successor, [...(predecessors.get(successor) ?? []), orphanId]);
      }

      return inheritUserState(db, predecessors);
    },

    async realignOccurrenceIds() {
      const result = await db.execute(
        `UPDATE occurrences
            SET id = source_id || ':' || source_ref
          WHERE id <> source_id || ':' || source_ref
            AND NOT EXISTS (
              SELECT 1 FROM occurrences other
               WHERE other.id = occurrences.source_id || ':' || occurrences.source_ref
            )`,
      );
      return result.rowsAffected;
    },

    async updateDerivedFields(occurrences) {
      if (occurrences.length === 0) return 0;
      const statements: Statement[] = occurrences.map((listing) => ({
        // Seuls l'adresse, le TYPE, la COLOCATION, les CHARGES, les PIÈCES et
        // la charge utile bougent — le DPE voyage dans cette dernière.
        // `flat_share` a sa propre colonne parce que le dédoublonnage et le
        // score la lisent sans ouvrir la charge utile : l'oublier ici aurait
        // rendu la correction invisible là où elle compte.
        // `content_hash` suit, pour que la prochaine collecte ne réécrive pas
        // la ligne pour rien.
        sql: `UPDATE occurrences
              SET address = ?, property_type = ?, flat_share = ?, charges = ?,
                  rooms = ?, payload = ?, content_hash = ?
              WHERE id = ?`,
        args: [
          listing.address,
          listing.propertyType,
          listing.flatShare === null ? null : listing.flatShare ? 1 : 0,
          listing.charges,
          listing.rooms,
          JSON.stringify(occurrencePayload(listing)),
          occurrenceHash(listing),
          listing.id,
        ],
      }));
      await db.batch(statements, 'write');
      return statements.length;
    },

    async recentPriceDropIds(sinceIso) {
      const result = await db.execute({
        sql: `SELECT DISTINCT occurrence_id FROM listing_history
              WHERE change = 'price-drop' AND recorded_at >= ?`,
        args: [sinceIso],
      });
      return new Set(result.rows.map((row) => String(row['occurrence_id'])));
    },

    async saveListings(listings) {
      if (listings.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };

      const ids = listings.map((listing) => listing.id);
      // Deux lectures indépendantes : les mener de front épargne une latence.
      // La seconde répond à « à quelle fiche ces occurrences appartenaient-elles
      // AVANT ce passage ? », question qu'il faut poser maintenant — le
      // rattachement plus bas écrase la réponse, et sans elle une fusion
      // perdrait le suivi porté par la fiche absorbée (voir `inheritUserState`).
      const [existing, predecessors] = await Promise.all([
        db.execute({
          sql: `SELECT id, content_hash FROM listings WHERE id IN (${ids.map(() => '?').join(',')})`,
          args: ids,
        }),
        previousGroups(db, listings),
      ]);
      const known = new Map(
        existing.rows.map((row) => [String(row['id']), String(row['content_hash'])]),
      );

      const statements: Statement[] = [];
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;

      for (const listing of listings) {
        const hash = listingHash(listing);
        const previous = known.get(listing.id);
        if (previous === hash) {
          unchanged += 1;
          continue;
        }
        if (previous === undefined) inserted += 1;
        else updated += 1;

        statements.push({
          sql: `
            INSERT INTO listings (
              id, title, price, area, rooms, property_type, city, postal_code,
              latitude, longitude, published_at, first_seen_at, last_seen_at,
              lifecycle, tracking, match_score, opportunity_score, visit_score,
              risk_score, action_priority, matches_criteria, payload, content_hash, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title, price = excluded.price, area = excluded.area,
              rooms = excluded.rooms, property_type = excluded.property_type,
              city = excluded.city, postal_code = excluded.postal_code,
              latitude = excluded.latitude, longitude = excluded.longitude,
              published_at = excluded.published_at, last_seen_at = excluded.last_seen_at,
              lifecycle = excluded.lifecycle,
              match_score = excluded.match_score, opportunity_score = excluded.opportunity_score,
              visit_score = excluded.visit_score, risk_score = excluded.risk_score,
              action_priority = excluded.action_priority,
              matches_criteria = excluded.matches_criteria,
              payload = excluded.payload, content_hash = excluded.content_hash,
              updated_at = excluded.updated_at
          `,
          args: [
            listing.id,
            listing.title.value,
            listing.price.value,
            listing.area.value,
            listing.rooms.value,
            listing.propertyType.value,
            listing.city.value,
            listing.postalCode.value,
            listing.latitude.value,
            listing.longitude.value,
            listing.publishedAt.value,
            listing.firstSeenAt,
            listing.lastSeenAt,
            listing.lifecycle,
            listing.tracking,
            listing.scores.match.value,
            listing.scores.opportunity.value,
            listing.scores.visitProbability.value,
            listing.scores.risk.value,
            actionPriority(listing.scores),
            listing.matchesCriteria ? 1 : 0,
            JSON.stringify(serializeListing(listing)),
            hash,
            new Date().toISOString(),
          ],
        });

        // Rattache les occurrences à leur fiche.
        statements.push({
          sql: `UPDATE occurrences SET group_id = ? WHERE id IN (${listing.occurrences
            .map(() => '?')
            .join(',')})`,
          args: [listing.id, ...listing.occurrences.map((o) => o.id)],
        });
      }

      if (statements.length > 0) await db.batch(statements, 'write');

      // La fiche survivante hérite des décisions portées par celles qu'elle
      // absorbe, AVANT la purge : sans quoi soit on efface un « contactée »,
      // soit on garde en base une fiche morte qui ressort en doublon.
      await inheritUserState(db, predecessors);

      // Fiches ORPHELINES : quand deux fiches fusionnent, le groupe survivant
      // reçoit un nouvel identifiant et les occurrences lui sont rattachées —
      // l'ancienne ligne restait en base, plus référencée par rien. Elle
      // continuait d'être comptée et affichée, donc de ressortir en doublon.
      //
      // La suppression ne perd rien : le contenu vit dans la fiche survivante.
      // On épargne toutefois celles qui portent une décision de l'utilisateur
      // (favori, archivage, suivi) — mieux vaut une ligne morte qu'un choix
      // effacé (§14).
      const orphans = await db.execute(`
        DELETE FROM listings
        WHERE ${ORPHAN_PREDICATE}
          AND favorite = 0 AND archived = 0
          AND (tracking IS NULL OR tracking IN ('none', 'new'))
      `);
      const removed = orphans.rowsAffected ?? 0;

      return { inserted, updated, unchanged, ...(removed > 0 ? { removed } : {}) };
    },

    async expireByAge(sourceId, thresholds) {
      // `last_seen_at` est la dernière fois que la source l'a MENTIONNÉE : pour
      // une annonce annoncée une seule fois, c'est sa date de parution.
      await db.batch(
        [
          {
            sql: `UPDATE occurrences SET lifecycle = 'possiblyInactive'
                  WHERE source_id = ? AND lifecycle = 'active'
                    AND julianday('now') - julianday(last_seen_at) >= ?`,
            args: [sourceId, thresholds.possiblyInactiveAfterDays],
          },
          {
            sql: `UPDATE occurrences SET lifecycle = 'inactive'
                  WHERE source_id = ? AND lifecycle != 'inactive'
                    AND julianday('now') - julianday(last_seen_at) >= ?`,
            args: [sourceId, thresholds.inactiveAfterDays],
          },
        ],
        'write',
      );
    },

    async activeOccurrenceCount(sourceId) {
      const result = await db.execute({
        sql: "SELECT COUNT(*) AS n FROM occurrences WHERE source_id = ? AND lifecycle != 'inactive'",
        args: [sourceId],
      });
      return Number(result.rows[0]?.['n'] ?? 0);
    },

    async pushSubscriptions() {
      const result = await db.execute(
        'SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at',
      );
      return result.rows.map((row) => ({
        endpoint: String(row['endpoint']),
        p256dh: String(row['p256dh']),
        auth: String(row['auth']),
      }));
    },

    async removePushSubscription(endpoint) {
      await db.execute({
        sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?',
        args: [endpoint],
      });
    },

    async recordDailyStat() {
      const row = (
        await db.execute(`
          SELECT
            SUM(CASE WHEN matches_criteria = 1 AND lifecycle = 'active'
                      AND archived = 0 AND rented = 0 THEN 1 ELSE 0 END) AS matching,
            SUM(CASE WHEN matches_criteria = 1 AND lifecycle = 'possiblyInactive'
                      AND archived = 0 AND rented = 0 THEN 1 ELSE 0 END) AS uncertain,
            SUM(CASE WHEN matches_criteria = 1 AND rented = 1 THEN 1 ELSE 0 END) AS rented,
            COUNT(*) AS total
          FROM listings
        `)
      ).rows[0];
      const sources = (
        await db.execute(
          "SELECT COUNT(DISTINCT source_id) AS n FROM occurrences WHERE lifecycle = 'active'",
        )
      ).rows[0];

      await db.execute({
        sql: `INSERT INTO daily_stats (day, matching, uncertain, rented, total, active_sources, recorded_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(day) DO UPDATE SET
                matching = excluded.matching, uncertain = excluded.uncertain,
                rented = excluded.rented, total = excluded.total,
                active_sources = excluded.active_sources, recorded_at = excluded.recorded_at`,
        args: [
          new Date().toISOString().slice(0, 10),
          Number(row?.['matching'] ?? 0),
          Number(row?.['uncertain'] ?? 0),
          Number(row?.['rented'] ?? 0),
          Number(row?.['total'] ?? 0),
          Number(sources?.['n'] ?? 0),
          new Date().toISOString(),
        ],
      });
    },

    async dailyStats(limit = 90) {
      const result = await db.execute({
        sql: 'SELECT * FROM daily_stats ORDER BY day DESC LIMIT ?',
        args: [limit],
      });
      return result.rows
        .map((r) => ({
          day: String(r['day']),
          matching: Number(r['matching']),
          uncertain: Number(r['uncertain']),
          rented: Number(r['rented']),
          total: Number(r['total']),
          activeSources: Number(r['active_sources']),
        }))
        .reverse();
    },

    async markRented(sourceId, refs) {
      if (refs.length === 0) return 0;
      const placeholders = refs.map(() => '?').join(',');
      // La fiche est reliée à ses occurrences par `group_id`. On marque « loué »
      // toute fiche possédant une occurrence `sourceId:ref` signalée.
      const result = await db.execute({
        sql: `UPDATE listings SET rented = 1, updated_at = ?
              WHERE rented = 0 AND id IN (
                SELECT group_id FROM occurrences
                WHERE source_id = ? AND source_ref IN (${placeholders}) AND group_id IS NOT NULL
              )`,
        args: [new Date().toISOString(), sourceId, ...refs],
      });
      return result.rowsAffected;
    },

    async loadSourceState(sourceId) {
      const result = await db.execute({
        sql: 'SELECT * FROM source_state WHERE source_id = ?',
        args: [sourceId],
      });
      const row = result.rows[0];
      if (row === undefined) return defaultState(sourceId);

      const text = (key: string): string | null => {
        const value = row[key];
        return value === null || value === undefined ? null : String(value);
      };

      return {
        sourceId,
        health: (text('health') ?? 'healthy') as SourceRuntimeState['health'],
        lastRunAt: text('last_run_at'),
        lastSuccessAt: text('last_success_at'),
        last429At: text('last_429_at'),
        lastBlockedAt: text('last_blocked_at'),
        cooldownUntil: text('cooldown_until'),
        consecutiveErrors: Number(row['consecutive_errors'] ?? 0),
        lastNewListingCount: Number(row['last_new_listing_count'] ?? 0),
        averageNewListingCount: Number(row['average_new_listing_count'] ?? 0),
      };
    },

    async saveSourceState(state) {
      await db.execute({
        sql: `
          INSERT INTO source_state (
            source_id, health, last_run_at, last_success_at, last_429_at, last_blocked_at,
            cooldown_until, consecutive_errors, last_new_listing_count,
            average_new_listing_count, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(source_id) DO UPDATE SET
            health = excluded.health, last_run_at = excluded.last_run_at,
            last_success_at = excluded.last_success_at, last_429_at = excluded.last_429_at,
            last_blocked_at = excluded.last_blocked_at, cooldown_until = excluded.cooldown_until,
            consecutive_errors = excluded.consecutive_errors,
            last_new_listing_count = excluded.last_new_listing_count,
            average_new_listing_count = excluded.average_new_listing_count,
            updated_at = excluded.updated_at
        `,
        args: [
          state.sourceId,
          state.health,
          state.lastRunAt,
          state.lastSuccessAt,
          state.last429At,
          state.lastBlockedAt,
          state.cooldownUntil,
          state.consecutiveErrors,
          state.lastNewListingCount,
          state.averageNewListingCount,
          new Date().toISOString(),
        ],
      });
    },

    async recordRun(entry) {
      await db.execute({
        sql: `INSERT INTO collection_runs (
                id, source_id, started_at, finished_at, request_count, pages_fetched,
                listings_found, listings_new, listings_updated, duplicates, errors,
                stop_reason, warnings
              ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          entry.id,
          entry.sourceId,
          entry.startedAt,
          entry.finishedAt,
          entry.requestCount,
          entry.pagesFetched,
          entry.listingsFound,
          entry.listingsNew,
          entry.listingsUpdated,
          entry.duplicates,
          entry.errors,
          entry.stopReason,
          JSON.stringify(entry.warnings),
        ],
      });
    },

    async markMissing(sourceId, seenRefs, thresholds) {
      // Une annonce non revue voit son compteur augmenter. Elle ne disparaît
      // jamais : elle change seulement de statut (§32).
      const refs = [...seenRefs];
      const exclusion =
        refs.length > 0 ? `AND source_ref NOT IN (${refs.map(() => '?').join(',')})` : '';

      await db.execute({
        sql: `UPDATE occurrences SET missing_runs = missing_runs + 1
              WHERE source_id = ? AND lifecycle != 'inactive' ${exclusion}`,
        args: [sourceId, ...refs],
      });

      await db.batch(
        [
          {
            sql: `UPDATE occurrences SET lifecycle = 'possiblyInactive'
                  WHERE source_id = ? AND missing_runs >= ? AND missing_runs < ?`,
            args: [sourceId, thresholds.possiblyInactiveAfter, thresholds.inactiveAfter],
          },
          {
            sql: `UPDATE occurrences SET lifecycle = 'inactive'
                  WHERE source_id = ? AND missing_runs >= ?`,
            args: [sourceId, thresholds.inactiveAfter],
          },
        ],
        'write',
      );
    },

    async pendingNotifications(minPriority) {
      const result = await db.execute({
        // `lifecycle = 'active'` (et non « != inactive ») : une annonce
        // `possiblyInactive` a déjà disparu de sa source lors de plusieurs
        // passages — la pousser en notification enverrait très probablement vers
        // une annonce expirée. Elle reste VISIBLE sur le site (décision
        // utilisateur), mais on ne la notifie pas (§29, §33).
        sql: `SELECT id, title, price, area, rooms, city, postal_code, action_priority, payload
              FROM listings
              WHERE matches_criteria = 1
                AND notified = 0
                AND lifecycle = 'active'
                AND archived = 0
                AND rented = 0
                AND COALESCE(action_priority, 0) >= ?
              ORDER BY action_priority DESC`,
        args: [minPriority],
      });

      return result.rows.map((row) => {
        let url: string | null = null;
        let photoUrls: string[] = [];
        let address: string | null = null;
        let district: string | null = null;
        let availableAt: string | null = null;
        let sourceId: string | null = null;
        let phone: string | null = null;
        try {
          const payload = JSON.parse(String(row['payload'] ?? '{}')) as {
            occurrences?: { sourceUrl?: unknown; sourceId?: unknown }[];
            imageUrls?: unknown[];
            address?: { value?: unknown };
            district?: { value?: unknown };
            availableAt?: { value?: unknown };
            contact?: { phone?: unknown };
          };
          const first = payload.occurrences?.[0]?.sourceUrl;
          if (typeof first === 'string') url = first;
          const firstSource = payload.occurrences?.[0]?.sourceId;
          if (typeof firstSource === 'string') sourceId = firstSource;
          if (typeof payload.contact?.phone === 'string') phone = payload.contact.phone;
          photoUrls = (payload.imageUrls ?? [])
            .filter((u): u is string => typeof u === 'string' && u.startsWith('http'))
            .slice(0, 10);
          if (typeof payload.address?.value === 'string') address = payload.address.value;
          if (typeof payload.district?.value === 'string') district = payload.district.value;
          if (typeof payload.availableAt?.value === 'string')
            availableAt = payload.availableAt.value;
        } catch {
          /* payload illisible : pas d'URL, le reste suffit */
        }
        return {
          id: String(row['id']),
          title: row['title'] === null ? null : String(row['title']),
          price: row['price'] === null ? null : Number(row['price']),
          area: row['area'] === null ? null : Number(row['area']),
          rooms: row['rooms'] === null ? null : Number(row['rooms']),
          city: row['city'] === null ? null : String(row['city']),
          postalCode: row['postal_code'] === null ? null : String(row['postal_code']),
          address,
          district,
          availableAt,
          actionPriority: Number(row['action_priority'] ?? 0),
          url,
          photoUrls,
          sourceId,
          phone,
        };
      });
    },

    async directListingSpecKeys() {
      // Annonces actives dont AUCUNE occurrence n'est une alerte e-mail : elles
      // constituent les biens « directs » de référence.
      const result = await db.execute(
        `SELECT price, area, city, rooms FROM listings
         WHERE lifecycle != 'inactive' AND rented = 0 AND archived = 0
           AND price IS NOT NULL AND area IS NOT NULL
           AND id NOT IN (SELECT group_id FROM occurrences WHERE source_id = 'email-alerts')`,
      );
      const keys = new Set<string>();
      for (const row of result.rows) {
        const price = row['price'] === null ? null : Number(row['price']);
        const area = row['area'] === null ? null : Number(row['area']);
        const rooms = row['rooms'] === null ? null : Number(row['rooms']);
        const city = row['city'] === null ? null : String(row['city']);
        // On indexe les DEUX formes : la stricte (avec ville) et le repli sans
        // ville, pour rattraper les annonces e-mail dont la commune manque.
        const strict = listingSpecKey(price, area, city, rooms);
        if (strict !== null) keys.add(strict);
        const loose = looseSpecKey(price, area, rooms);
        if (loose !== null) keys.add(loose);
      }
      return keys;
    },

    async pruneLogs(nowMs) {
      const cutoff = (days: number): string =>
        new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
      const result = await db.batch(
        [
          // Une trace d'exécution sert à comprendre POURQUOI une source s'est
          // tue cette semaine, pas l'an dernier.
          { sql: 'DELETE FROM collection_runs WHERE started_at < ?', args: [cutoff(RUN_LOG_DAYS)] },
          // L'historique des prix nourrit le signal « prix en baisse », qui ne
          // regarde que les quatorze derniers jours. Six mois laissent large.
          {
            sql: 'DELETE FROM listing_history WHERE recorded_at < ?',
            args: [cutoff(HISTORY_DAYS)],
          },
          { sql: 'DELETE FROM events WHERE occurred_at < ?', args: [cutoff(EVENT_DAYS)] },
        ],
        'write',
      );
      return result.reduce((total, one) => total + one.rowsAffected, 0);
    },

    async markNotified(ids) {
      if (ids.length === 0) return;
      const placeholders = ids.map(() => '?').join(',');
      await db.execute({
        // `COALESCE` : la date retenue est celle de la PREMIÈRE alerte. Une
        // annonce re-notifiée plus tard ne doit pas remonter l'historique.
        sql: `UPDATE listings
              SET notified = 1, notified_at = COALESCE(notified_at, ?)
              WHERE id IN (${placeholders})`,
        args: [new Date().toISOString(), ...ids],
      });
      await recordUserState(db, ids, { notified: 1, notified_at: new Date().toISOString() });
    },

    async pendingDrafts() {
      const result = await db.execute(
        `SELECT id, payload FROM listings
         WHERE matches_criteria = 1 AND rented = 0 AND lifecycle != 'inactive'
           AND archived = 0 AND drafted = 0
         ORDER BY action_priority DESC`,
      );
      const out: DraftableListing[] = [];
      for (const row of result.rows) {
        let payload: {
          propertyType?: MessageListing['propertyType'];
          area?: MessageListing['area'];
          city?: MessageListing['city'];
          price?: MessageListing['price'];
          contact?: MessageListing['contact'];
          address?: { value?: unknown };
          district?: { value?: unknown };
          occurrences?: { sourceUrl?: unknown }[];
        };
        try {
          payload = JSON.parse(String(row['payload'] ?? '{}'));
        } catch {
          continue;
        }
        const email = payload.contact?.email;
        // Un brouillon a besoin d'un destinataire : sans e-mail, on n'en crée pas.
        if (typeof email !== 'string' || email === '') continue;
        if (
          payload.propertyType === undefined ||
          payload.area === undefined ||
          payload.city === undefined ||
          payload.price === undefined ||
          payload.contact === undefined
        ) {
          continue;
        }
        const first = payload.occurrences?.[0]?.sourceUrl;
        out.push({
          id: String(row['id']),
          email,
          address: typeof payload.address?.value === 'string' ? payload.address.value : null,
          district: typeof payload.district?.value === 'string' ? payload.district.value : null,
          listing: {
            propertyType: payload.propertyType,
            area: payload.area,
            city: payload.city,
            price: payload.price,
            contact: payload.contact,
            sourceUrl: typeof first === 'string' ? first : null,
          },
        });
      }
      return out;
    },

    async markDrafted(ids) {
      if (ids.length === 0) return;
      const placeholders = ids.map(() => '?').join(',');
      await db.execute({
        sql: `UPDATE listings SET drafted = 1 WHERE id IN (${placeholders})`,
        args: [...ids],
      });
      await recordUserState(db, ids, { drafted: 1 });
    },

    async setListingFavorite(listingId, favorite) {
      await db.execute({
        sql: 'UPDATE listings SET favorite = ?, updated_at = ? WHERE id = ?',
        args: [favorite ? 1 : 0, new Date().toISOString(), listingId],
      });
      await recordUserState(db, [listingId], { favorite: favorite ? 1 : 0 });
    },

    async readSetting(key) {
      const result = await db.execute({
        sql: 'SELECT value FROM app_settings WHERE key = ?',
        args: [key],
      });
      const row = result.rows[0];
      return row === undefined ? null : String(row['value']);
    },

    async writeSetting(key, value) {
      await db.execute({
        sql: `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                             updated_at = excluded.updated_at`,
        args: [key, value, new Date().toISOString()],
      });
    },

    httpCache(): HttpCacheStore {
      return {
        async get(url) {
          const result = await db.execute({
            sql: 'SELECT etag, last_modified, fetched_at FROM http_cache WHERE url = ?',
            args: [url],
          });
          const row = result.rows[0];
          if (row === undefined) return null;
          return {
            etag: row['etag'] === null ? null : String(row['etag']),
            lastModified: row['last_modified'] === null ? null : String(row['last_modified']),
            fetchedAt: String(row['fetched_at']),
          } satisfies CacheEntry;
        },
        async set(url, entry) {
          await db.execute({
            sql: `INSERT INTO http_cache (url, etag, last_modified, fetched_at)
                  VALUES (?,?,?,?)
                  ON CONFLICT(url) DO UPDATE SET
                    etag = excluded.etag,
                    last_modified = excluded.last_modified,
                    fetched_at = excluded.fetched_at`,
            args: [url, entry.etag, entry.lastModified, entry.fetchedAt],
          });
        },
      };
    },

    geocodeCache(): GeocodeCacheStore {
      return {
        async get(query) {
          const result = await db.execute({
            sql: 'SELECT lat, lon, geocoded_at FROM geocode_cache WHERE query = ?',
            args: [query],
          });
          const row = result.rows[0];
          if (row === undefined) return null;
          return {
            lat: row['lat'] === null ? null : Number(row['lat']),
            lon: row['lon'] === null ? null : Number(row['lon']),
            geocodedAt: String(row['geocoded_at']),
          };
        },
        async set(query, entry) {
          await db.execute({
            sql: `INSERT INTO geocode_cache (query, lat, lon, geocoded_at)
                  VALUES (?,?,?,?)
                  ON CONFLICT(query) DO UPDATE SET
                    lat = excluded.lat, lon = excluded.lon, geocoded_at = excluded.geocoded_at`,
            args: [query, entry.lat, entry.lon, entry.geocodedAt],
          });
        },
      };
    },

    transitCache(): TransitCacheStore {
      return {
        async get(key) {
          const result = await db.execute({
            sql: 'SELECT minutes FROM transit_cache WHERE key = ?',
            args: [key],
          });
          const row = result.rows[0];
          if (row === undefined) return null;
          return { minutes: row['minutes'] === null ? null : Number(row['minutes']) };
        },
        async set(key, entry) {
          await db.execute({
            sql: `INSERT INTO transit_cache (key, minutes, cached_at)
                  VALUES (?,?,?)
                  ON CONFLICT(key) DO UPDATE SET
                    minutes = excluded.minutes, cached_at = excluded.cached_at`,
            args: [key, entry.minutes, new Date().toISOString()],
          });
        },
      };
    },
  };
}

/** Sérialise la fiche complète stockée dans `listings.payload`. */
function serializeListing(listing: ScoredListing): unknown {
  return {
    title: listing.title,
    description: listing.description,
    price: listing.price,
    charges: listing.charges,
    area: listing.area,
    rooms: listing.rooms,
    propertyType: listing.propertyType,
    furnished: listing.furnished,
    flatShare: listing.flatShare,
    dpe: listing.dpe,
    maxOccupants: listing.maxOccupants,
    features: listing.features,
    address: listing.address,
    district: listing.district,
    city: listing.city,
    postalCode: listing.postalCode,
    latitude: listing.latitude,
    longitude: listing.longitude,
    contact: listing.contact,
    publishedAt: listing.publishedAt,
    availableAt: listing.availableAt,
    imageUrls: listing.imageUrls,
    views: listing.views,
    favorites: listing.favorites,
    scores: listing.scores,
    distances: listing.distances,
    priceDropped: listing.priceDropped,
    occurrences: listing.occurrences.map((occurrence) => ({
      id: occurrence.id,
      sourceId: occurrence.sourceId,
      sourceUrl: occurrence.sourceUrl,
      price: occurrence.price,
      area: occurrence.area,
      lastSeenAt: occurrence.lastSeenAt,
    })),
  };
}

/**
 * Une fiche n'est plus rattachée à aucune occurrence : sa remplaçante les a
 * toutes prises. Écrit une seule fois — le prédicat servait à trois endroits.
 */
/**
 * Durées de conservation des journaux.
 *
 * Rien de tout cela n'est lu par l'application : ce sont des traces qu'on
 * consulte quand quelque chose cloche. Elles ne coûtaient aucune lecture, mais
 * elles ne s'effaçaient jamais non plus — 379 exécutions et 457 changements de
 * prix accumulés en trois semaines, sans fin prévue. Une base qui n'oublie
 * rien finit par peser pour des données que personne ne relira.
 *
 * L'historique garde le plus longtemps : il nourrit le signal « prix en
 * baisse », qui ne regarde que quatorze jours — six mois laissent large.
 */
const RUN_LOG_DAYS = 90;
const HISTORY_DAYS = 180;
const EVENT_DAYS = 90;

const ORPHAN_PREDICATE = 'id NOT IN (SELECT group_id FROM occurrences WHERE group_id IS NOT NULL)';

/** Identifiants d'occurrence énumérés par la charge utile d'une fiche. */
function occurrenceIdsOf(payload: unknown): string[] {
  try {
    const parsed = JSON.parse(String(payload ?? '{}')) as { occurrences?: { id?: unknown }[] };
    return (parsed.occurrences ?? [])
      .map((occurrence) => occurrence.id)
      .filter((id): id is string => typeof id === 'string');
  } catch {
    return []; // charge utile illisible : on n'y touche pas
  }
}

/**
 * Fiche à laquelle chaque occurrence était rattachée AVANT ce passage.
 *
 * @returns pour chaque fiche écrite, les identifiants des fiches dont elle
 *          reprend des occurrences — vide dans le cas courant, où rien n'a
 *          changé de groupe.
 */
async function previousGroups(
  db: Database,
  listings: readonly ScoredListing[],
): Promise<Map<string, string[]>> {
  if (listings.length === 0) return new Map();

  // Toute la table de rattachement en UNE lecture, sans paramètre lié. Passer
  // un placeholder par occurrence du corpus — près d'un millier — frôlait la
  // limite de variables de SQLite pour un gain nul : la colonne est indexée et
  // le filtrage se fait en mémoire.
  const rows = await db.execute(`SELECT id, group_id FROM occurrences WHERE group_id IS NOT NULL`);
  const groupByOccurrence = new Map(
    rows.rows.map((row) => [String(row['id']), String(row['group_id'])]),
  );

  const predecessors = new Map<string, string[]>();
  for (const listing of listings) {
    const previous = new Set<string>();
    for (const occurrence of listing.occurrences) {
      const group = groupByOccurrence.get(occurrence.id);
      if (group !== undefined && group !== listing.id) previous.add(group);
    }
    if (previous.size > 0) predecessors.set(listing.id, [...previous]);
  }
  return predecessors;
}

/**
 * Transmet à la fiche survivante ce que l'utilisateur avait décidé sur celles
 * qu'elle absorbe (§14, §35).
 *
 * QUAND DEUX FICHES FUSIONNENT, le groupe prend l'identifiant de son occurrence
 * la plus ancienne : l'autre ligne devient orpheline. Elle porte pourtant
 * peut-être un favori, un archivage ou un « contactée ». La purge l'épargnait
 * donc — au prix d'un DOUBLON bien visible, exactement le symptôme observé le
 * 2026-09-03 sur une annonce à 670 €.
 *
 * On ne choisit pas entre perdre la décision et garder le doublon : la
 * décision remonte, PUIS la ligne morte part — ici même, et pas dans la purge
 * générale, qui épargne à juste titre toute fiche portant une décision. Elle ne
 * peut pas savoir que celle-ci a été recopiée ailleurs ; nous, si.
 *
 * Les drapeaux se cumulent (un favori reste un favori) ; le SUIVI n'est repris
 * que si la fiche survivante n'en porte pas déjà un — on ne fait jamais reculer
 * un statut plus avancé.
 */
async function inheritUserState(
  db: Database,
  predecessors: ReadonlyMap<string, string[]>,
): Promise<number> {
  let absorbedCount = 0;

  for (const [survivor, absorbed] of predecessors) {
    const placeholders = absorbed.map(() => '?').join(',');

    // Une SEULE lecture des lignes absorbées. La version précédente rejouait la
    // même sous-requête six fois dans un `UPDATE` — six balayages, et six
    // `...absorbed` alignés à la main dans `args`, qu'un spread en trop
    // décalait sans la moindre erreur de compilation.
    const state = await db.execute({
      sql: `SELECT MAX(favorite)   AS favorite,
                   MAX(archived)   AS archived,
                   MAX(viewed)     AS viewed,
                   MAX(notified)   AS notified,
                   MIN(notified_at) AS notified_at,
                   MAX(CASE WHEN tracking NOT IN ('new', 'none') THEN tracking END) AS tracking
              FROM listings WHERE id IN (${placeholders})`,
      args: absorbed,
    });
    const row = state.rows[0];
    if (row === undefined) continue;
    const flag = (key: string): number => (Number(row[key] ?? 0) === 1 ? 1 : 0);
    const inheritedTracking = row['tracking'] === null ? null : String(row['tracking']);

    // Les drapeaux se cumulent ; le suivi n'est repris que si la survivante
    // n'en porte pas déjà un — on ne fait jamais reculer un statut plus avancé.
    await db.execute({
      sql: `UPDATE listings
               SET favorite = MAX(favorite, ?),
                   archived = MAX(archived, ?),
                   viewed   = MAX(viewed, ?),
                   notified = MAX(notified, ?),
                   notified_at = COALESCE(notified_at, ?),
                   tracking = CASE
                     WHEN (tracking IS NULL OR tracking IN ('new', 'none')) AND ? IS NOT NULL
                       THEN ?
                     ELSE tracking
                   END
             WHERE id = ?`,
      args: [
        flag('favorite'),
        flag('archived'),
        flag('viewed'),
        flag('notified'),
        row['notified_at'] === null ? null : String(row['notified_at']),
        inheritedTracking,
        inheritedTracking,
        survivor,
      ],
    });

    // La décision est en sûreté : la ligne absorbée peut disparaître, à
    // condition qu'elle ne porte plus aucune occurrence (une fusion partielle
    // la laisse vivante, avec ce qui lui reste).
    const removed = await db.execute({
      sql: `DELETE FROM listings WHERE id IN (${placeholders}) AND ${ORPHAN_PREDICATE}`,
      args: absorbed,
    });
    absorbedCount += removed.rowsAffected;
  }

  return absorbedCount;
}

/**
 * Charge utile JSON d'une occurrence : tout ce que les colonnes ne portent pas.
 * Une seule définition, en regard de `rowToOccurrence` qui la relit — les deux
 * doivent rester le miroir l'une de l'autre.
 */
function occurrencePayload(listing: NormalizedListing): Record<string, unknown> {
  return {
    description: listing.description,
    imageUrls: listing.imageUrls,
    views: listing.views,
    favorites: listing.favorites,
    chargesIncluded: listing.chargesIncluded,
    dpe: listing.dpe,
    maxOccupants: listing.maxOccupants,
    district: listing.district,
    features: listing.features,
    contactName: listing.contact.name,
    contactFormUrl: listing.contact.formUrl,
    landlordKind: listing.contact.kind,
  };
}

/** Reconstruit une occurrence à partir d'une ligne SQL. */
function rowToOccurrence(row: Record<string, unknown>): NormalizedListing {
  const payload = JSON.parse(String(row['payload'] ?? '{}')) as Record<string, unknown>;
  const num = (key: string): number | null =>
    row[key] === null || row[key] === undefined ? null : Number(row[key]);
  const text = (key: string): string | null =>
    row[key] === null || row[key] === undefined ? null : String(row[key]);
  const bool = (key: string): boolean | null => {
    const value = row[key];
    return value === null || value === undefined ? null : Number(value) === 1;
  };

  return {
    id: String(row['id']),
    sourceId: String(row['source_id']),
    sourceRef: String(row['source_ref']),
    sourceUrl: String(row['source_url']),
    title: text('title'),
    description: (payload['description'] as string | null) ?? null,
    price: num('price'),
    charges: num('charges'),
    chargesIncluded: (payload['chargesIncluded'] as boolean | null) ?? null,
    area: num('area'),
    rooms: num('rooms'),
    bedrooms: num('bedrooms'),
    propertyType: String(row['property_type']) as NormalizedListing['propertyType'],
    furnished: bool('furnished'),
    flatShare: bool('flat_share'),
    dpe: (payload['dpe'] as string | null) ?? null,
    maxOccupants: (payload['maxOccupants'] as number | null) ?? null,
    features: Array.isArray(payload['features']) ? (payload['features'] as string[]) : [],
    address: text('address'),
    district: (payload['district'] as string | null) ?? null,
    city: text('city'),
    postalCode: text('postal_code'),
    latitude: num('latitude'),
    longitude: num('longitude'),
    contact: {
      name: (payload['contactName'] as string | null) ?? null,
      agencyName: text('contact_agency'),
      phone: text('contact_phone'),
      email: text('contact_email'),
      formUrl: (payload['contactFormUrl'] as string | null) ?? null,
      reference: text('contact_reference'),
      kind: (payload['landlordKind'] as 'agency' | 'private' | 'unknown') ?? 'unknown',
      providedBy: [String(row['source_id'])],
    },
    publishedAt: text('published_at'),
    availableAt: text('available_at'),
    imageUrls: (payload['imageUrls'] as string[] | undefined) ?? [],
    views: (payload['views'] as number | null) ?? null,
    favorites: (payload['favorites'] as number | null) ?? null,
    firstSeenAt: String(row['first_seen_at']),
    lastSeenAt: String(row['last_seen_at']),
    scrapedAt: String(row['scraped_at']),
    lifecycle: String(row['lifecycle']) as NormalizedListing['lifecycle'],
  };
}
