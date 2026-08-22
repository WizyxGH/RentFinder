-- Cache des durées d'itinéraire en transports en commun (§20, §30).
--
-- Le routage transport (Navitia) est un appel réseau externe : on met en cache
-- le résultat par couple origine→destination (+ heure d'arrivée) pour ne pas le
-- refaire à chaque collecte. `minutes` peut être NULL : on mémorise aussi les
-- « aucun itinéraire trouvé » pour ne pas réinterroger inutilement.
CREATE TABLE IF NOT EXISTS transit_cache (
  key       TEXT PRIMARY KEY,
  minutes   INTEGER,
  cached_at TEXT NOT NULL
);
