-- Instantané quotidien de l'inventaire, pour suivre son évolution (§33).
--
-- Ces chiffres ne sont PAS reconstituables après coup : `first_seen_at` dit
-- quand une annonce est apparue, jamais combien étaient pertinentes à une date
-- donnée — une annonce disparue depuis ne compte plus nulle part. D'où une
-- mesure écrite à chaque collecte.
--
-- Une ligne par jour, réécrite à chaque passage : plusieurs collectes
-- quotidiennes ne créent qu'un point, et c'est la dernière qui fait foi.

CREATE TABLE IF NOT EXISTS daily_stats (
  day            TEXT PRIMARY KEY,
  matching       INTEGER NOT NULL,
  uncertain      INTEGER NOT NULL,
  rented         INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  active_sources INTEGER NOT NULL,
  recorded_at    TEXT NOT NULL
);
