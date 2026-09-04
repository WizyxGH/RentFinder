-- ---------------------------------------------------------------------------
-- Les alertes n'étaient que d'une sorte (§29).
--
-- Une nouvelle annonce, et c'est tout. Or une recherche de logement a d'autres
-- moments qui méritent qu'on lève les yeux, et l'un d'eux se perdait
-- complètement : un favori qui DISPARAÎT. Il quittait la liste sans un mot, et
-- l'on continuait à espérer une réponse pour un bien déjà loué.
--
-- Chaque famille d'alerte a besoin de sa propre trace : sans elle, on
-- renotifierait la même chose à chaque passage — trente fois par jour, ce qui
-- est le meilleur moyen de faire couper les notifications.
--
-- Les trois colonnes portent une DATE et non un drapeau : savoir quand on a
-- prévenu permet de rappeler plus tard si la situation dure, là où un booléen
-- ferme la porte définitivement.
-- ---------------------------------------------------------------------------

-- Quand l'annonce est passée en favori. `updated_at` ne pouvait pas servir :
-- il bouge à chaque consultation, si bien qu'un favori déposé il y a une
-- semaine mais rouvert ce matin paraissait tout neuf.
ALTER TABLE listing_user_state ADD COLUMN favorited_at TEXT;

-- Quand on a signalé qu'un favori avait disparu de sa source.
ALTER TABLE listing_user_state ADD COLUMN gone_notified_at TEXT;

-- Quand on a rappelé qu'un favori attendait toujours une candidature.
ALTER TABLE listing_user_state ADD COLUMN reminded_at TEXT;

-- Les favoris déjà posés n'ont pas de date : on prend celle de leur dernière
-- modification, la seule dont on dispose. C'est approximatif, et c'est assumé —
-- l'alternative était de les traiter tous comme neufs, et de rappeler d'un coup
-- pour chacun d'eux.
UPDATE listing_user_state SET favorited_at = updated_at WHERE favorite = 1 AND favorited_at IS NULL;
