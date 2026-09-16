-- server/rens-api/migrations/010_referentiels.sql
-- Référentiels de rédaction FRS : GGD, unités, communes, mots-clés.
--
-- Doctrine : les listes du formulaire, la validation serveur et le cron partagent la MÊME
-- source (tables ref_*). Peuplement nominal = seed/load-referentiels.mjs (catalogue GGD /
-- unités / mots-clés + communes-fr.json COG). La réconciliation ci-dessous ne fait que
-- absorber d'anciennes fiches déjà en base (rattrapage historique), pas inventer le catalogue.
BEGIN;

CREATE TABLE IF NOT EXISTS ref_ggd (
  code             text PRIMARY KEY,           -- « GGD 49 »
  code_dept        text NOT NULL,              -- « 49 », « 2A », « 971 »
  nom_departement  text NOT NULL               -- « Maine-et-Loire »
);
CREATE INDEX IF NOT EXISTS idx_ref_ggd_dept ON ref_ggd(code_dept);

CREATE TABLE IF NOT EXISTS ref_unite (
  id        serial PRIMARY KEY,
  code_ggd  text NOT NULL REFERENCES ref_ggd(code),
  nom       text NOT NULL,                    -- « COB Segré »
  UNIQUE (code_ggd, nom)
);
CREATE INDEX IF NOT EXISTS idx_ref_unite_ggd ON ref_unite(code_ggd);

CREATE TABLE IF NOT EXISTS ref_commune (
  code_insee  text PRIMARY KEY,               -- code INSEE, ou « EXT-… » si réconcilié hors COG
  nom         text NOT NULL,
  code_dept   text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ref_commune_dept ON ref_commune(code_dept);
CREATE INDEX IF NOT EXISTS idx_ref_commune_nom  ON ref_commune(code_dept, nom);

CREATE TABLE IF NOT EXISTS ref_mot_cle (
  mot text PRIMARY KEY
);

-- Réconciliation GGD : toute combinaison déjà écrite en base devient un rattachement valide.
INSERT INTO ref_ggd (code, code_dept, nom_departement)
SELECT DISTINCT f.code_ggd,
       regexp_replace(f.code_ggd, '^GGD[[:space:]]*', ''),
       f.departement
  FROM frs f
 WHERE f.code_ggd IS NOT NULL AND f.code_ggd <> ''
ON CONFLICT (code) DO NOTHING;

-- Réconciliation unités : liées au GGD (créé juste au-dessus ou déjà présent).
INSERT INTO ref_unite (code_ggd, nom)
SELECT DISTINCT f.code_ggd, f.unite
  FROM frs f
  JOIN ref_ggd g ON g.code = f.code_ggd
 WHERE f.unite IS NOT NULL AND f.unite <> ''
ON CONFLICT (code_ggd, nom) DO NOTHING;

-- Réconciliation mots-clés : hors marqueurs techniques (vérité terrain / signaux faibles).
INSERT INTO ref_mot_cle (mot)
SELECT DISTINCT m.mot
  FROM frs_mot_cle m
 WHERE m.mot NOT LIKE 'defaut:%'
   AND m.mot NOT LIKE 'signal-faible:%'
   AND length(m.mot) <= 40
ON CONFLICT (mot) DO NOTHING;

-- Réconciliation communes absentes du COG : on les ajoute sous un code synthétique pour
-- que le formulaire et la validation puissent encore les proposer (pas de perte de
-- rattachements historiques). Les communes officielles arrivent via le seed.
INSERT INTO ref_commune (code_insee, nom, code_dept)
SELECT DISTINCT
       'EXT-' || substr(md5(f.commune || '|' || regexp_replace(f.code_ggd, '^GGD[[:space:]]*', '')), 1, 12),
       f.commune,
       regexp_replace(f.code_ggd, '^GGD[[:space:]]*', '')
  FROM frs f
 WHERE f.commune IS NOT NULL AND f.commune <> ''
   AND NOT EXISTS (
     SELECT 1 FROM ref_commune c
      WHERE c.code_dept = regexp_replace(f.code_ggd, '^GGD[[:space:]]*', '')
        AND lower(c.nom) = lower(f.commune)
   )
ON CONFLICT (code_insee) DO NOTHING;

-- Lecture seule pour les rôles d'API. Aucune écriture : les référentiels se peuplent par
-- migration / seed / réconciliation, pas par le client.
GRANT SELECT ON ref_ggd, ref_unite, ref_commune, ref_mot_cle TO rens_api;
GRANT SELECT ON ref_ggd, ref_unite, ref_commune, ref_mot_cle TO rens_ro;
GRANT USAGE, SELECT ON SEQUENCE ref_unite_id_seq TO rens_api;
GRANT USAGE, SELECT ON SEQUENCE ref_unite_id_seq TO rens_ro;

COMMIT;
