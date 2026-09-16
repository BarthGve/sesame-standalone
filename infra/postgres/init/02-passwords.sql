-- Mots de passe DEV LOCAUX (air-gap LAN uniquement) — pas des secrets production.
-- Alignés sur les PGPASSWORD* du docker-compose.yml.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rgp_api') THEN
    CREATE ROLE rgp_api LOGIN PASSWORD 'rgp-api-local-dev';
  ELSE
    ALTER ROLE rgp_api WITH PASSWORD 'rgp-api-local-dev';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'iaka_ro') THEN
    CREATE ROLE iaka_ro LOGIN PASSWORD 'iaka-ro-local-dev';
  ELSE
    ALTER ROLE iaka_ro WITH PASSWORD 'iaka-ro-local-dev';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rens_api') THEN
    CREATE ROLE rens_api LOGIN PASSWORD 'rens-api-local-dev';
  ELSE
    ALTER ROLE rens_api WITH PASSWORD 'rens-api-local-dev';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rens_ro') THEN
    CREATE ROLE rens_ro LOGIN PASSWORD 'rens-ro-local-dev';
  ELSE
    ALTER ROLE rens_ro WITH PASSWORD 'rens-ro-local-dev';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rens_redaction') THEN
    CREATE ROLE rens_redaction LOGIN PASSWORD 'rens-redaction-local-dev';
  ELSE
    ALTER ROLE rens_redaction WITH PASSWORD 'rens-redaction-local-dev';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rens_seed') THEN
    CREATE ROLE rens_seed LOGIN PASSWORD 'rens-seed-local-dev';
  ELSE
    ALTER ROLE rens_seed WITH PASSWORD 'rens-seed-local-dev';
  END IF;
END$$;

GRANT CONNECT ON DATABASE rgp TO rgp_api, iaka_ro;
GRANT CONNECT ON DATABASE rens TO rens_api, rens_ro, rens_redaction, rens_seed;
GRANT CONNECT ON DATABASE bdsp TO iaka_ro;
