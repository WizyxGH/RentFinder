-- Retrait du canal Telegram (décision utilisateur du 2026-09-04).
--
-- POURQUOI. Telegram existait parce que la notification Web Push ne portait
-- qu'un titre et deux lignes : il fallait bien un canal qui donne la photo, le
-- téléphone et l'adresse. Le Web Push les porte désormais toutes, une alerte
-- par annonce, avec un bouton « Appeler » — les deux canaux disaient la même
-- chose, et sonnaient deux fois.
--
-- CE QUI EST PERDU, en connaissance de cause : le bouton « ⭐ Favori » sous
-- chaque message, et l'édition d'un message en « LOUÉ » quand le bien partait.
-- Le premier existe sur la notification Web Push ; le second n'a pas
-- d'équivalent, mais une annonce louée sort de la liste de toute façon (§32).
--
-- Les deux tables ne servaient qu'à ce canal : `telegram_notifications` liait
-- un message à une annonce (pour le bouton favori et l'édition), et
-- `telegram_state` gardait l'offset de lecture des interactions. Rien d'autre
-- ne les lit, et rien ne les relira.

DROP TABLE IF EXISTS telegram_notifications;
DROP TABLE IF EXISTS telegram_state;
