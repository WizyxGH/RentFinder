-- Réglages de l'application, partagés entre le site et la collecte (§66).
--
-- POURQUOI EN BASE. Les critères de recherche vivaient dans `config/search.json`,
-- sur la machine de collecte. Le site déployé, qui parle directement à Turso et
-- n'a aucun accès à ce fichier, ne pouvait donc que les AFFICHER : l'écran
-- « Critères de recherche » refusait tout enregistrement. Les mettre ici les
-- rend modifiables depuis le téléphone, et la collecte les relit au run suivant.
--
-- Le fichier reste la valeur par défaut : ce qui est en base le surcharge, et
-- une base vide se comporte exactement comme avant.
--
-- Aucune donnée personnelle : un budget, une surface, des exclusions.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  -- Valeur sérialisée en JSON : une seule table pour tous les réglages, plutôt
  -- qu'une colonne par critère à migrer à chaque ajout.
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
