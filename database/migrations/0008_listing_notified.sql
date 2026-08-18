-- Notification Telegram : marque « annonce déjà signalée » (§29).
--
-- Comme viewed/archived/favorite, cette colonne est écrite UNIQUEMENT hors
-- collecte (par le notifieur) : le upsert des fiches ne la liste pas, donc elle
-- survit aux re-collectes et aux redémarrages — une annonce n'est notifiée
-- qu'une seule fois.
ALTER TABLE listings ADD COLUMN notified INTEGER NOT NULL DEFAULT 0;

-- Tout le stock EXISTANT est considéré déjà notifié : sans cela, la première
-- collecte après activation enverrait des centaines de messages d'un coup.
-- Seules les annonces découvertes APRÈS cette migration déclencheront un envoi.
UPDATE listings SET notified = 1;

CREATE INDEX IF NOT EXISTS idx_listings_notified ON listings (notified);
