-- Réactions Telegram → favoris (§29, §33).
--
-- Quand une annonce est notifiée sur Telegram, on retient à quel MESSAGE elle
-- correspond, pour pouvoir réagir plus tard à un ❤️ posé sur ce message et
-- basculer l'annonce en favori. Tout reste local (§26) : ces tables vivent dans
-- la base SQLite de l'utilisateur, jamais dans le dépôt.

CREATE TABLE IF NOT EXISTS telegram_notifications (
  chat_id     TEXT NOT NULL,
  message_id  INTEGER NOT NULL,
  listing_id  TEXT NOT NULL,
  sent_at     TEXT NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_notif_listing ON telegram_notifications (listing_id);

-- Petit magasin clé/valeur pour l'offset de `getUpdates` (ne pas retraiter deux
-- fois les mêmes réactions).
CREATE TABLE IF NOT EXISTS telegram_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
