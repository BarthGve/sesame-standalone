BEGIN;

CREATE TABLE frs (
  id             serial PRIMARY KEY,
  date_redaction date NOT NULL,
  titre          text NOT NULL,
  unite          text NOT NULL,          -- ex. "COB Segré-en-Anjou Bleu"
  code_ggd       text NOT NULL,          -- ex. "GGD 49"
  departement    text NOT NULL,          -- ex. "Maine-et-Loire"
  thematique     text NOT NULL,          -- ex. "violences urbaines"
  texte          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_frs_date  ON frs(date_redaction);
CREATE INDEX idx_frs_ggd   ON frs(code_ggd);
CREATE INDEX idx_frs_theme ON frs(thematique);

CREATE TABLE frs_mot_cle (
  id     serial PRIMARY KEY,
  frs_id integer NOT NULL REFERENCES frs(id) ON DELETE CASCADE,
  mot    text NOT NULL,
  ordre  integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_motcle_frs ON frs_mot_cle(frs_id);
CREATE INDEX idx_motcle_mot ON frs_mot_cle(mot);

COMMIT;
