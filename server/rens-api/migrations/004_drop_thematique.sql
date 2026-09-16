-- La thématique ne fait pas partie du modèle FRS (titre, date, mots-clés, unité, GGD,
-- commune, texte). On la retire ; le regroupement se fait par mots-clés.
BEGIN;
ALTER TABLE frs DROP COLUMN IF EXISTS thematique;
COMMIT;
