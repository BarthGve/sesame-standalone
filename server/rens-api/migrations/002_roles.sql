-- Rôles créés SANS mot de passe ici ; le mot de passe est posé au déploiement
-- (ALTER ROLE ... PASSWORD) via une variable d'environnement, jamais commité.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rens_api') THEN
    CREATE ROLE rens_api LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rens_ro') THEN
    CREATE ROLE rens_ro LOGIN;
  END IF;
END$$;

GRANT CONNECT ON DATABASE rens TO rens_api, rens_ro;
GRANT USAGE ON SCHEMA public TO rens_api, rens_ro;
GRANT SELECT ON frs, frs_mot_cle TO rens_api, rens_ro;
-- Les futures tables héritent du SELECT (utile si le schéma évolue) :
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO rens_api, rens_ro;
