-- Colocation (§17 : tri-état) : 1 = proposé en colocation, 0 = logement
-- entier, NULL = la source ne le précise pas.
ALTER TABLE occurrences ADD COLUMN flat_share INTEGER;
