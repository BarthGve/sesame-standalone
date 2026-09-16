# Design — Perquisitions rattachées à un UNA

Date : 2026-07-10
Statut : validé (brainstorming), prêt pour plan d'implémentation

## Objectif

Permettre d'associer à un UNA (numéro de procédure, table `una` de la base
`rgp`) une ou plusieurs **perquisitions**. Une perquisition porte :

- le numéro de procédure (UNA) de rattachement ;
- l'adresse du lieu de perquisition ;
- un ou plusieurs **objets saisis**.

Le front `carte-bdsp` modélise déjà finement ce domaine (`src/features/saisies/types.ts`,
`catalogue.ts`). Cette évolution **persiste** ce modèle en base et le câble de bout en bout.

## Décisions actées (brainstorming)

| Sujet | Décision |
|---|---|
| Périmètre schéma | **Complet** — persiste tout le modèle front (`Perquisition` + `ObjetSaisi`) |
| Champs dynamiques / sous-listes | **Tables normalisées** (pas de JSONB) |
| Adresse | **Structurée** : adresse texte + code postal + FK `commune` + `latitude`/`longitude` |
| Photos objets | **MinIO (S3)** — on stocke la clé/URL, pas le binaire |
| Identifiants forts (immat, VIN, IMEI…) | **Table dédiée `objet_identifiant`** indexable (recoupement) |
| Livrable | **SQL + API + front** (chaîne complète) |
| Transport front → rgp-api | **App en local + données en ligne** : front + `proxy.mjs` sur laptop, atteignent rgp-api (OVH) via **tunnel SSH**. Pas de déploiement prod du front pour l'instant |
| Source rgp-api | **Vendorée dans ce repo** (`server/rgp-api/`) |

## Contexte infra (relevé sur OVH)

- Base `rgp` : container `brunogauville-postgres-1` (postgres:16), port hôte 5432,
  DB `rgp`, user applicatif `rgp_api`, rôle lecture seule `iaka_ro`. Données owner `n8n`.
- API `rgp-api` : container `brunogauville-rgp-api-1`, `node server.js` (http natif + `pg`),
  **aucun port publié, aucun ingress** (nginx/cloudflared). Atteinte seulement par les
  workflows n8n/IAka via le réseau docker `brunogauville_default` en `http://rgp-api:8080`.
  Auth : `Authorization: Bearer <API_TOKEN>`. Enveloppe de réponse : `{ data }` ou `{ error: { code, message } }`.
  Source serveur : `/home/brunogauville/rgp-api/` (server.js, openapi.json, Dockerfile).
- `carte-bdsp` n'est **pas** déployé sur OVH aujourd'hui (dev laptop). Front actuel : proxy
  local `server/proxy.mjs` exposant `/api/query` (carte) et `/api/identify` (saisies), tous
  deux vers IAka.
- MinIO : container `brunogauville-minio-1`, interne (9000, non publié).

## Schéma existant `rgp` (rappel)

`una(id PK, unite FK, numero, annee, synthese, type_document FK, nigend_de, urgent,
sensible, groupe FK, date_limit, date_submit, commune FK→communes.code_insee)`.
Clé métier unique `(unite, numero, annee)`. UNA affiché = `unite/numero/annee`.
`communes(code_insee PK, nom, code_postal, nom_norm)`.

## 1. Schéma DB (migration additive, base `rgp`)

Toutes les tables sont **nouvelles** — aucune table existante modifiée. `ON DELETE CASCADE`
choisi consciemment : supprimer un UNA supprime ses perquisitions, objets et sous-listes.

```sql
-- perquisition : rattachée à un UNA, 1 UNA → N perquisitions
CREATE TABLE perquisition (
  id              serial PRIMARY KEY,
  una_id          integer NOT NULL REFERENCES una(id) ON DELETE CASCADE,
  adresse         text NOT NULL,                       -- n° + voie
  code_postal     varchar(5),
  commune         varchar(5) REFERENCES communes(code_insee),
  latitude        numeric(9,6),                        -- carto (géocodage ultérieur)
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
  texte           text NOT NULL,                       -- "Grade Nom" (V1, saisie libre)
  ordre           integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_intervenant_perq ON perquisition_intervenant(perquisition_id);

CREATE TABLE perquisition_piece (
  id              serial PRIMARY KEY,
  perquisition_id integer NOT NULL REFERENCES perquisition(id) ON DELETE CASCADE,
  libelle         text NOT NULL,                       -- pièce/emplacement déclaré
  ordre           integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_piece_perq ON perquisition_piece(perquisition_id);

-- objet_saisi : 1 perquisition → N objets
CREATE TABLE objet_saisi (
  id                  serial PRIMARY KEY,
  perquisition_id     integer NOT NULL REFERENCES perquisition(id) ON DELETE CASCADE,
  categorie           text NOT NULL,                   -- CategorieCode (ARME, TRANSPORT, …)
  sous_type           text,                            -- SousTypeTransport (transport only)
  confiance           numeric,
  numero_scelle       text,
  situation           text CHECK (situation IN ('SAISI_SOUS_SCELLE','SAISI_NON_SCELLE')),
  lieu                text,                            -- lieu de découverte
  photo_url           text,                            -- clé/URL MinIO
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

-- champs dynamiques par objet (valeurs saisies, tous types confondus)
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

-- identifiants forts extraits pour recoupement
CREATE TABLE objet_identifiant (
  id          serial PRIMARY KEY,
  objet_id    integer NOT NULL REFERENCES objet_saisi(id) ON DELETE CASCADE,
  type        text NOT NULL,        -- IMMATRICULATION, VIN, NUMERO_MOTEUR, BIC, IMEI, SIM, MSISDN, NUMERO_SERIE_ARME, NUMERO_DOCUMENT, NUMERO_COMPTE, NUMERO_SERIE
  valeur      text NOT NULL,        -- valeur affichée
  valeur_norm text NOT NULL         -- normalisée (upper, sans séparateurs) pour matcher
);
CREATE INDEX idx_ident_objet ON objet_identifiant(objet_id);
CREATE INDEX idx_ident_norm ON objet_identifiant(type, valeur_norm);

-- estimation : sous-listes
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
```

### Grants (obligatoire — tables **et séquences**)

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON
  perquisition, perquisition_intervenant, perquisition_piece,
  objet_saisi, objet_champ, objet_identifiant,
  objet_estimation_source, objet_estimation_hypothese, objet_categorie_alternative
  TO rgp_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rgp_api;  -- sinon INSERT échoue

GRANT SELECT ON
  perquisition, perquisition_intervenant, perquisition_piece,
  objet_saisi, objet_champ, objet_identifiant,
  objet_estimation_source, objet_estimation_hypothese, objet_categorie_alternative
  TO iaka_ro;
```

### Audit par type d'objet — mapping `cle → type_identifiant`

Aucun trou structurel : tout champ métier de tout type est stocké par `objet_champ`
(+ `objet_saisi.sous_type` pour TRANSPORT). L'extraction d'identifiants se fait à l'insert
via cette table de correspondance (côté rgp-api) :

| Type | `cle` (catalogue) → `type_identifiant` |
|---|---|
| TRANSPORT | `nmr_immatriculation`→IMMATRICULATION · `numero_serie`→VIN · `numero_moteur`→NUMERO_MOTEUR · `numero_bic`→BIC |
| MULTIMEDIA | `imei`→IMEI · `numero_sim`→SIM · `numero_appel`→MSISDN |
| ARME | `numero`→NUMERO_SERIE_ARME |
| DOCUMENT | `numero`→NUMERO_DOCUMENT |
| MOYEN_PAIEMENT | `numero_compte`→NUMERO_COMPTE |
| Autres | `numero`→NUMERO_SERIE (si présent et non vide) |

`valeur_norm = upper(valeur)` sans espaces ni séparateurs `-`/`.`/`/` (ex. `ab-123-cd` → `AB123CD`).

## 2. API rgp-api (endpoints)

Suit les conventions existantes de `server.js` : http natif, routing par `if` sur
`pathname`/`method`, auth `Bearer`, enveloppe `{ data }` / `{ error:{ code, message } }`,
allocation transactionnelle. Une perquisition + ses objets s'écrit dans **une transaction**.

- `POST /perquisition` — crée une perquisition et ses objets.
  Body : identité UNA (`una` = "unite/numero/annee" **ou** `una_id`) + `adresse`,
  `code_postal`, `commune` (code INSEE ou nom, résolu via `resolveCommune` existant),
  `latitude?`, `longitude?`, `type_lieu?`, `perquisitionne?`, `opj?`, `date_debut?`,
  `intervenants?: string[]`, `pieces?: string[]`, `objets: ObjetSaisiInput[]`.
  Chaque objet : `categorie`, `sous_type?`, `confiance?`, `numero_scelle?`, `situation?`,
  `lieu?`, `photo_url?`, `estimation?`, `champs: {cle,libelle,valeur,source,obligatoire}[]`,
  `categoriesAlternatives?`. Les identifiants sont dérivés des `champs` (mapping ci-dessus).
  Réponse : perquisition créée (avec `id`, objets, identifiants extraits).
- `GET /perquisitions?una=unite/numero/annee` (ou `?una_id=`) — liste les perquisitions
  d'un UNA (résumé : id, adresse, commune, nb objets, date).
- `GET /perquisition?id=` — détail complet (perquisition + objets + champs + identifiants + estimation).
- `GET /objets/recherche?identifiant=AB-123-CD[&type=IMMATRICULATION]` — recoupement :
  cherche via `objet_identifiant.valeur_norm`, retourne objets + perquisition + UNA.

`openapi.json` mis à jour en conséquence.

## 3. Front + proxy + transport

### Transport (API privée, app en local)

Périmètre actuel : **données en ligne (OVH), app en local**. Le front et `server/proxy.mjs`
tournent sur le laptop ; rgp-api reste privé sur OVH. Le proxy l'atteint via **tunnel SSH** :

- rgp-api n'a pas de port publié → on publie temporairement son port ou on tunnelise vers
  l'IP du container. Le plus simple : ouvrir un port hôte sur rgp-api (bind localhost OVH)
  puis `ssh -L 8080:localhost:8080 ovh`, **ou** tunnel direct vers l'IP docker du container.
  Le plan d'implémentation figera la commande exacte.
- `proxy.mjs` lit `RGP_API_URL` (dev = `http://localhost:8080`) et `RGP_API_TOKEN`.
  Le token reste **côté serveur** (proxy), jamais dans le navigateur.

Le déploiement prod du front (container OVH même réseau, accès direct `http://rgp-api:8080`)
est **hors périmètre** pour l'instant — voir Points ouverts.

### proxy.mjs

Nouvelles routes, forwardées vers rgp-api avec le Bearer token (config étendue :
`rgpApiUrl`, `rgpApiToken`) :

- `POST /api/perquisition` → `POST {RGP_API_URL}/perquisition`
- `GET /api/perquisitions?...` → `GET {RGP_API_URL}/perquisitions?...`
- `GET /api/perquisition?id=` → `GET {RGP_API_URL}/perquisition?id=`
- `GET /api/objets/recherche?...` → passthrough

Le handler actuel ne gère que POST `/api/query|identify` ; on étend le routing pour
GET et les nouveaux chemins.

### Front (SaisiesApp)

Le wizard produit déjà `Perquisition` + `ObjetSaisi[]` en mémoire. Ajouts :

- Client `src/features/saisies/perquisitionApi.ts` : `savePerquisition(payload)` →
  `POST /api/perquisition` ; mapping modèle front → payload API.
- Bouton « Enregistrer la perquisition » en fin de wizard (état succès/erreur).
- Sélecteur/saisie de l'UNA de rattachement (réutilise l'endpoint `/procedures` existant
  de rgp-api si besoin, via une route proxy `GET /api/procedures`).

## 4. Photos → MinIO (phase finale, la moins critique)

MinIO interne (9000). Flux : front envoie l'image (base64) au proxy → proxy uploade vers
MinIO (SDK S3, credentials côté serveur) → obtient une clé → l'inclut comme `photo_url`
dans le payload `/perquisition`. Bucket dédié (ex. `perquisitions`). Reachability : mêmes
contraintes que rgp-api (co-localisation prod / tunnel dev). **Ne bloque pas les phases 1-3.**

## Phasage (chaque phase livrable et vérifiable seule)

1. **Migration SQL** — indépendante, testée via `psql` sur OVH (tables + grants + séquences).
2. **Endpoints rgp-api** — dépend de 1 ; suit l'enveloppe `{data}`/`{error}` + Bearer.
   rgp-api d'abord vendoré dans `server/rgp-api/`, puis modifié en diff relisible.
3. **Front + proxy + transport** — routes proxy, client front, bouton d'enregistrement,
   tunnel SSH dev. (App tourne en local, données en ligne.)
4. **MinIO photos** — en dernier.

## Points ouverts / à confirmer plus tard

- **Déploiement prod de `carte-bdsp` sur OVH** (Dockerfile + service compose, réseau
  `brunogauville_default`, accès direct `http://rgp-api:8080`) — **hors périmètre actuel**.
  À faire quand on passera de « app en local » à « app en ligne ».
- Géocodage adresse → `latitude`/`longitude` (source : BAN / API adresse) — colonnes prêtes,
  alimentation à cadrer.
- Modélisation fine des intervenants (`role`/`grade`/`nom`) — V1 en texte libre `Grade Nom`.
