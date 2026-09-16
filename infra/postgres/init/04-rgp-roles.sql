-- Rôles RGP (LOGIN) : nécessaires aux GRANT des migrations 001/003.
-- Mots de passe : 02-passwords.sql. Ici : existence + droits schéma sur rgp.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rgp_api') THEN
    CREATE ROLE rgp_api LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'iaka_ro') THEN
    CREATE ROLE iaka_ro LOGIN;
  END IF;
END$$;

\connect rgp

GRANT USAGE, CREATE ON SCHEMA public TO rgp_api;
GRANT USAGE ON SCHEMA public TO iaka_ro;
