-- Bien loué / vendu à la source (§32, §33).
--
-- Certaines sources laissent une fiche en ligne avec un bandeau « déjà Loué ».
-- On marque alors l'annonce `rented = 1` : elle sort de la liste active et des
-- notifications, mais reste consultable si elle est en favori (carte grisée),
-- et alimente les statistiques (combien de biens se sont loués).
ALTER TABLE listings ADD COLUMN rented INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_listings_rented ON listings (rented);
