-- Brouillon Gmail : marque « un brouillon a déjà été créé pour cette annonce ».
--
-- Comme notified/viewed/archived, cette colonne est écrite UNIQUEMENT hors
-- collecte (par la commande `pnpm draft`) : le upsert des fiches ne la liste
-- pas, donc elle survit aux re-collectes — un brouillon n'est créé qu'une fois.
--
-- Pas de pré-marquage (défaut 0) : la première exécution créera un brouillon
-- pour chaque annonce pertinente disposant d'un e-mail de contact.
ALTER TABLE listings ADD COLUMN drafted INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_listings_drafted ON listings (drafted);
