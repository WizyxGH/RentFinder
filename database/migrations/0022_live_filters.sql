-- ---------------------------------------------------------------------------
-- Les filtres « colocation », « étudiant », « bailleur » et « meublé » ne
-- filtraient rien de ce qu'on regardait (§16, §66).
--
-- Ils étaient des CRITÈRES DE COLLECTE : on les évaluait une fois, au moment
-- où l'annonce entrait en base, et le résultat se figeait dans
-- `matches_criteria`. Les changer ne rejouait rien. L'utilisateur cochait
-- « exclure les colocations », refermait la modale, et voyait exactement la
-- même liste — sans le moindre message, puisque de son point de vue rien
-- n'avait échoué.
--
-- Le loyer et la surface, eux, filtraient en direct depuis le début : la modale
-- mélangeait donc deux familles de réglages qui se ressemblent, dans le même
-- écran, dont l'une agissait et l'autre pas.
--
-- POURQUOI DES COLONNES ET NON `json_extract`. Trois des quatre traits vivent
-- déjà dans le `payload` et pourraient s'y lire. Le quatrième, non : le
-- caractère étudiant se DÉDUIT du titre et de la description par une série
-- d'expressions régulières, au moment du scoring. SQLite ne sait pas les
-- rejouer. Il fallait donc le stocker — et une fois qu'on stocke celui-là,
-- stocker les trois autres à côté coûte moins cher que d'aller les chercher
-- dans du JSON à chaque requête, et se lit bien mieux.
--
-- `commute_minutes` vient avec eux : c'est le trajet le plus court vers les
-- adresses de référence, et il rend possible le tri « le plus proche ». La
-- DISTANCE en kilomètres n'est délibérément pas publiée (§26 : couplée aux
-- coordonnées de l'annonce, elle permettrait de retrouver le domicile) ; la
-- durée, elle, ne trahit rien.
--
-- TOUTES CES COLONNES SONT NULLES pour les fiches déjà en base. Elles se
-- remplissent au prochain `reprocess`, qui rejoue le scoring sur le texte
-- conservé. Un NULL ne fait jamais sortir une annonce de la liste (§17) : tant
-- que le rejeu n'a pas eu lieu, les filtres laissent passer plutôt que
-- d'écarter à tort.
-- ---------------------------------------------------------------------------

-- Colocation. NULL = la source ne le dit pas ; on ne devine pas (§17).
ALTER TABLE listings ADD COLUMN flat_share INTEGER;

-- Location réservée aux étudiants (bail 9 mois, « réservé étudiants »…).
-- Déduit du texte au scoring : c'est celui qui ne pouvait pas se lire en SQL.
ALTER TABLE listings ADD COLUMN student_only INTEGER;

-- Meublé. NULL = inconnu, et un inconnu n'est jamais écarté.
ALTER TABLE listings ADD COLUMN furnished INTEGER;

-- Nature du bailleur : 'agency', 'private', ou NULL quand elle n'est pas
-- établie. Le filtre « particuliers seuls » garde les inconnus (§17).
ALTER TABLE listings ADD COLUMN landlord_kind TEXT;

-- Trajet le plus court vers les adresses de référence, en minutes.
ALTER TABLE listings ADD COLUMN commute_minutes REAL;

-- Le tri « le plus proche » parcourt cette colonne sur toute la liste visible.
CREATE INDEX IF NOT EXISTS idx_listings_commute ON listings (commute_minutes);
