-- Table compagnon du lieu du fait (classé par l'agent à la création, ou par un
-- job d'enrichissement LLM pour l'existant). Évite d'ALTER una (droit non accordé).
-- Voir docs/rgp-enrichissement-lieu.md.
BEGIN;

CREATE TABLE una_lieu (
  id           serial PRIMARY KEY,
  una_id       integer NOT NULL REFERENCES una(id) ON DELETE CASCADE,
  -- Phase 1 : classification (toujours renseignée quand un indice de lieu existe)
  type_lieu    text CHECK (type_lieu IN
                 ('LOCAL_PRO','HABITATION','LIEU_PUBLIC','VEHICULE','INDETERMINE')),
  confiance    numeric,                    -- confiance de classification 0.0-1.0
  extrait      text,                       -- citation de synthese justifiant
  -- Phase 2 : géolocalisation (optionnelle, NULL tant que non géocodé — BAN)
  adresse_norm text,
  code_postal  varchar(5),
  commune      varchar(5) REFERENCES communes(code_insee),
  latitude     numeric(9,6),
  longitude    numeric(9,6),
  ban_score    numeric,                    -- qualité géocodage BAN 0.0-1.0
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_una_lieu_una  ON una_lieu(una_id);
CREATE INDEX idx_una_lieu_type ON una_lieu(type_lieu);

GRANT SELECT, INSERT, UPDATE, DELETE ON una_lieu TO rgp_api;
GRANT USAGE, SELECT ON SEQUENCE una_lieu_id_seq TO rgp_api;
GRANT SELECT ON una_lieu TO iaka_ro;

COMMIT;
