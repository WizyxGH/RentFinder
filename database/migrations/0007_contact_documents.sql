-- Pièces jointes à une prise de contact (§25).
--
-- Trace LOCALE des documents que l'utilisateur a envoyés avec une candidature :
-- pour chaque contact, la liste des noms de pièces transmises, stockée en JSON.
-- Aucun envoi n'est fait par l'application (§24) — on ne fait que consigner ce
-- que l'utilisateur déclare avoir joint, pour s'en souvenir plus tard.
ALTER TABLE contact_attempts ADD COLUMN documents TEXT NOT NULL DEFAULT '[]';
