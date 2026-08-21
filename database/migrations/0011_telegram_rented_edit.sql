-- Édition « Loué » des messages Telegram (§29, §33).
--
-- Quand un bien déjà notifié passe « loué », on édite son message Telegram pour
-- le signaler. Ce drapeau évite de ré-éditer le même message à chaque collecte.
ALTER TABLE telegram_notifications ADD COLUMN edited_rented INTEGER NOT NULL DEFAULT 0;
