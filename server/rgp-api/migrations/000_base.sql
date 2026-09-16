-- Schéma RGP de base (référentiels + una). IF NOT EXISTS : OVH les a déjà.
BEGIN;

CREATE TABLE IF NOT EXISTS unite (
  code        int PRIMARY KEY,
  description text
);

CREATE TABLE IF NOT EXISTS type_document (
  id          int PRIMARY KEY,
  libelle     text,
  description text
);

CREATE TABLE IF NOT EXISTS groupe (
  id      int PRIMARY KEY,
  libelle text
);

CREATE TABLE IF NOT EXISTS communes (
  code_insee  varchar(5) PRIMARY KEY,
  nom         text,
  code_postal varchar(5),
  nom_norm    text
);

CREATE TABLE IF NOT EXISTS una (
  id            serial PRIMARY KEY,
  unite         int,
  numero        int,
  annee         int,
  type_document int,
  groupe        int,
  synthese      text,
  urgent        bool,
  sensible      bool,
  commune       varchar(5),
  nigend_de     text,
  date_limit    timestamptz,
  date_submit   timestamptz,
  UNIQUE (unite, numero, annee)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rgp_api') THEN
    CREATE ROLE rgp_api LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'iaka_ro') THEN
    CREATE ROLE iaka_ro LOGIN;
  END IF;
END$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  unite, type_document, groupe, communes, una
  TO rgp_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rgp_api;

GRANT SELECT ON
  unite, type_document, groupe, communes, una
  TO iaka_ro;

COMMIT;
