-- ---------------------------------------------------------------------------
-- Retrouver l'accès à son compte quand on a oublié son mot de passe (§26).
--
-- IL N'Y AVAIT AUCUN RECOURS. Un mot de passe perdu, c'était un compte perdu :
-- ses favoris, son suivi, ses pièces déposées et sa recherche enregistrée avec.
-- Le seul remède demandait quelqu'un ayant accès à la base et à un script.
--
-- DEUX CHOSES MANQUAIENT, et la seconde n'était pas évidente : une table de
-- jetons, mais surtout une ADRESSE À QUI ÉCRIRE. Un compte n'avait qu'un
-- identifiant de connexion. On ne pouvait donc joindre personne.
--
-- LE JETON N'EST PAS STOCKÉ, seule son empreinte l'est. Une base qui fuite ne
-- doit pas livrer des laissez-passer utilisables : c'est la même règle que pour
-- les mots de passe, et elle vaut ici pour la même raison. Le jeton en clair
-- n'existe que dans le lien envoyé, et nulle part ailleurs.
--
-- IL EXPIRE, ET NE SERT QU'UNE FOIS. Une heure suffit largement à relever ses
-- messages, et un lien qui traîne dans une boîte des années durant est une
-- porte laissée ouverte. `used_at` ferme la porte derrière soi : sans lui, le
-- même lien rouvrirait le compte à qui remettrait la main sur l'e-mail.
-- ---------------------------------------------------------------------------

-- L'adresse du compte. NULLE tant qu'elle n'est pas renseignée : sans elle, la
-- réinitialisation n'a nulle part où écrire, et l'écran le dit plutôt que de
-- laisser croire qu'un message est parti (§17).
ALTER TABLE users ADD COLUMN email TEXT;

CREATE TABLE IF NOT EXISTS password_resets (
  -- Empreinte SHA-256 du jeton, jamais le jeton lui-même.
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- Renseigné à l'usage : un jeton ne vaut que pour une seule remise à zéro.
  used_at    TEXT
);

-- Sert à deux choses : retrouver les demandes en cours d'un compte pour les
-- annuler quand une nouvelle arrive, et purger les périmées.
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);
