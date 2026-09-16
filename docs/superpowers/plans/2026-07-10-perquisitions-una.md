# Perquisitions rattachées à un UNA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persister en base `rgp` une ou plusieurs perquisitions rattachées à un UNA (adresse + objets saisis), exposer des endpoints rgp-api, et permettre au front (en local) de les enregistrer.

**Architecture:** Migration SQL additive (9 tables normalisées) sur la base `rgp` en ligne. Endpoints ajoutés à `rgp-api` (http natif + `pg`), source vendorée dans ce repo. Le proxy local `server/proxy.mjs` forwarde vers rgp-api via un tunnel SSH (app en local, données en ligne). Front : client + bouton d'enregistrement.

**Tech Stack:** PostgreSQL 16, Node.js (http natif + `pg`) pour rgp-api, Node ESM pour proxy, React + Vite + Vitest pour le front, `node:test` pour rgp-api.

## Global Constraints

- **INTERDIT : emoji dans le front** (CLAUDE.md). Icônes = Material Icons (composant `Icon`) ou SVG.
- Base `rgp` : container `brunogauville-postgres-1`, DB `rgp`. Superuser (owner) : `n8n` / `<PG_OWNER_PASSWORD>`. User applicatif : `rgp_api` / `<RGP_API_PASSWORD>`. Lecture seule : `iaka_ro`.
- rgp-api : token `Authorization: Bearer <RGP_API_TOKEN>`. Enveloppe réponse : `{ data }` ou `{ error: { code, message } }`. **`err()` renvoie toujours HTTP 200** avec le corps `{error}` — conserver ce comportement.
- Migration = **additive uniquement** (aucune table existante modifiée). CREATE TABLE + GRANT exécutés en tant que `n8n` (owner), pas `rgp_api`.
- Accès OVH : `ssh ovh`. Container postgres : `brunogauville-postgres-1`. Container API : `brunogauville-rgp-api-1`. Source API serveur : `/home/brunogauville/rgp-api/`. Compose : `/home/brunogauville/docker-compose.yml`.
- Spec de référence : `docs/superpowers/specs/2026-07-10-perquisitions-una-design.md`.

---

## File Structure

- `server/rgp-api/` (nouveau, vendoré depuis OVH) : `server.js`, `perquisition.js` (nouveau), `perquisition.test.js` (nouveau), `package.json`, `Dockerfile`, `openapi.json`, `migrations/001_perquisitions.sql` (nouveau).
- `server/proxy.mjs` (modifié) : forward des routes `/api/perquisition*`, `/api/objets/recherche`, `/api/procedures` vers rgp-api.
- `server/proxy.test.mjs` (nouveau) : test du routing/forward.
- `src/features/saisies/perquisitionApi.ts` (nouveau) : client + mapping modèle→payload.
- `src/features/saisies/perquisitionApi.test.ts` (nouveau).
- `src/features/saisies/types.ts` (modifié) : `una?` sur `Perquisition`.
- `src/features/saisies/SaisiesApp.tsx` (modifié) : champ UNA + bouton « Enregistrer la perquisition ».
- `scripts/tunnel-rgp.sh` (nouveau) : ouvre le tunnel SSH vers rgp-api.
- `.env`, `.env.example` (modifiés) : `RGP_API_URL`, `RGP_API_TOKEN`.

---

### Task 1: Vendorer la source rgp-api dans le repo

**Files:**
- Create: `server/rgp-api/{server.js,package.json,Dockerfile,openapi.json}` (copiés depuis OVH)

**Interfaces:**
- Produces: base rgp-api relisible en version control pour les Tasks 2-7.

- [ ] **Step 1: Copier la source depuis OVH**

```bash
cd /Users/brunogauville/Developpeur/XP-IAka/carte-bdsp
mkdir -p server/rgp-api
scp ovh:/home/brunogauville/rgp-api/server.js server/rgp-api/server.js
scp ovh:/home/brunogauville/rgp-api/package.json server/rgp-api/package.json
scp ovh:/home/brunogauville/rgp-api/Dockerfile server/rgp-api/Dockerfile
scp ovh:/home/brunogauville/rgp-api/openapi.json server/rgp-api/openapi.json
```

- [ ] **Step 2: Vérifier le contenu**

Run: `ls -la server/rgp-api && head -5 server/rgp-api/server.js`
Expected: 4 fichiers ; `server.js` commence par `const http = require('http');`

- [ ] **Step 3: Commit**

```bash
git add server/rgp-api
git commit -m "chore(rgp-api): vendorer la source depuis OVH (base relisible)"
```

---

### Task 2: Migration SQL — tables + grants, appliquée en ligne

**Files:**
- Create: `server/rgp-api/migrations/001_perquisitions.sql`

**Interfaces:**
- Produces: tables `perquisition`, `perquisition_intervenant`, `perquisition_piece`, `objet_saisi`, `objet_champ`, `objet_identifiant`, `objet_estimation_source`, `objet_estimation_hypothese`, `objet_categorie_alternative` dans la base `rgp`, avec grants `rgp_api` (CRUD + séquences) et `iaka_ro` (SELECT).

- [ ] **Step 1: Écrire la migration**

Create `server/rgp-api/migrations/001_perquisitions.sql` :

```sql
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
```

- [ ] **Step 2: Appliquer la migration en ligne (en tant que n8n)**

```bash
cat server/rgp-api/migrations/001_perquisitions.sql | \
  ssh ovh 'docker exec -e PGPASSWORD=<PG_OWNER_PASSWORD> -i brunogauville-postgres-1 psql -U n8n -d rgp -v ON_ERROR_STOP=1 -f -'
```

Expected: suite de `CREATE TABLE` / `CREATE INDEX` / `GRANT` / `COMMIT`, aucune erreur.

- [ ] **Step 3: Vérifier tables + grants (via rgp_api applicatif)**

```bash
ssh ovh 'docker exec -e PGPASSWORD=<RGP_API_PASSWORD> brunogauville-postgres-1 \
  psql -U rgp_api -d rgp -c "\dt perquisition*" -c "\dt objet_*" \
  -c "INSERT INTO perquisition (una_id, adresse) SELECT id, '\''__probe__'\'' FROM una LIMIT 1 RETURNING id;" \
  -c "DELETE FROM perquisition WHERE adresse='\''__probe__'\'';"'
```

Expected: liste des 9 tables ; l'INSERT retourne un `id` (prouve grant table + séquence) ; DELETE OK. Si `permission denied for sequence` → le GRANT séquences a échoué, corriger.

- [ ] **Step 4: Commit**

```bash
git add server/rgp-api/migrations/001_perquisitions.sql
git commit -m "feat(rgp-db): migration perquisitions + objets saisis (9 tables, grants)"
```

---

### Task 3: Module perquisition.js — logique pure + fonctions DB

**Files:**
- Create: `server/rgp-api/perquisition.js`
- Create: `server/rgp-api/perquisition.test.js`
- Modify: `server/rgp-api/package.json` (script test)

**Interfaces:**
- Produces (CommonJS exports) :
  - `normalizeIdent(v: string): string`
  - `extractIdentifiants(categorie: string, champs: {cle,valeur}[]): {type,valeur,valeur_norm}[]`
  - `createPerquisition(pool, body): Promise<{code, data?}|{code, error:{code,message}}>`
  - `getPerquisition(pool, id): Promise<{code, data?}|{code, error}>`
  - `listPerquisitions(pool, searchParams): Promise<{code, data?}|{code, error}>`
  - `searchObjets(pool, searchParams): Promise<{code, data?}|{code, error}>`
- Consumes : un `pool`/`client` `pg` avec `.query`, la base de la Task 2.

- [ ] **Step 1: Écrire les tests des fonctions pures**

Create `server/rgp-api/perquisition.test.js` :

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeIdent, extractIdentifiants } = require('./perquisition');

test('normalizeIdent : majuscules, sépérateurs retirés', () => {
  assert.strictEqual(normalizeIdent('ab-123 cd'), 'AB123CD');
  assert.strictEqual(normalizeIdent(' vf1.234/56 '), 'VF123456');
  assert.strictEqual(normalizeIdent(null), '');
});

test('extractIdentifiants : mapping TRANSPORT', () => {
  const champs = [
    { cle: 'nmr_immatriculation', valeur: 'AB-123-CD' },
    { cle: 'numero_serie', valeur: 'VF1234567' },
    { cle: 'couleur', valeur: 'rouge' },
  ];
  assert.deepStrictEqual(extractIdentifiants('TRANSPORT', champs), [
    { type: 'IMMATRICULATION', valeur: 'AB-123-CD', valeur_norm: 'AB123CD' },
    { type: 'VIN', valeur: 'VF1234567', valeur_norm: 'VF1234567' },
  ]);
});

test('extractIdentifiants : fallback numero -> NUMERO_SERIE pour catégorie non mappée', () => {
  assert.deepStrictEqual(extractIdentifiants('BIJOU', [{ cle: 'numero', valeur: 'X9' }]),
    [{ type: 'NUMERO_SERIE', valeur: 'X9', valeur_norm: 'X9' }]);
});

test('extractIdentifiants : valeurs vides ignorées', () => {
  assert.deepStrictEqual(extractIdentifiants('MULTIMEDIA', [{ cle: 'imei', valeur: '' }]), []);
});

test('extractIdentifiants : numero non mappé si catégorie a déjà un mapping', () => {
  // ARME mappe numero -> NUMERO_SERIE_ARME (pas le fallback générique)
  assert.deepStrictEqual(extractIdentifiants('ARME', [{ cle: 'numero', valeur: 'A1' }]),
    [{ type: 'NUMERO_SERIE_ARME', valeur: 'A1', valeur_norm: 'A1' }]);
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `cd server/rgp-api && node --test`
Expected: FAIL — `Cannot find module './perquisition'`.

- [ ] **Step 3: Écrire le module**

Create `server/rgp-api/perquisition.js` :

```js
// perquisition.js — logique perquisitions/objets saisis pour rgp-api.
// Fonctions pures (normalizeIdent, extractIdentifiants) testables sans DB ;
// fonctions DB prennent un pool/client pg (.query) déjà prêt.

// Mapping cle de champ (catalogue front) -> type d'identifiant fort, par catégorie.
const IDENT_MAP = {
  TRANSPORT: { nmr_immatriculation: 'IMMATRICULATION', numero_serie: 'VIN', numero_moteur: 'NUMERO_MOTEUR', numero_bic: 'BIC' },
  MULTIMEDIA: { imei: 'IMEI', numero_sim: 'SIM', numero_appel: 'MSISDN' },
  ARME: { numero: 'NUMERO_SERIE_ARME' },
  DOCUMENT: { numero: 'NUMERO_DOCUMENT' },
  MOYEN_PAIEMENT: { numero_compte: 'NUMERO_COMPTE' },
};

function normalizeIdent(v) {
  return String(v ?? '').toUpperCase().replace(/[\s.\-/]/g, '');
}

function extractIdentifiants(categorie, champs) {
  const map = IDENT_MAP[categorie] || {};
  const hasMap = !!IDENT_MAP[categorie];
  const out = [];
  for (const c of champs || []) {
    const val = c && c.valeur != null ? String(c.valeur).trim() : '';
    if (!val) continue;
    let type = map[c.cle];
    if (!type && !hasMap && c.cle === 'numero') type = 'NUMERO_SERIE';
    if (!type) continue;
    out.push({ type, valeur: val, valeur_norm: normalizeIdent(val) });
  }
  return out;
}

function fold(v) {
  return typeof v === 'string' ? v.normalize('NFD').replace(/[̀-ͯ]/g, '') : (v == null ? '' : v);
}

async function resolveCommuneCode(q, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { code: null };
  if (/^(\d{5}|2[ab]\d{3})$/i.test(s)) {
    const r = await q.query('SELECT code_insee FROM communes WHERE code_insee = upper($1)', [s]);
    return r.rows.length ? { code: r.rows[0].code_insee } : { error: { code: 'commune_inconnue', message: `Commune "${s}" inconnue` } };
  }
  const r = await q.query('SELECT code_insee FROM communes WHERE nom_norm = $1', [fold(s).toLowerCase()]);
  if (r.rows.length === 1) return { code: r.rows[0].code_insee };
  if (r.rows.length > 1) return { error: { code: 'commune_ambigue', message: `Commune "${s}" ambiguë` } };
  return { error: { code: 'commune_inconnue', message: `Commune "${s}" inconnue` } };
}

async function resolveUnaId(q, body) {
  const idRaw = body.una_id;
  if (idRaw != null && /^\d+$/.test(String(idRaw))) {
    const r = await q.query('SELECT id FROM una WHERE id=$1', [parseInt(idRaw, 10)]);
    return r.rows.length ? { id: r.rows[0].id } : { error: { code: 'una_inconnu', message: `UNA id ${idRaw} introuvable` } };
  }
  const combo = String(body.una || body.pv || '').trim();
  const parts = combo.split('/');
  if (parts.length !== 3) return { error: { code: 'bad_request', message: 'UNA requis : "unite/numero/annee" ou una_id' } };
  const [u, n, a] = parts.map((x) => parseInt(x, 10));
  if (![u, n, a].every(Number.isInteger)) return { error: { code: 'bad_request', message: 'UNA invalide' } };
  const r = await q.query('SELECT id FROM una WHERE unite=$1 AND numero=$2 AND annee=$3', [u, n, a]);
  return r.rows.length ? { id: r.rows[0].id } : { error: { code: 'una_inconnu', message: `UNA ${combo} introuvable` } };
}

async function getPerquisition(pool, id) {
  const p = await pool.query(
    `SELECT p.*, u.unite || '/' || u.numero || '/' || u.annee AS una, c.nom AS commune_libelle
     FROM perquisition p JOIN una u ON u.id = p.una_id
     LEFT JOIN communes c ON c.code_insee = p.commune WHERE p.id = $1`, [id]);
  if (!p.rows.length) return { code: 404, error: { code: 'not_found', message: `Perquisition ${id} introuvable` } };
  const perq = p.rows[0];
  perq.intervenants = (await pool.query('SELECT texte FROM perquisition_intervenant WHERE perquisition_id=$1 ORDER BY ordre', [id])).rows.map((r) => r.texte);
  perq.pieces = (await pool.query('SELECT libelle FROM perquisition_piece WHERE perquisition_id=$1 ORDER BY ordre', [id])).rows.map((r) => r.libelle);
  const objets = (await pool.query('SELECT * FROM objet_saisi WHERE perquisition_id=$1 ORDER BY id', [id])).rows;
  for (const o of objets) {
    o.champs = (await pool.query('SELECT cle, libelle, valeur, source, obligatoire FROM objet_champ WHERE objet_id=$1 ORDER BY ordre', [o.id])).rows;
    o.identifiants = (await pool.query('SELECT type, valeur FROM objet_identifiant WHERE objet_id=$1', [o.id])).rows;
    o.estimation_sources = (await pool.query('SELECT site, url, prix FROM objet_estimation_source WHERE objet_id=$1 ORDER BY ordre', [o.id])).rows;
    o.estimation_hypotheses = (await pool.query('SELECT texte FROM objet_estimation_hypothese WHERE objet_id=$1 ORDER BY ordre', [o.id])).rows.map((r) => r.texte);
    o.categories_alternatives = (await pool.query('SELECT categorie, confiance FROM objet_categorie_alternative WHERE objet_id=$1', [o.id])).rows;
  }
  perq.objets = objets;
  return { code: 200, data: perq };
}

async function createPerquisition(pool, body) {
  if (!Array.isArray(body.objets)) return { code: 400, error: { code: 'bad_request', message: 'objets[] requis' } };
  if (!body.adresse || !String(body.adresse).trim()) return { code: 400, error: { code: 'bad_request', message: 'adresse requise' } };
  const client = await pool.connect();
  try {
    const rUna = await resolveUnaId(client, body);
    if (rUna.error) return { code: rUna.error.code === 'una_inconnu' ? 404 : 400, error: rUna.error };
    const rCom = await resolveCommuneCode(client, body.commune);
    if (rCom.error) return { code: 400, error: rCom.error };

    await client.query('BEGIN');
    const perq = await client.query(
      `INSERT INTO perquisition (una_id, adresse, code_postal, commune, latitude, longitude, type_lieu, perquisitionne, opj, date_debut)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [rUna.id, String(body.adresse), body.code_postal || null, rCom.code,
       body.latitude ?? null, body.longitude ?? null, body.type_lieu || null,
       body.perquisitionne || null, body.opj || null, body.date_debut || null]);
    const perqId = perq.rows[0].id;

    const intervenants = (body.intervenants || []).filter((x) => x && String(x).trim());
    for (let i = 0; i < intervenants.length; i++)
      await client.query('INSERT INTO perquisition_intervenant (perquisition_id, texte, ordre) VALUES ($1,$2,$3)', [perqId, String(intervenants[i]), i]);
    const pieces = (body.pieces || []).filter((x) => x && String(x).trim());
    for (let i = 0; i < pieces.length; i++)
      await client.query('INSERT INTO perquisition_piece (perquisition_id, libelle, ordre) VALUES ($1,$2,$3)', [perqId, String(pieces[i]), i]);

    for (const o of body.objets) {
      const est = o.estimation || {};
      const obj = await client.query(
        `INSERT INTO objet_saisi (perquisition_id, categorie, sous_type, confiance, numero_scelle, situation, lieu, photo_url,
           estim_prix_bas, estim_prix_moyen, estim_prix_haut, estim_devise, estim_confiance, estim_avertissement)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [perqId, o.categorie, o.sous_type || null, o.confiance ?? null, o.numero_scelle || null,
         o.situation || null, o.lieu || null, o.photo_url || null,
         est.prixBas ?? null, est.prixMoyen ?? null, est.prixHaut ?? null, est.devise || null, est.confiance ?? null, est.avertissement || null]);
      const objId = obj.rows[0].id;
      const champs = o.champs || [];
      for (let i = 0; i < champs.length; i++) {
        const c = champs[i];
        await client.query('INSERT INTO objet_champ (objet_id, cle, libelle, valeur, source, obligatoire, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [objId, c.cle, c.libelle ?? c.cle, c.valeur ?? null, c.source || null, !!c.obligatoire, i]);
      }
      for (const id of extractIdentifiants(o.categorie, champs))
        await client.query('INSERT INTO objet_identifiant (objet_id, type, valeur, valeur_norm) VALUES ($1,$2,$3,$4)', [objId, id.type, id.valeur, id.valeur_norm]);
      const sources = est.sources || [];
      for (let i = 0; i < sources.length; i++)
        await client.query('INSERT INTO objet_estimation_source (objet_id, site, url, prix, ordre) VALUES ($1,$2,$3,$4,$5)', [objId, sources[i].site || null, sources[i].url || null, sources[i].prix ?? null, i]);
      const hyps = est.hypotheses || [];
      for (let i = 0; i < hyps.length; i++)
        await client.query('INSERT INTO objet_estimation_hypothese (objet_id, texte, ordre) VALUES ($1,$2,$3)', [objId, String(hyps[i]), i]);
      for (const a of (o.categoriesAlternatives || []))
        await client.query('INSERT INTO objet_categorie_alternative (objet_id, categorie, confiance) VALUES ($1,$2,$3)', [objId, a.categorie, a.confiance ?? null]);
    }
    await client.query('COMMIT');
    return await getPerquisition(pool, perqId);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('perq_create_error', e.message);
    return { code: 500, error: { code: 'db_error', message: 'Erreur base de données' } };
  } finally {
    client.release();
  }
}

async function listPerquisitions(pool, params) {
  const rUna = await resolveUnaId(pool, { una: params.get('una'), una_id: params.get('una_id') });
  if (rUna.error) return { code: rUna.error.code === 'una_inconnu' ? 404 : 400, error: rUna.error };
  const r = await pool.query(
    `SELECT p.id, p.adresse, p.code_postal, p.commune, c.nom AS commune_libelle, p.type_lieu, p.date_debut, p.created_at,
            (SELECT count(*) FROM objet_saisi o WHERE o.perquisition_id = p.id) AS nb_objets
     FROM perquisition p LEFT JOIN communes c ON c.code_insee = p.commune
     WHERE p.una_id = $1 ORDER BY p.created_at DESC`, [rUna.id]);
  return { code: 200, data: r.rows };
}

async function searchObjets(pool, params) {
  const ident = String(params.get('identifiant') || '').trim();
  if (!ident) return { code: 400, error: { code: 'bad_request', message: 'identifiant requis' } };
  const type = params.get('type');
  const vals = [normalizeIdent(ident)];
  let sql = `SELECT oi.type, oi.valeur, o.id AS objet_id, o.categorie, o.numero_scelle,
              p.id AS perquisition_id, p.adresse, u.unite || '/' || u.numero || '/' || u.annee AS una
             FROM objet_identifiant oi
             JOIN objet_saisi o ON o.id = oi.objet_id
             JOIN perquisition p ON p.id = o.perquisition_id
             JOIN una u ON u.id = p.una_id
             WHERE oi.valeur_norm = $1`;
  if (type) { vals.push(type); sql += ' AND oi.type = $2'; }
  sql += ' ORDER BY o.id';
  const r = await pool.query(sql, vals);
  return { code: 200, data: r.rows };
}

module.exports = { normalizeIdent, extractIdentifiants, createPerquisition, getPerquisition, listPerquisitions, searchObjets };
```

- [ ] **Step 4: Ajouter le script test à package.json**

Modify `server/rgp-api/package.json` — remplacer le contenu par :

```json
{ "name": "rgp-api", "version": "1.0.0", "private": true,
  "scripts": { "test": "node --test" },
  "dependencies": { "pg": "^8.13.1" } }
```

- [ ] **Step 5: Lancer les tests → succès attendu**

Run: `cd server/rgp-api && node --test`
Expected: PASS — 5 tests OK.

- [ ] **Step 6: Commit**

```bash
git add server/rgp-api/perquisition.js server/rgp-api/perquisition.test.js server/rgp-api/package.json
git commit -m "feat(rgp-api): module perquisition (identifiants + CRUD DB) + tests unitaires"
```

---

### Task 4: Câbler les routes dans server.js + Dockerfile

**Files:**
- Modify: `server/rgp-api/server.js` (require + 4 routes)
- Modify: `server/rgp-api/Dockerfile` (COPY perquisition.js)

**Interfaces:**
- Consumes: exports de Task 3.
- Produces: endpoints HTTP `POST /perquisition`, `GET /perquisitions`, `GET /perquisition?id=`, `GET /objets/recherche` sur rgp-api.

- [ ] **Step 1: Importer le module**

Modify `server/rgp-api/server.js` — après la ligne `const { Pool } = require('pg');` ajouter :

```js
const perq = require('./perquisition');
```

- [ ] **Step 2: Ajouter les routes**

Modify `server/rgp-api/server.js` — juste après le bloc `if (u.pathname === '/health') return json(res, 200, { data: { ok: true } });` **et après** le bloc d'auth token (`if (TOKEN && ...) return err(...)`), insérer :

```js
  // PERQUISITIONS
  if (u.pathname === '/perquisition' && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_request', 'Corps JSON invalide');
    const out = await perq.createPerquisition(pool, body);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
  if (u.pathname === '/perquisitions' && req.method === 'GET') {
    const out = await perq.listPerquisitions(pool, u.searchParams);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
  if (u.pathname === '/perquisition' && req.method === 'GET') {
    const id = parseInt(u.searchParams.get('id'), 10);
    if (!Number.isInteger(id)) return err(res, 400, 'bad_request', 'Paramètre id (entier) requis');
    const out = await perq.getPerquisition(pool, id);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
  if (u.pathname === '/objets/recherche' && req.method === 'GET') {
    const out = await perq.searchObjets(pool, u.searchParams);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
```

- [ ] **Step 3: Mettre à jour le Dockerfile**

Modify `server/rgp-api/Dockerfile` — remplacer la ligne `COPY server.js ./` par :

```dockerfile
COPY server.js perquisition.js ./
```

- [ ] **Step 4: Vérifier que server.js charge sans erreur de syntaxe**

Run: `cd server/rgp-api && node --check server.js && node --check perquisition.js`
Expected: aucune sortie (syntaxe OK).

- [ ] **Step 5: Commit**

```bash
git add server/rgp-api/server.js server/rgp-api/Dockerfile
git commit -m "feat(rgp-api): routes /perquisition(s) + /objets/recherche, COPY module"
```

---

### Task 5: Déployer rgp-api en ligne + vérifier end-to-end (curl)

**Files:** (déploiement — aucune modif repo)

**Interfaces:**
- Consumes: Tasks 2-4.
- Produces: rgp-api en ligne servant les nouveaux endpoints. Vérifie le round-trip DB réel.

- [ ] **Step 1: Pousser la source sur OVH**

```bash
scp server/rgp-api/server.js       ovh:/home/brunogauville/rgp-api/server.js
scp server/rgp-api/perquisition.js ovh:/home/brunogauville/rgp-api/perquisition.js
scp server/rgp-api/Dockerfile      ovh:/home/brunogauville/rgp-api/Dockerfile
scp server/rgp-api/package.json    ovh:/home/brunogauville/rgp-api/package.json
```

- [ ] **Step 2: Rebuild + redémarrer le container**

```bash
ssh ovh 'cd /home/brunogauville && docker compose up -d --build rgp-api'
```

Expected: build OK, container `brunogauville-rgp-api-1` recréé et `Up`.

- [ ] **Step 3: Récupérer un UNA existant pour le test**

```bash
ssh ovh 'docker exec -e PGPASSWORD=<RGP_API_PASSWORD> brunogauville-postgres-1 \
  psql -U rgp_api -d rgp -t -c "SELECT unite||'\''/'\''||numero||'\''/'\''||annee FROM una LIMIT 1"'
```

Expected: un UNA type `12/34/2024`. Le noter comme `<UNA>`.

- [ ] **Step 4: Créer une perquisition via l'API (depuis le container, réseau interne)**

Remplacer `<UNA>` par la valeur du Step 3 :

```bash
ssh ovh 'docker exec brunogauville-rgp-api-1 sh -c "wget -qO- --header=\"Authorization: Bearer <RGP_API_TOKEN>\" --header=\"Content-Type: application/json\" --post-data='"'"'{\"una\":\"<UNA>\",\"adresse\":\"12 rue de la Paix\",\"code_postal\":\"49500\",\"objets\":[{\"categorie\":\"TRANSPORT\",\"sous_type\":\"VEHICULE_TERRESTRE\",\"numero_scelle\":\"SC-1\",\"situation\":\"SAISI_SOUS_SCELLE\",\"champs\":[{\"cle\":\"nmr_immatriculation\",\"libelle\":\"N° immatriculation\",\"valeur\":\"AB-123-CD\",\"source\":\"deduit\",\"obligatoire\":false}]}]}'"'"' http://localhost:8080/perquisition"'
```

Expected: JSON `{ "data": { "id": N, "una": "<UNA>", "objets": [ { "categorie": "TRANSPORT", "identifiants": [ { "type": "IMMATRICULATION", "valeur": "AB-123-CD" } ], ... } ] } }`. Noter l'`id` comme `<PID>`.

- [ ] **Step 5: Vérifier lecture + recoupement**

```bash
ssh ovh 'docker exec brunogauville-rgp-api-1 sh -c "wget -qO- --header=\"Authorization: Bearer <RGP_API_TOKEN>\" '"'"'http://localhost:8080/objets/recherche?identifiant=ab123cd'"'"'"'
```

Expected: JSON `{ "data": [ { "type": "IMMATRICULATION", "valeur": "AB-123-CD", "una": "<UNA>", "adresse": "12 rue de la Paix" } ] }` — prouve la normalisation (`ab123cd` matche `AB-123-CD`).

- [ ] **Step 6: Nettoyer la perquisition de test**

Remplacer `<PID>` :

```bash
ssh ovh 'docker exec -e PGPASSWORD=<RGP_API_PASSWORD> brunogauville-postgres-1 \
  psql -U rgp_api -d rgp -c "DELETE FROM perquisition WHERE id = <PID>"'
```

Expected: `DELETE 1`. Le CASCADE supprime objets/champs/identifiants.

- [ ] **Step 7: Mettre à jour openapi.json**

Modify `server/rgp-api/openapi.json` — ajouter les 4 chemins (`/perquisition` POST+GET, `/perquisitions` GET, `/objets/recherche` GET) avec l'enveloppe `{data}`/`{error}`, en suivant le style des entrées existantes. Puis pousser : `scp server/rgp-api/openapi.json ovh:/home/brunogauville/rgp-api/openapi.json`.

- [ ] **Step 8: Commit**

```bash
git add server/rgp-api/openapi.json
git commit -m "docs(rgp-api): openapi endpoints perquisitions + déploiement en ligne"
```

---

### Task 6: Proxy local — forward vers rgp-api

**Files:**
- Modify: `server/proxy.mjs`
- Create: `server/proxy.test.mjs`

**Interfaces:**
- Consumes: rgp-api (Task 5), config `cfg.rgpApiUrl`, `cfg.rgpApiToken`.
- Produces: routes proxy `POST /api/perquisition`, `GET /api/perquisitions`, `GET /api/perquisition`, `GET /api/objets/recherche`, `GET /api/procedures`. `createHandler` accepte `fetchImpl` (défaut `fetch`).

- [ ] **Step 1: Écrire le test du forward**

Create `server/proxy.test.mjs` :

```js
import { describe, it, expect } from "vitest";
import { createHandler } from "./proxy.mjs";

function mockRes() {
  return { code: 0, headers: null, body: "", writeHead(c, h) { this.code = c; this.headers = h; return this; }, end(b) { this.body = b || ""; } };
}
function mockReq(method, url, body) {
  const h = {};
  return {
    method, url, headers: {},
    on(ev, cb) { h[ev] = cb; if (ev === "end") { if (h.data && body) h.data(body); cb(); } },
  };
}

describe("proxy forward rgp-api", () => {
  it("POST /api/perquisition -> POST {rgp}/perquisition avec Bearer", async () => {
    let captured;
    const fetchImpl = async (u, init) => { captured = { u, init }; return { status: 200, text: async () => JSON.stringify({ data: { id: 1 } }) }; };
    const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080", rgpApiToken: "tok" }, fetchImpl });
    const res = mockRes();
    await h(mockReq("POST", "/api/perquisition", JSON.stringify({ adresse: "1 rue" })), res);
    expect(captured.u).toBe("http://x:8080/perquisition");
    expect(captured.init.headers.Authorization).toBe("Bearer tok");
    expect(res.code).toBe(200);
    expect(JSON.parse(res.body).data.id).toBe(1);
  });

  it("GET /api/perquisitions -> transmet la query", async () => {
    let captured;
    const fetchImpl = async (u) => { captured = u; return { status: 200, text: async () => JSON.stringify({ data: [] }) }; };
    const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080" }, fetchImpl });
    const res = mockRes();
    await h(mockReq("GET", "/api/perquisitions?una=1/2/2024"), res);
    expect(captured).toBe("http://x:8080/perquisitions?una=1/2/2024");
  });

  it("relaie 502 si rgp-api injoignable", async () => {
    const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
    const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080" }, fetchImpl });
    const res = mockRes();
    await h(mockReq("GET", "/api/perquisitions"), res);
    expect(res.code).toBe(502);
    expect(JSON.parse(res.body).error).toBe("RGP_UPSTREAM");
  });
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `npx vitest run server/proxy.test.mjs`
Expected: FAIL (routes non gérées : 404, pas de forward).

- [ ] **Step 3: Ajouter le forward dans proxy.mjs**

Modify `server/proxy.mjs` :

(a) Ajouter le helper avant `export function createHandler` :

```js
const RGP_ROUTES = {
  "POST /api/perquisition": "/perquisition",
  "GET /api/perquisitions": "/perquisitions",
  "GET /api/perquisition": "/perquisition",
  "GET /api/objets/recherche": "/objets/recherche",
  "GET /api/procedures": "/procedures",
};

async function forwardRgp(req, res, cfg, fetchImpl, path, search) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (cfg.rgpApiToken) headers.Authorization = "Bearer " + cfg.rgpApiToken;
    const init = { method: req.method, headers };
    if (req.method === "POST") init.body = await readBody(req);
    const upstream = await fetchImpl((cfg.rgpApiUrl || "") + path + (search || ""), init);
    const text = await upstream.text();
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    console.error("rgp_forward_error", e.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "RGP_UPSTREAM" }));
  }
}
```

(b) Modifier la signature `createHandler` pour accepter `fetchImpl` et router le forward en tête du handler :

Remplacer :

```js
export function createHandler({ cfg, run = runWorkflow, identify = runIdentify }) {
  return async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
```

par :

```js
export function createHandler({ cfg, run = runWorkflow, identify = runIdentify, fetchImpl = fetch }) {
  return async (req, res) => {
    const url = new URL(req.url, "http://x");
    const rgpKey = `${req.method} ${url.pathname}`;
    if (rgpKey in RGP_ROUTES) {
      return forwardRgp(req, res, cfg, fetchImpl, RGP_ROUTES[rgpKey], url.search);
    }
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
```

(c) Étendre le bloc de config (démarrage direct) — après `imageField: ...` ajouter :

```js
    rgpApiUrl: process.env.RGP_API_URL || "http://localhost:8080",
    rgpApiToken: process.env.RGP_API_TOKEN,
```

- [ ] **Step 4: Lancer le test → succès attendu**

Run: `npx vitest run server/proxy.test.mjs`
Expected: PASS — 3 tests OK.

- [ ] **Step 5: Commit**

```bash
git add server/proxy.mjs server/proxy.test.mjs
git commit -m "feat(proxy): forward /api/perquisition(s), /api/objets/recherche, /api/procedures vers rgp-api"
```

---

### Task 7: Client front + mapping

**Files:**
- Create: `src/features/saisies/perquisitionApi.ts`
- Create: `src/features/saisies/perquisitionApi.test.ts`
- Modify: `src/features/saisies/types.ts` (ajout `una?`)

**Interfaces:**
- Consumes: `Perquisition`, `ObjetSaisi` de `types.ts` ; route proxy `POST /api/perquisition` (Task 6).
- Produces:
  - `buildPerquisitionPayload(perq: Perquisition, una: string, objets: ObjetSaisi[]): PerquisitionPayload`
  - `savePerquisition(payload: PerquisitionPayload, fetchImpl?): Promise<{ id: number }>`

- [ ] **Step 1: Ajouter `una` à Perquisition**

Modify `src/features/saisies/types.ts` — dans `export interface Perquisition {`, ajouter en première ligne du corps :

```ts
  una?: string; // "unite/numero/annee" — UNA de rattachement
```

- [ ] **Step 2: Écrire les tests**

Create `src/features/saisies/perquisitionApi.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { buildPerquisitionPayload, savePerquisition } from "./perquisitionApi";
import type { Perquisition, ObjetSaisi } from "./types";

const perq = {
  adresse: "1 rue X", commune: "Segré", codePostal: "49500", insee: "49331",
  dateDebut: "", typeLieu: "DOMICILE", perquisitionne: "M. X", opj: "OPJ Y",
  intervenants: ["Adj Dupont", ""], pieces: ["Garage", ""],
} as Perquisition;

const objet = {
  id: "o1", categorie: "TRANSPORT", sousType: "VEHICULE_TERRESTRE", confiance: 0.9,
  numeroScelle: "SC1", situation: "SAISI_SOUS_SCELLE", lieu: "Garage",
  champs: [{ cle: "nmr_immatriculation", libelle: "N° imm", valeur: "AB-123-CD", source: "deduit", obligatoire: false }],
} as ObjetSaisi;

describe("buildPerquisitionPayload", () => {
  it("mappe le modèle front vers le payload API", () => {
    const p = buildPerquisitionPayload(perq, "12/34/2024", [objet]);
    expect(p.una).toBe("12/34/2024");
    expect(p.commune).toBe("49331");           // insee prioritaire sur commune
    expect(p.intervenants).toEqual(["Adj Dupont"]); // vides filtrés
    expect(p.pieces).toEqual(["Garage"]);
    expect(p.objets[0].sous_type).toBe("VEHICULE_TERRESTRE");
    expect(p.objets[0].champs[0].valeur).toBe("AB-123-CD");
  });
});

describe("savePerquisition", () => {
  it("retourne l'id sur succès", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ data: { id: 7 } }) });
    expect(await savePerquisition({} as any, fake as any)).toEqual({ id: 7 });
  });
  it("lève sur enveloppe d'erreur (HTTP 200 + {error})", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ error: { code: "una_inconnu", message: "UNA introuvable" } }) });
    await expect(savePerquisition({} as any, fake as any)).rejects.toThrow("UNA introuvable");
  });
});
```

- [ ] **Step 3: Lancer le test → échec attendu**

Run: `npx vitest run src/features/saisies/perquisitionApi.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 4: Écrire le client**

Create `src/features/saisies/perquisitionApi.ts` :

```ts
import type { Perquisition, ObjetSaisi } from "./types";

export interface ChampPayload { cle: string; libelle: string; valeur: string | null; source: string; obligatoire: boolean; }
export interface ObjetPayload {
  categorie: string;
  sous_type?: string;
  confiance?: number;
  numero_scelle?: string;
  situation?: string;
  lieu?: string;
  photo_url?: string;
  estimation?: ObjetSaisi["estimationPrix"];
  champs: ChampPayload[];
  categoriesAlternatives?: { categorie: string; confiance: number }[];
}
export interface PerquisitionPayload {
  una: string;
  adresse: string;
  code_postal?: string;
  commune?: string;
  latitude?: number | null;
  longitude?: number | null;
  type_lieu?: string;
  perquisitionne?: string;
  opj?: string;
  date_debut?: string;
  intervenants: string[];
  pieces: string[];
  objets: ObjetPayload[];
}

export function buildPerquisitionPayload(perq: Perquisition, una: string, objets: ObjetSaisi[]): PerquisitionPayload {
  return {
    una,
    adresse: perq.adresse,
    code_postal: perq.codePostal || undefined,
    commune: perq.insee || perq.commune || undefined,
    type_lieu: perq.typeLieu,
    perquisitionne: perq.perquisitionne || undefined,
    opj: perq.opj || undefined,
    date_debut: perq.dateDebut || undefined,
    intervenants: (perq.intervenants || []).filter((s) => s.trim()),
    pieces: (perq.pieces || []).filter((s) => s.trim()),
    objets: objets.map((o) => ({
      categorie: o.categorie,
      sous_type: o.sousType,
      confiance: o.confiance,
      numero_scelle: o.numeroScelle || undefined,
      situation: o.situation,
      lieu: o.lieu || undefined,
      photo_url: undefined, // photos MinIO = incrément ultérieur
      estimation: o.estimationPrix,
      champs: o.champs.map((c) => ({ cle: c.cle, libelle: c.libelle, valeur: c.valeur, source: c.source, obligatoire: c.obligatoire })),
      categoriesAlternatives: o.categoriesAlternatives,
    })),
  };
}

export async function savePerquisition(
  payload: PerquisitionPayload,
  fetchImpl: typeof fetch = fetch
): Promise<{ id: number }> {
  const res = await fetchImpl("/api/perquisition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  // rgp-api renvoie HTTP 200 même sur erreur logique (enveloppe {error}).
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    throw new Error(body?.error?.message || body?.error || "ERREUR_ENREGISTREMENT");
  }
  return { id: body.data.id };
}
```

- [ ] **Step 5: Lancer le test → succès attendu**

Run: `npx vitest run src/features/saisies/perquisitionApi.test.ts`
Expected: PASS — 3 tests OK.

- [ ] **Step 6: Commit**

```bash
git add src/features/saisies/perquisitionApi.ts src/features/saisies/perquisitionApi.test.ts src/features/saisies/types.ts
git commit -m "feat(saisies): client perquisitionApi (mapping + save) + una sur Perquisition"
```

---

### Task 8: Front — champ UNA + bouton « Enregistrer la perquisition »

**Files:**
- Modify: `src/features/saisies/SaisiesApp.tsx`

**Interfaces:**
- Consumes: `buildPerquisitionPayload`, `savePerquisition` (Task 7) ; état `perquisition`, `objets` de `SaisiesApp` ; composant `Inventory` (ligne ~287), `SetupScreen` (ligne ~142).
- Produces: UI de saisie de l'UNA + enregistrement de la perquisition complète.

- [ ] **Step 1: Importer le client**

Modify `src/features/saisies/SaisiesApp.tsx` — ajouter en tête, près des autres imports de la feature :

```tsx
import { buildPerquisitionPayload, savePerquisition } from "./perquisitionApi";
```

- [ ] **Step 2: Ajouter le champ UNA dans SetupScreen**

Dans `SetupScreen` (à partir de la ligne ~142), à côté des états existants (après `const [opj, setOpj] = ...`), ajouter :

```tsx
  const [una, setUna] = useState(initial?.una ?? "");
```

Puis, dans le JSX du formulaire de `SetupScreen`, ajouter un champ (près du champ OPJ ou en tête de section identité) :

```tsx
  <Full>
    <Lbl req>Numéro de procédure (UNA)</Lbl>
    <input
      style={field}
      placeholder="unite/numero/annee — ex. 12/34/2024"
      value={una}
      onChange={(e) => setUna(e.target.value)}
    />
  </Full>
```

Enfin, inclure `una` dans l'objet `Perquisition` construit à la validation de `SetupScreen` (repérer l'appel `onValidate({ ... })` / construction de l'objet perquisition) en ajoutant `una,` au littéral.

- [ ] **Step 3: Ajouter le handler d'enregistrement dans SaisiesApp**

Dans le composant `SaisiesApp()` (ligne ~77), après les `useState`, ajouter :

```tsx
  const [saveState, setSaveState] = useState<{ status: "idle" | "saving" | "ok" | "err"; msg?: string; id?: number }>({ status: "idle" });

  async function handleSavePerquisition() {
    if (!perquisition) return;
    if (!perquisition.una || !perquisition.una.trim()) {
      setSaveState({ status: "err", msg: "UNA de rattachement manquant (revenir à l'étape lieu)." });
      return;
    }
    if (objets.length === 0) {
      setSaveState({ status: "err", msg: "Aucun objet saisi à enregistrer." });
      return;
    }
    setSaveState({ status: "saving" });
    try {
      const payload = buildPerquisitionPayload(perquisition, perquisition.una, objets);
      const { id } = await savePerquisition(payload);
      setSaveState({ status: "ok", id });
    } catch (e) {
      setSaveState({ status: "err", msg: (e as Error).message });
    }
  }
```

- [ ] **Step 4: Passer le handler à Inventory + bouton**

Repérer le rendu `<Inventory ... />` dans `SaisiesApp` et lui passer :

```tsx
  onSavePerquisition={handleSavePerquisition}
  saveState={saveState}
```

Dans la signature du composant `Inventory` (ligne ~287), ajouter aux props :

```tsx
  onSavePerquisition: () => void;
  saveState: { status: "idle" | "saving" | "ok" | "err"; msg?: string; id?: number };
```

Dans le JSX d'`Inventory`, sous la liste des objets, ajouter la zone d'action (icônes Material via `Icon`, jamais d'emoji) :

```tsx
  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
    <button
      style={{ ...btn, opacity: saveState.status === "saving" ? 0.6 : 1 }}
      disabled={saveState.status === "saving"}
      onClick={onSavePerquisition}
    >
      <Icon name="save" size={16} /> Enregistrer la perquisition
    </button>
    {saveState.status === "ok" && (
      <span style={{ color: OK, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="check_circle" size={16} /> Enregistrée (n° {saveState.id})
      </span>
    )}
    {saveState.status === "err" && (
      <span style={{ color: ERR, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="error" size={16} /> {saveState.msg}
      </span>
    )}
  </div>
```

- [ ] **Step 5: Vérifier compilation TypeScript**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Vérifier le build Vite**

Run: `npm run build`
Expected: build réussi.

- [ ] **Step 7: Commit**

```bash
git add src/features/saisies/SaisiesApp.tsx
git commit -m "feat(saisies): champ UNA + bouton Enregistrer la perquisition"
```

---

### Task 9: Tunnel SSH + env + vérification end-to-end en local

**Files:**
- Create: `scripts/tunnel-rgp.sh`
- Modify: `.env`, `.env.example`

**Interfaces:**
- Consumes: rgp-api en ligne (Task 5), proxy (Task 6), front (Task 8).
- Produces: chaîne complète testable en local (app locale, données en ligne).

- [ ] **Step 1: Script de tunnel**

Create `scripts/tunnel-rgp.sh` :

```bash
#!/usr/bin/env bash
# Ouvre un tunnel SSH local -> rgp-api (privé sur le réseau docker OVH).
# rgp-api n'a pas de port publié : on résout l'IP du container et on forwarde 8080.
set -euo pipefail
IP=$(ssh ovh "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' brunogauville-rgp-api-1")
echo "rgp-api container IP: $IP — tunnel http://localhost:8080 -> rgp-api:8080"
exec ssh -N -L "8080:$IP:8080" ovh
```

Rendre exécutable : `chmod +x scripts/tunnel-rgp.sh`

- [ ] **Step 2: Variables d'environnement**

Modify `.env` — ajouter :

```
RGP_API_URL=http://localhost:8080
RGP_API_TOKEN=<RGP_API_TOKEN>
```

Modify `.env.example` — ajouter :

```
RGP_API_URL=http://localhost:8080
RGP_API_TOKEN=changeme
```

- [ ] **Step 3: Ouvrir le tunnel (terminal dédié)**

Run: `./scripts/tunnel-rgp.sh`
Expected: affiche l'IP du container et maintient le tunnel ouvert. Laisser tourner.

- [ ] **Step 4: Vérifier l'accès rgp-api via le tunnel**

Run (autre terminal) :
```bash
curl -s -H "Authorization: Bearer <RGP_API_TOKEN>" \
  "http://localhost:8080/health"
```
Expected: `{"data":{"ok":true}}`.

- [ ] **Step 5: Démarrer le proxy + le front**

Run (terminal proxy) : `node --env-file=.env server/proxy.mjs`
Expected: `proxy IAka sur http://localhost:8787`.
Run (terminal front) : `npm run dev`
Expected: Vite démarre (vérifier le proxy Vite `/api` → 8787 dans `vite.config`; sinon le front appelle 8787 directement selon la config existante).

- [ ] **Step 6: Test end-to-end manuel**

Dans le navigateur : saisir une perquisition (UNA valide `unite/numero/annee` existant, adresse, ≥1 objet via le wizard), cliquer « Enregistrer la perquisition ».
Expected: message vert « Enregistrée (n° N) ».
Vérifier en base :
```bash
ssh ovh 'docker exec -e PGPASSWORD=<RGP_API_PASSWORD> brunogauville-postgres-1 \
  psql -U rgp_api -d rgp -c "SELECT id, una_id, adresse FROM perquisition ORDER BY id DESC LIMIT 3"'
```
Expected: la perquisition enregistrée apparaît.

- [ ] **Step 7: Commit**

```bash
git add scripts/tunnel-rgp.sh .env.example
git commit -m "chore(dev): tunnel SSH rgp-api + env (app locale, données en ligne)"
```

Note : `.env` n'est pas commité (secrets) — vérifier qu'il est bien dans `.gitignore`.

---

## Hors périmètre (incréments ultérieurs)

- **Photos → MinIO** : upload base64 → MinIO via le proxy, `photo_url` renseigné. Nécessite reachability MinIO (tunnel/co-loc) + SDK S3. `photo_url` déjà présent dans le schéma et le payload (à `undefined` pour l'instant).
- **Sélecteur UNA assisté** : autocomplétion via `GET /api/procedures` (route proxy déjà câblée en Task 6) au lieu d'une saisie texte libre.
- **Géocodage adresse** → `latitude`/`longitude` (colonnes prêtes).
- **Déploiement prod du front** sur OVH (accès direct `http://rgp-api:8080`, sans tunnel).

---

## Self-Review

**Spec coverage :**
- Schéma 9 tables + grants séquences → Task 2. ✓
- Audit/mapping identifiants par type (TRANSPORT en tête) → Task 3 (`IDENT_MAP` + `extractIdentifiants`). ✓
- Endpoints rgp-api (create/list/get/recherche) → Tasks 3-5. ✓
- Transport privé tunnel SSH, token côté proxy → Tasks 6, 9. ✓
- Source rgp-api vendorée → Task 1. ✓
- Front save + UNA → Tasks 7-8. ✓
- MinIO photos = phase ultérieure → Hors périmètre. ✓ (conforme « données en ligne + app locale »)
- `ON DELETE CASCADE` conscient → Task 2 (vérifié au Step 6 nettoyage). ✓

**Placeholder scan :** aucun TBD/TODO ; tout code fourni intégralement. Les seules instructions « repérer X » (Task 8) portent sur des points d'insertion dans un fichier existant non entièrement reproductible, avec code complet à insérer.

**Type consistency :** `buildPerquisitionPayload(perq, una, objets)` / `savePerquisition(payload, fetchImpl)` cohérents Tasks 7-8. Enveloppe `{data}`/`{error}` cohérente rgp-api ↔ proxy ↔ client (client gère le HTTP 200 + `{error}`). `extractIdentifiants(categorie, champs)` signature identique test/impl/usage. `RGP_API_URL`/`RGP_API_TOKEN` cohérents proxy/env/tunnel (port 8080).
