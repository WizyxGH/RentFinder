-- Historique des notifications (§29).
--
-- `notified` disait SI une annonce avait été signalée, jamais QUAND. La page
-- Notifications ne pouvait donc rien montrer du passé : elle comparait la
-- liste courante à une mémoire du navigateur, perdue au premier nettoyage et
-- vide sur un autre appareil.
--
-- Les annonces déjà notifiées gardent `NULL` : la date est inconnue et ne
-- s'invente pas (§17). L'historique commence donc à cette migration.
ALTER TABLE listings ADD COLUMN notified_at TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_notified_at
  ON listings (notified_at)
  WHERE notified_at IS NOT NULL;
