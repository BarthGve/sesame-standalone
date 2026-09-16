-- server/rens-api/migrations/006_audit.sql
-- Contrôle qualité GIPASP. Les 3 colonnes frs sont NULLables VOLONTAIREMENT :
-- « motif absent » est un défaut à détecter, un NOT NULL le rendrait indémontrable.
BEGIN;

ALTER TABLE frs ADD COLUMN motif          text;
ALTER TABLE frs ADD COLUMN date_evenement date;
ALTER TABLE frs ADD COLUMN origine_info   text;
CREATE INDEX idx_frs_date_evt ON frs(date_evenement);

CREATE TABLE frs_audit_run (
  id              serial PRIMARY KEY,
  jour            date NOT NULL UNIQUE,
  lance_a         timestamptz NOT NULL DEFAULT now(),
  termine_a       timestamptz,
  statut          text NOT NULL DEFAULT 'en_cours',
  total_fiches    integer NOT NULL DEFAULT 0,
  fragments_total integer NOT NULL DEFAULT 0,
  fragments_ok    integer NOT NULL DEFAULT 0,
  taille_fragment integer NOT NULL
);

CREATE TABLE frs_audit_fragment (
  id      serial PRIMARY KEY,
  run_id  integer NOT NULL REFERENCES frs_audit_run(id) ON DELETE CASCADE,
  rang    integer NOT NULL,
  frs_ids integer[] NOT NULL,
  statut  text NOT NULL DEFAULT 'en_attente',
  erreur  text,
  UNIQUE (run_id, rang)
);

CREATE TABLE frs_audit (
  id          serial PRIMARY KEY,
  run_id      integer NOT NULL REFERENCES frs_audit_run(id) ON DELETE CASCADE,
  frs_id      integer NOT NULL REFERENCES frs(id) ON DELETE CASCADE,
  critere     text NOT NULL,
  gravite     text NOT NULL,
  source      text NOT NULL,
  fondement   text,
  extrait     text,
  explication text,
  confiance   text,
  UNIQUE (run_id, frs_id, critere)
);
CREATE INDEX idx_audit_run ON frs_audit(run_id);
CREATE INDEX idx_audit_frs ON frs_audit(frs_id);

COMMIT;
