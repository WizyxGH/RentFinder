-- ---------------------------------------------------------------------------
-- Migration 0001 — schéma initial
--
-- Principes (§27, §30) :
--   * Aucune image, aucun document, aucun HTML brut n'est stocké : uniquement
--     des URLs et des données structurées.
--   * Chaque occurrence porte un `content_hash` ; une annonce inchangée n'est
--     jamais réécrite, ce qui garde la consommation dans le free tier.
--   * Les champs interrogés par le frontend sont des colonnes ; le reste vit
--     dans un JSON compact, pour éviter de multiplier les migrations.
-- ---------------------------------------------------------------------------

-- Suivi des migrations appliquées.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- État d'exécution des sources (§5, §63)
-- Le descripteur (nom, budget, fréquence) vit dans le code et reste versionné ;
-- seule la partie mouvante est persistée ici.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_state (
  source_id                  TEXT PRIMARY KEY,
  health                     TEXT NOT NULL DEFAULT 'healthy',
  last_run_at                TEXT,
  last_success_at            TEXT,
  last_429_at                TEXT,
  last_blocked_at            TEXT,
  cooldown_until             TEXT,
  consecutive_errors         INTEGER NOT NULL DEFAULT 0,
  last_new_listing_count     INTEGER NOT NULL DEFAULT 0,
  average_new_listing_count  REAL NOT NULL DEFAULT 0,
  updated_at                 TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Occurrences : une ligne par annonce et par source (§13)
-- Les annonces originales ne sont jamais supprimées, même après regroupement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS occurrences (
  id                TEXT PRIMARY KEY,          -- `${source_id}:${source_ref}`
  source_id         TEXT NOT NULL,
  source_ref        TEXT NOT NULL,
  source_url        TEXT NOT NULL,
  group_id          TEXT,                      -- logement auquel elle appartient

  title             TEXT,
  price             REAL,
  charges           REAL,
  charges_included  INTEGER,                   -- 0/1/NULL — NULL = non précisé
  area              REAL,
  rooms             INTEGER,
  bedrooms          INTEGER,
  property_type     TEXT NOT NULL DEFAULT 'unknown',
  furnished         INTEGER,                   -- 0/1/NULL

  city              TEXT,
  postal_code       TEXT,
  address           TEXT,
  latitude          REAL,
  longitude         REAL,

  contact_phone     TEXT,
  contact_email     TEXT,
  contact_agency    TEXT,
  contact_reference TEXT,

  published_at      TEXT,
  available_at      TEXT,
  first_seen_at     TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  scraped_at        TEXT NOT NULL,
  lifecycle         TEXT NOT NULL DEFAULT 'active',

  -- Champs volumineux ou rarement filtrés : description, URLs d'images,
  -- vues, favoris. §11 : uniquement des URLs, jamais de binaire.
  payload           TEXT NOT NULL DEFAULT '{}',

  -- Empreinte du contenu métier. Si elle n'a pas changé, aucune écriture
  -- n'est émise en dehors de `last_seen_at` (§30).
  content_hash      TEXT NOT NULL,

  -- Nombre de runs consécutifs sans revoir l'annonce (§32).
  missing_runs      INTEGER NOT NULL DEFAULT 0,

  UNIQUE (source_id, source_ref)
);

CREATE INDEX IF NOT EXISTS idx_occurrences_group   ON occurrences (group_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_source  ON occurrences (source_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_occurrences_phone   ON occurrences (contact_phone) WHERE contact_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_occurrences_dedupe  ON occurrences (city, area, price);

-- ---------------------------------------------------------------------------
-- Logements agrégés : ce que l'utilisateur voit, une ligne par fiche (§13)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listings (
  id                 TEXT PRIMARY KEY,
  title              TEXT,
  price              REAL,
  area               REAL,
  rooms              INTEGER,
  property_type      TEXT NOT NULL DEFAULT 'unknown',
  city               TEXT,
  postal_code        TEXT,
  latitude           REAL,
  longitude          REAL,

  published_at       TEXT,
  first_seen_at      TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL,
  lifecycle          TEXT NOT NULL DEFAULT 'active',
  tracking           TEXT NOT NULL DEFAULT 'new',

  -- Scores et distances, recalculés à chaque run mais réécrits uniquement
  -- lorsqu'ils changent réellement (§30).
  match_score        INTEGER,
  opportunity_score  INTEGER,
  visit_score        INTEGER,
  risk_score         INTEGER,
  action_priority    INTEGER,
  matches_criteria   INTEGER NOT NULL DEFAULT 0,

  -- Fiche complète sérialisée : champs fusionnés avec leur provenance,
  -- justifications des scores, distances (§15, §19).
  payload            TEXT NOT NULL DEFAULT '{}',
  content_hash       TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_priority ON listings (matches_criteria, action_priority DESC);
CREATE INDEX IF NOT EXISTS idx_listings_tracking ON listings (tracking);
CREATE INDEX IF NOT EXISTS idx_listings_seen     ON listings (last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- Journal des prises de contact (§23, §34)
-- Sert à la fois de garde-fou (un seul contact par annonce) et de base
-- statistique (§33).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_attempts (
  id               TEXT PRIMARY KEY,
  listing_id       TEXT NOT NULL,
  source_id        TEXT NOT NULL,
  channel          TEXT NOT NULL,
  trigger          TEXT NOT NULL,      -- 'manual' | 'automatic'
  sent_at          TEXT NOT NULL,
  message          TEXT NOT NULL,
  follow_up_index  INTEGER NOT NULL DEFAULT 0,
  outcome          TEXT NOT NULL DEFAULT 'pending',
  updated_at       TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES listings (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contacts_listing ON contact_attempts (listing_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_sent    ON contact_attempts (sent_at DESC);

-- ---------------------------------------------------------------------------
-- Cache HTTP conditionnel (§30)
-- Permet de répondre 304 et d'éviter de retélécharger une page inchangée.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS http_cache (
  url            TEXT PRIMARY KEY,
  etag           TEXT,
  last_modified  TEXT,
  fetched_at     TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Journal d'exécution des collectes (§62, §63)
-- Une ligne par source et par run : sert au diagnostic et à la détection
-- d'anomalies (§61).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collection_runs (
  id                TEXT PRIMARY KEY,
  source_id         TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  finished_at       TEXT NOT NULL,
  request_count     INTEGER NOT NULL DEFAULT 0,
  pages_fetched     INTEGER NOT NULL DEFAULT 0,
  listings_found    INTEGER NOT NULL DEFAULT 0,
  listings_new      INTEGER NOT NULL DEFAULT 0,
  listings_updated  INTEGER NOT NULL DEFAULT 0,
  duplicates        INTEGER NOT NULL DEFAULT 0,
  errors            INTEGER NOT NULL DEFAULT 0,
  stop_reason       TEXT NOT NULL,
  warnings          TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_runs_source ON collection_runs (source_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- Événements pour les statistiques long terme (§33)
-- Volontairement générique : on enregistre les faits maintenant afin de pouvoir
-- calculer plus tard des taux qu'on ne sait pas encore vouloir.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,     -- 'listing_discovered', 'contact_sent', ...
  listing_id  TEXT,
  source_id   TEXT,
  occurred_at TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_kind ON events (kind, occurred_at DESC);
