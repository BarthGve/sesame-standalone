-- server/rens-api/migrations/012_redaction_returning.sql
-- Complète 009 : RETURNING id sur INSERT exige SELECT (id). Sans cela POST /frs échoue
-- en « permission denied for table frs » malgré le GRANT INSERT.
BEGIN;
GRANT SELECT (id) ON frs TO rens_redaction;
COMMIT;
