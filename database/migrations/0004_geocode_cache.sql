-- Cache de géocodage (§20, §30).
--
-- Le géocodage transforme une adresse en coordonnées via l'API officielle de
-- la Base Adresse Nationale. On met le résultat en cache : une adresse déjà
-- géocodée ne redéclenche jamais d'appel réseau (une adresse ne bouge pas).
-- `lat`/`lon` valent NULL quand la BAN n'a pas su géocoder — on mémorise aussi
-- l'échec pour ne pas réessayer en boucle.
CREATE TABLE IF NOT EXISTS geocode_cache (
  query       TEXT PRIMARY KEY,
  lat         REAL,
  lon         REAL,
  geocoded_at TEXT NOT NULL
);
