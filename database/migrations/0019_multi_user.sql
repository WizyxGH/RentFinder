-- Préparation du multi-utilisateur (décision utilisateur du 2026-09-04).
--
-- POURQUOI MAINTENANT, ALORS QU'IL N'Y A PAS ENCORE DE CONNEXION. Parce que
-- c'est le SCHÉMA qui coûte cher à changer, pas l'écran de login. Aujourd'hui
-- l'état personnel — vu, archivé, favori, statut de suivi, alerte envoyée —
-- vit dans des colonnes de `listings`, c'est-à-dire sur la fiche du logement
-- elle-même. Or une fiche est PARTAGÉE et une décision est PERSONNELLE : à
-- deux, le favori de l'un deviendrait celui de l'autre. Déplacer ces colonnes
-- plus tard, avec des données dedans, serait une migration risquée ; le faire
-- maintenant, avec un seul utilisateur, ne l'est pas.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS : aucun mot de passe, aucune session,
-- aucun écran de connexion. Le modèle actuel — un bundle statique qui parle
-- directement à Turso avec un jeton dans le navigateur — ne peut pas vérifier
-- un mot de passe : le jeton donne accès à toute la base, et un écran de
-- connexion posé devant serait contournable. La colonne `password_hash` existe
-- pour le jour où un serveur tiendra la session ; elle reste vide d'ici là, et
-- il vaut mieux qu'elle soit vide que remplie d'une illusion de sécurité (§26).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  -- Identifiant de connexion. Nul tant qu'il n'y a pas de connexion.
  login TEXT UNIQUE,
  -- Empreinte du mot de passe, JAMAIS le mot de passe. Nulle aujourd'hui : la
  -- vérification demande un serveur, qui n'existe pas encore.
  password_hash TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL
);

-- L'utilisateur par défaut, celui dont toutes les données existent déjà.
INSERT OR IGNORE INTO users (id, display_name, created_at)
VALUES ('moi', 'Moi', datetime('now'));

-- ---------------------------------------------------------------------------
-- L'état PERSONNEL d'une fiche, sorti de la fiche.
--
-- Une ligne par (utilisateur, annonce), et seulement pour les annonces sur
-- lesquelles quelqu'un a fait quelque chose : la table reste petite, là où une
-- ligne par annonce et par utilisateur en aurait fait des milliers de vides.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_user_state (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  viewed INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  tracking TEXT NOT NULL DEFAULT 'new',
  notified INTEGER NOT NULL DEFAULT 0,
  notified_at TEXT,
  drafted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_user_state_user ON listing_user_state (user_id);

-- Reprise de l'existant, pour le seul utilisateur qui existe. On ne copie que
-- les lignes qui portent VRAIMENT une décision : recopier « ni vu ni archivé ni
-- favori, statut nouveau » n'apprendrait rien et pèserait mille lignes.
INSERT OR IGNORE INTO listing_user_state (
  user_id, listing_id, viewed, archived, favorite, tracking, notified, notified_at, drafted, updated_at
)
SELECT
  'moi',
  id,
  COALESCE(viewed, 0),
  COALESCE(archived, 0),
  COALESCE(favorite, 0),
  COALESCE(tracking, 'new'),
  COALESCE(notified, 0),
  notified_at,
  COALESCE(drafted, 0),
  datetime('now')
FROM listings
WHERE COALESCE(viewed, 0) = 1
   OR COALESCE(archived, 0) = 1
   OR COALESCE(favorite, 0) = 1
   OR COALESCE(notified, 0) = 1
   OR COALESCE(drafted, 0) = 1
   OR COALESCE(tracking, 'new') <> 'new';

-- ---------------------------------------------------------------------------
-- Les autres tables qui portent du personnel.
--
-- `app_settings` contient les critères de recherche ET les recherches
-- enregistrées : deux réglages qui ne se partagent pas. La clé primaire devient
-- donc (utilisateur, clé). SQLite ne sait pas changer une clé primaire en
-- place : on recrée la table et on recopie.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings_v2 (
  user_id TEXT NOT NULL DEFAULT 'moi',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

INSERT OR IGNORE INTO app_settings_v2 (user_id, key, value, updated_at)
SELECT 'moi', key, value, updated_at FROM app_settings;

DROP TABLE IF EXISTS app_settings;
ALTER TABLE app_settings_v2 RENAME TO app_settings;

-- Le journal des contacts et les abonnements push : un ajout de colonne suffit,
-- leur clé primaire ne change pas.
ALTER TABLE contact_attempts ADD COLUMN user_id TEXT NOT NULL DEFAULT 'moi';
ALTER TABLE push_subscriptions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'moi';

-- Les colonnes d'origine de `listings` restent en place pour l'instant : le
-- code les lit encore, et les retirer dans la même migration ferait tomber
-- l'application avant que la lecture soit basculée. Elles deviennent le
-- MIROIR de `listing_user_state` pour l'utilisateur courant, et disparaîtront
-- quand il y aura plus d'un utilisateur.
