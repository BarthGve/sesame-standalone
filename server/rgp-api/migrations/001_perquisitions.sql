BEGIN;

CREATE TABLE perquisition (
  id              serial PRIMARY KEY,
  una_id          integer NOT NULL REFERENCES una(id) ON DELETE CASCADE,
  adresse         text NOT NULL,
  code_postal     varchar(5),
  commune         varchar(5) REFERENCES communes(code_insee),
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  type_lieu       text CHECK (type_lieu IN ('DOMICILE','LOCAL_PRO','VEHICULE','AUTRE')),
  perquisitionne  text,
  opj             text,
  date_debut      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_perquisition_una ON perquisition(una_id);

CREATE TABLE perquisition_intervenant (
  id              serial PRIMARY KEY,
  perquisition_id integer NOT NULL REFERENCES perquisition(id) ON DELETE CASCADE,
  texte           text NOT NULL,
  ordre           integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_intervenant_perq ON perquisition_intervenant(perquisition_id);

CREATE TABLE perquisition_piece (
  id              serial PRIMARY KEY,
  perquisition_id integer NOT NULL REFERENCES perquisition(id) ON DELETE CASCADE,
  libelle         text NOT NULL,
  ordre           integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_piece_perq ON perquisition_piece(perquisition_id);

CREATE TABLE objet_saisi (
  id                  serial PRIMARY KEY,
  perquisition_id     integer NOT NULL REFERENCES perquisition(id) ON DELETE CASCADE,
  categorie           text NOT NULL,
  sous_type           text,
  confiance           numeric,
  numero_scelle       text,
  situation           text CHECK (situation IN ('SAISI_SOUS_SCELLE','SAISI_NON_SCELLE')),
  lieu                text,
  photo_url           text,
  estim_prix_bas      numeric,
  estim_prix_moyen    numeric,
  estim_prix_haut     numeric,
  estim_devise        text,
  estim_confiance     numeric,
  estim_avertissement text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_objet_perq ON objet_saisi(perquisition_id);
CREATE INDEX idx_objet_categorie ON objet_saisi(categorie);

CREATE TABLE objet_champ (
  id          serial PRIMARY KEY,
  objet_id    integer NOT NULL REFERENCES objet_saisi(id) ON DELETE CASCADE,
  cle         text NOT NULL,
  libelle     text NOT NULL,
  valeur      text,
  source      text CHECK (source IN ('deduit','a_completer')),
  obligatoire boolean NOT NULL DEFAULT false,
  ordre       integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_champ_objet ON objet_champ(objet_id);

CREATE TABLE objet_identifiant (
  id          serial PRIMARY KEY,
  objet_id    integer NOT NULL REFERENCES objet_saisi(id) ON DELETE CASCADE,
  type        text NOT NULL,
  valeur      text NOT NULL,
  valeur_norm text NOT NULL
);
CREATE INDEX idx_ident_objet ON objet_identifiant(objet_id);
CREATE INDEX idx_ident_norm ON objet_identifiant(type, valeur_norm);

CREATE TABLE objet_estimation_source (
  id       serial PRIMARY KEY,
  objet_id integer NOT NULL REFERENCES objet_saisi(id) ON DELETE CASCADE,
  site     text,
  url      text,
  prix     numeric,
  ordre    integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_estsource_objet ON objet_estimation_source(objet_id);

CREATE TABLE objet_estimation_hypothese (
  id       serial PRIMARY KEY,
  objet_id integer NOT NULL REFERENCES objet_saisi(id) ON DELETE CASCADE,
  texte    text NOT NULL,
  ordre    integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_esthyp_objet ON objet_estimation_hypothese(objet_id);

CREATE TABLE objet_categorie_alternative (
  id        serial PRIMARY KEY,
  objet_id  integer NOT NULL REFERENCES objet_saisi(id) ON DELETE CASCADE,
  categorie text NOT NULL,
  confiance numeric
);
CREATE INDEX idx_altcat_objet ON objet_categorie_alternative(objet_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  perquisition, perquisition_intervenant, perquisition_piece,
  objet_saisi, objet_champ, objet_identifiant,
  objet_estimation_source, objet_estimation_hypothese, objet_categorie_alternative
  TO rgp_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rgp_api;

GRANT SELECT ON
  perquisition, perquisition_intervenant, perquisition_piece,
  objet_saisi, objet_champ, objet_identifiant,
  objet_estimation_source, objet_estimation_hypothese, objet_categorie_alternative
  TO iaka_ro;

COMMIT;
