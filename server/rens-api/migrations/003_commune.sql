-- Ajoute la commune de relevé du renseignement à chaque FRS.
BEGIN;
ALTER TABLE frs ADD COLUMN IF NOT EXISTS commune text;
CREATE INDEX IF NOT EXISTS idx_frs_commune ON frs(commune);
COMMIT;
