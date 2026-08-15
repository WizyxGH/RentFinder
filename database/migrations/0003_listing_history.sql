-- Historique des annonces (§31).
--
-- Une ligne est enregistrée UNIQUEMENT quand le loyer, la surface ou la
-- disponibilité d'une occurrence changent (plus une ligne « baseline » à la
-- première observation). On ne réécrit jamais l'historique : chaque ligne est
-- un instantané daté, ce qui permettra de mesurer les baisses de prix (§17
-- opportunité) et la trajectoire d'une annonce sans système complexe (§31).
CREATE TABLE IF NOT EXISTS listing_history (
  id            TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  source_ref    TEXT NOT NULL,
  price         REAL,
  area          REAL,
  available_at  TEXT,
  -- 'baseline' (1re observation) | 'price' | 'area' | 'availability' | 'multiple'
  change        TEXT NOT NULL,
  recorded_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_occurrence ON listing_history (occurrence_id, recorded_at);
