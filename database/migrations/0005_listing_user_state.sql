-- État utilisateur d'une annonce : consultée et archivée.
--
-- « viewed »   : posé AUTOMATIQUEMENT à l'ouverture de la fiche.
-- « archived » : posé MANUELLEMENT ; retire l'annonce de la liste principale
--                sans la perdre (on peut toujours l'afficher).
--
-- Ces colonnes sont écrites UNIQUEMENT par l'API (action de l'utilisateur),
-- jamais par la collecte : le upsert des fiches ne les liste pas, donc elles
-- gardent leur valeur d'un run à l'autre (comme `tracking`). Elles survivent
-- ainsi aux redémarrages et aux re-collectes.
ALTER TABLE listings ADD COLUMN viewed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_listings_archived ON listings (archived);
