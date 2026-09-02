-- Abonnements Web Push (§29) : permettent d'alerter téléphone rangé, sans
-- serveur dédié — c'est la collecte planifiée qui émet.
--
-- Aucune donnée personnelle : un abonnement est une URL opaque fournie par le
-- navigateur, plus deux clés de chiffrement. Il ne dit ni qui, ni où.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  last_sent_at TEXT,
  -- Compte les échecs consécutifs : au-delà, l'abonnement est périmé (le
  -- navigateur a été désinstallé, la permission retirée) et on le supprime.
  failures    INTEGER NOT NULL DEFAULT 0
);
