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
  NormalizedListing,
  ScoredListing,
  SourceId,
  SourceRuntimeState,
} from '@rentfinder/shared';
import { actionPriority } from '@rentfinder/shared';
import type { InValue } from '@libsql/client';
import type { Database } from './client.js';
import type { CacheEntry, HttpCacheStore } from '../core/http-client.js';
import type { GeocodeCacheStore } from '../core/geocode.js';

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
  ]);
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

const boolToInt = (value: boolean | null): number | null => (value === null ? null : value ? 1 : 0);

export interface UpsertReport {
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
}

export interface Repository {
  /** Références déjà connues pour une source — alimente l'arrêt anticipé (§9). */
  knownRefs(sourceId: SourceId): Promise<Set<string>>;
  upsertOccurrences(listings: readonly NormalizedListing[]): Promise<UpsertReport>;
  allActiveOccurrences(): Promise<NormalizedListing[]>;
  /** Ids d'occurrences avec une baisse de loyer depuis `sinceIso` (§17, §31). */
  recentPriceDropIds(sinceIso: string): Promise<Set<string>>;
  saveListings(listings: readonly ScoredListing[]): Promise<UpsertReport>;
  loadSourceState(sourceId: SourceId): Promise<SourceRuntimeState>;
  saveSourceState(state: SourceRuntimeState): Promise<void>;
  recordRun(entry: CollectionRunRecord): Promise<void>;
  /** Incrémente le compteur d'absence et fait évoluer le cycle de vie (§32). */
  markMissing(
    sourceId: SourceId,
    seenRefs: ReadonlySet<string>,
    thresholds: LifecycleThresholds,
  ): Promise<void>;
  httpCache(): HttpCacheStore;
  geocodeCache(): GeocodeCacheStore;
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

        const payload = JSON.stringify({
          description: listing.description,
          imageUrls: listing.imageUrls,
          views: listing.views,
          favorites: listing.favorites,
          chargesIncluded: listing.chargesIncluded,
          contactName: listing.contact.name,
          contactFormUrl: listing.contact.formUrl,
          landlordKind: listing.contact.kind,
        });

        inserts.push({
          sql: `
            INSERT INTO occurrences (
              id, source_id, source_ref, source_url, title, price, charges, charges_included,
              area, rooms, bedrooms, property_type, furnished, flat_share, city, postal_code,
              address, latitude, longitude, contact_phone, contact_email, contact_agency,
              contact_reference, published_at, available_at, first_seen_at, last_seen_at,
              scraped_at, lifecycle, payload, content_hash, missing_runs
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
            ON CONFLICT(id) DO UPDATE SET
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
      const existing = await db.execute({
        sql: `SELECT id, content_hash FROM listings WHERE id IN (${ids.map(() => '?').join(',')})`,
        args: ids,
      });
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
      return { inserted, updated, unchanged };
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
    address: listing.address,
    city: listing.city,
    postalCode: listing.postalCode,
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
    address: text('address'),
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
