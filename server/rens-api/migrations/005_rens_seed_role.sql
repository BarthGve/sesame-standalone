-- Rôle ÉCRITURE dédié à l'alimentation nocturne (seed/nightly.mjs). Distinct de rens_api/rens_ro
-- qui restent READ-ONLY (le serveur API ne fait que des SELECT) : les écritures passent par ce
-- rôle à privilèges étroits, table-scopé, jamais par l'API. Mot de passe posé au déploiement
-- (ALTER ROLE ... PASSWORD) via variable d'environnement, jamais commité — cf. 002_roles.sql.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rens_seed') THEN
    CREATE ROLE rens_seed LOGIN;
  END IF;
END$$;

GRANT CONNECT ON DATABASE rens TO rens_seed;
GRANT USAGE ON SCHEMA public TO rens_seed;
-- Écriture LIMITÉE aux deux tables du corpus FRS (+ SELECT pour le count de contrôle).
GRANT SELECT, INSERT, DELETE ON frs, frs_mot_cle TO rens_seed;
-- nextval sur les séquences serial (INSERT ... DEFAULT).
GRANT USAGE, SELECT ON SEQUENCE frs_id_seq, frs_mot_cle_id_seq TO rens_seed;
