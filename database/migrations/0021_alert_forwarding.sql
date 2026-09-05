-- ---------------------------------------------------------------------------
-- Une adresse de transfert par compte (§6, §26).
--
-- L'IMPORT DES ALERTES NE SERVAIT QU'À UN SEUL COMPTE, et pour une raison de
-- fond : il lisait UNE boîte, celle dont le mot de passe d'application est dans
-- l'environnement du collecteur. Donner cette possibilité à chaque compte
-- aurait voulu dire ranger en base le mot de passe d'application de la boîte
-- personnelle de chacun, ce que le §26 interdit — et ce qu'aucun utilisateur
-- sensé ne devrait accepter de confier.
--
-- L'AUTRE VOIE ÉTAIT OAuth. Elle a été écartée le 2026-09-05 : elle ne couvre
-- que Gmail et Outlook, quand les boîtes des utilisateurs visés sont chez
-- laposte.net, Orange ou Free — qui n'offrent aucun OAuth. Elle demande en
-- outre une vérification annuelle payante de Google pour lire des messages,
-- faute de quoi les jetons expirent tous les sept jours : intenable pour un
-- collecteur qui tourne seul.
--
-- LE TRANSFERT NE DEMANDE AUCUN IDENTIFIANT. Chaque compte reçoit une adresse
-- qui lui est propre ; il y fait suivre ses alertes depuis sa propre boîte, par
-- une règle qu'il pose lui-même et retire quand il veut. Nous ne détenons rien
-- de lui, et il n'a pas à nous faire confiance pour cela.
--
-- LE JETON N'EST PAS UN SECRET DE CONNEXION, c'est ce qui rend l'adresse
-- indevinable : sans lui, l'adresse commune serait publique et n'importe qui
-- pourrait y déverser ce qu'il veut. Il dit aussi quel compte a transféré.
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN alert_token TEXT;

-- 9 octets = 18 caractères hexadécimaux : indevinable, et assez court pour
-- tenir dans une adresse qu'on recopie à la main sans se tromper.
UPDATE users SET alert_token = lower(hex(randomblob(9))) WHERE alert_token IS NULL;

-- Deux comptes ne peuvent pas partager une adresse : l'unicité est ce qui rend
-- le jeton exploitable comme provenance.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_alert_token ON users (alert_token);
