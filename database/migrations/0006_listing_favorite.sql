-- Favori : marque personnelle « annonce mise de côté » (§35, §36).
--
-- Comme `viewed`/`archived`, cette colonne est écrite UNIQUEMENT par l'API
-- (action de l'utilisateur), jamais par la collecte : le upsert des fiches ne
-- la liste pas, donc elle survit aux re-collectes et aux redémarrages.
ALTER TABLE listings ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_listings_favorite ON listings (favorite);
