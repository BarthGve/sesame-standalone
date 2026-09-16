# Base RENS / FRS + synthèse IAka — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une base de fiches de renseignement simplifiées (FRS) interrogeable en langage naturel, où IAka produit une synthèse d'un jour, des tendances et des signaux faibles.

**Architecture:** Calqué sur RGP, en read-only. Une base Postgres `rens` (tables `frs` + `frs_mot_cle`) sur le conteneur OVH existant. Un micro-service `rens-api` (Node `http` + `pg`) sert la liste consultable à l'application ; un workflow IAka mono-branche lit les textes via un **MCP Postgres read-only** (rôle `rens_ro`) et rédige la synthèse en markdown. Le proxy applicatif relaie la liste et le prompt ; le front (`src/features/rens`) affiche liste+filtres et le rendu markdown.

**Tech Stack:** Node 20 (`http`, `pg`), PostgreSQL 16, React 19 + react-router 7, Cunningham, `react-markdown` + `remark-gfm`, Vitest (front + proxy), `node:test` (rens-api). Déploiement Docker Compose + nginx sur OVH.

## Global Constraints

- **INTERDIT : aucun emoji dans l'UI** (règle projet `CLAUDE.md`). Icônes = Material Icons (`<span className="material-icons">`) ou SVG inline, ou texte.
- Enveloppe de réponse API uniforme : succès `{ "data": ... }`, erreur `{ "error": { "code", "message" } }` (convention RGP).
- Read-only : `rens-api` et le MCP IAka ne font que des `SELECT`. Aucune écriture en itération 1.
- Données seed : **identités fictives**, catégories GIPASP uniquement, personnes **dans le texte** (aucune colonne PII).
- Secrets (mot de passe DB, token API) **jamais dans le repo** ni dans les prompts — variables d'environnement / config MCP côté serveur (cf. dette `rgp-api-security-debt`).
- Tests front : `npm test` (vitest). Tests rens-api : `node --test` depuis `server/rens-api`.
- Périmètre : filtres tractables (jour / dept+période / mots-clés). Pas de synthèse cross-corpus année entière (itération 2).

---

## File Structure

**Créés — service rens-api**
- `server/rens-api/package.json` — dépendance `pg`, script test.
- `server/rens-api/fiches.js` — fonctions **pures** de construction de requêtes (`buildListQuery`, `buildDetailQuery`).
- `server/rens-api/fiches.test.js` — tests `node:test` des fonctions pures.
- `server/rens-api/server.js` — serveur `http` read-only (GET /fiches, /fiches/:id, /health).
- `server/rens-api/Dockerfile` — image node:20-alpine.
- `server/rens-api/openapi.json` — contrat (sert un futur MCP-API itération 2).
- `server/rens-api/migrations/001_frs.sql` — tables + index.
- `server/rens-api/migrations/002_roles.sql` — rôles `rens_api`, `rens_ro` + grants.
- `server/rens-api/seed/generate.mjs` — générateur **déterministe** du seed → SQL.
- `server/rens-api/seed/frs_seed.sql` — seed généré, **commité**.
- `server/rens-api/seed/frs_seed.test.mjs` — validation du seed (comptes, trames).

**Créés — intégration IAka & front**
- `server/rens.mjs` — `extractSynthese(result)` (extraction du markdown narratif).
- `server/rens.test.mjs` — tests de `extractSynthese`.
- `src/features/rens/rensApi.ts` — types + `fetchFiches`, `sendRensPrompt`.
- `src/features/rens/rensApi.test.ts`
- `src/features/rens/rensStore.ts` — store persisté (filtres + conversation synthèse).
- `src/features/rens/rensStore.test.ts`
- `src/features/rens/FicheList.tsx` — liste + filtres.
- `src/features/rens/RensResult.tsx` — rendu markdown de la synthèse.
- `src/features/rens/RensApp.tsx` — écran (2 zones).
- `src/features/rens/RensApp.test.tsx`

**Modifiés**
- `server/iaka.mjs` — ajout `runRensSynthese`.
- `server/proxy.mjs` — routes `/api/rens/fiches`, `/api/rens/fiche`, `/api/rens/synthese` + config.
- `server/proxy.test.mjs` — tests des routes RENS.
- `src/App.tsx` — import + route `rens` + entrée `NAV`.
- `.env.example` — variables `RENS_*`, `IAKA_RENS_APP_ID`.
- `docs/iaka-rens-workflow.md` (créé) — runbook builder IAka (calqué `iaka-rgp-workflow.md`).

**Phasage** : Phase 1 (T1–T4) = rens-api + seed, testable en local sans OVH. Phase 2 (T5–T7) = intégration IAka + proxy. Phase 3 (T8–T11) = front. Phase 4 (T12–T13) = déploiement OVH + builder IAka (manuel, documenté).

---

## Task 1: rens-api — schéma + fonctions de requête pures

**Files:**
- Create: `server/rens-api/package.json`
- Create: `server/rens-api/migrations/001_frs.sql`
- Create: `server/rens-api/fiches.js`
- Test: `server/rens-api/fiches.test.js`

**Interfaces:**
- Produces: `buildListQuery(params: URLSearchParams) => { text: string, values: any[] }` et `buildDetailQuery(id: number) => { text: string, values: any[] }` (consommés par `server.js` en Task 2).

- [ ] **Step 1: package.json**

```json
{ "name": "rens-api", "version": "1.0.0", "private": true,
  "scripts": { "test": "node --test" },
  "dependencies": { "pg": "^8.13.1" } }
```

- [ ] **Step 2: migration 001 (tables + index)**

`server/rens-api/migrations/001_frs.sql` :

```sql
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
```

- [ ] **Step 3: écrire le test des fonctions pures (échoue)**

`server/rens-api/fiches.test.js` :

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildListQuery, buildDetailQuery } = require('./fiches');

const P = (s) => new URLSearchParams(s);

test('buildListQuery : sans filtre → LIMIT défaut, GROUP BY, ORDER BY date', () => {
  const q = buildListQuery(P(''));
  assert.match(q.text, /FROM frs f/);
  assert.match(q.text, /LEFT JOIN frs_mot_cle m/);
  assert.match(q.text, /GROUP BY f\.id/);
  assert.match(q.text, /ORDER BY f\.date_redaction DESC/);
  assert.match(q.text, /LIMIT 100/);
  assert.deepStrictEqual(q.values, []);
});

test('buildListQuery : filtre date + ggd', () => {
  const q = buildListQuery(P('date=2026-03-04&ggd=GGD 49'));
  assert.match(q.text, /f\.date_redaction = \$1/);
  assert.match(q.text, /f\.code_ggd = \$2/);
  assert.deepStrictEqual(q.values, ['2026-03-04', 'GGD 49']);
});

test('buildListQuery : recherche q → titre/texte/mot ILIKE', () => {
  const q = buildListQuery(P('q=rodeo'));
  assert.match(q.text, /f\.titre ILIKE \$1/);
  assert.match(q.text, /f\.texte ILIKE \$1/);
  assert.match(q.text, /frs_mot_cle mk/);
  assert.deepStrictEqual(q.values, ['%rodeo%']);
});

test('buildListQuery : theme ILIKE', () => {
  const q = buildListQuery(P('theme=violences urbaines'));
  assert.match(q.text, /f\.thematique ILIKE \$1/);
  assert.deepStrictEqual(q.values, ['violences urbaines']);
});

test('buildListQuery : limit borné à 500', () => {
  assert.match(buildListQuery(P('limit=99999')).text, /LIMIT 500/);
  assert.match(buildListQuery(P('limit=abc')).text, /LIMIT 100/);
});

test('buildDetailQuery : id paramétré', () => {
  const q = buildDetailQuery(42);
  assert.match(q.text, /WHERE f\.id = \$1/);
  assert.deepStrictEqual(q.values, [42]);
});
```

- [ ] **Step 4: lancer le test (échoue)**

Run: `cd server/rens-api && node --test`
Expected: FAIL — `Cannot find module './fiches'`.

- [ ] **Step 5: implémenter `fiches.js`**

```js
// Construction des requêtes SQL de lecture des FRS. Fonctions PURES (testables sans DB) :
// renvoient { text, values } passés tels quels à pool.query. Read-only.

const SELECT_LIST = `
  SELECT f.id, f.date_redaction, f.titre, f.unite, f.code_ggd, f.departement,
         f.thematique, f.texte,
         COALESCE(array_agg(m.mot ORDER BY m.ordre) FILTER (WHERE m.mot IS NOT NULL), '{}') AS mots_cles
  FROM frs f
  LEFT JOIN frs_mot_cle m ON m.frs_id = f.id`;

// Liste filtrée. Filtres optionnels : date (jour exact YYYY-MM-DD), ggd (code exact),
// theme (libellé, ILIKE), q (recherche titre/texte/mot-clé), limit.
function buildListQuery(params) {
  const where = [], values = [];
  const push = (frag, v) => { values.push(v); where.push(frag.replace('$?', '$' + values.length)); };

  const date = (params.get('date') || '').trim();
  if (date) push('f.date_redaction = $?', date);

  const ggd = (params.get('ggd') || '').trim();
  if (ggd) push('f.code_ggd = $?', ggd);

  const theme = (params.get('theme') || '').trim();
  if (theme) push('f.thematique ILIKE $?', theme);

  const q = (params.get('q') || '').trim();
  if (q) {
    values.push('%' + q + '%');
    const i = '$' + values.length;
    where.push(`(f.titre ILIKE ${i} OR f.texte ILIKE ${i} OR EXISTS (SELECT 1 FROM frs_mot_cle mk WHERE mk.frs_id = f.id AND mk.mot ILIKE ${i}))`);
  }

  let limit = parseInt(params.get('limit'), 10);
  if (!Number.isInteger(limit) || limit <= 0) limit = 100;
  if (limit > 500) limit = 500;

  let text = SELECT_LIST;
  if (where.length) text += '\n  WHERE ' + where.join(' AND ');
  text += '\n  GROUP BY f.id\n  ORDER BY f.date_redaction DESC, f.id DESC\n  LIMIT ' + limit;
  return { text, values };
}

function buildDetailQuery(id) {
  return { text: SELECT_LIST + '\n  WHERE f.id = $1\n  GROUP BY f.id', values: [id] };
}

module.exports = { buildListQuery, buildDetailQuery };
```

- [ ] **Step 6: lancer le test (passe)**

Run: `cd server/rens-api && node --test`
Expected: PASS (6 tests).

- [ ] **Step 7: commit**

```bash
git add server/rens-api/package.json server/rens-api/migrations/001_frs.sql server/rens-api/fiches.js server/rens-api/fiches.test.js
git commit -m "feat(rens-api): schéma FRS + requêtes de lecture pures"
```

---

## Task 2: rens-api — serveur HTTP read-only

**Files:**
- Create: `server/rens-api/server.js`
- Create: `server/rens-api/Dockerfile`

**Interfaces:**
- Consumes: `buildListQuery`, `buildDetailQuery` (Task 1).
- Produces: endpoints `GET /health`, `GET /fiches?date=&ggd=&theme=&q=&limit=`, `GET /fiches/:id`. Auth `Bearer $API_TOKEN` (sauf `/health`). Réponses `{ data }` / `{ error: { code, message } }`.

- [ ] **Step 1: implémenter `server.js`** (calqué `server/rgp-api/server.js`, read-only)

```js
const http = require('http');
const { Pool } = require('pg');
const { buildListQuery, buildDetailQuery } = require('./fiches');

const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'rens',
  max: 4,
});
const TOKEN = process.env.API_TOKEN || '';

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const err = (res, code, c, m) => json(res, code, { error: { code: c, message: m } });

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: u.pathname, q: Object.fromEntries(u.searchParams), auth: !!req.headers.authorization }));

  if (u.pathname === '/health') return json(res, 200, { data: { ok: true } });

  if (TOKEN && (req.headers.authorization || '') !== 'Bearer ' + TOKEN)
    return err(res, 401, 'unauthorized', 'Token invalide ou manquant');

  if (u.pathname === '/fiches' && req.method === 'GET') {
    try {
      const q = buildListQuery(u.searchParams);
      const r = await pool.query(q.text, q.values);
      return json(res, 200, { data: r.rows });
    } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
  }

  const mFiche = u.pathname.match(/^\/fiches\/(\d+)$/);
  if (mFiche && req.method === 'GET') {
    try {
      const q = buildDetailQuery(parseInt(mFiche[1], 10));
      const r = await pool.query(q.text, q.values);
      if (!r.rows.length) return err(res, 404, 'not_found', `Fiche ${mFiche[1]} introuvable`);
      return json(res, 200, { data: r.rows[0] });
    } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
  }

  return err(res, 404, 'not_found', 'Route inconnue');
}).listen(8080, () => console.log('rens-api :8080'));
```

- [ ] **Step 2: Dockerfile** (calqué rgp-api)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js fiches.js ./
USER node
EXPOSE 8080
CMD ["node","server.js"]
```

- [ ] **Step 3: smoke test manuel de la syntaxe** (pas de DB requise pour le parse)

Run: `cd server/rens-api && node --check server.js && echo OK`
Expected: `OK` (le serveur n'est pas démarré ici — validé en déploiement Task 12).

- [ ] **Step 4: commit**

```bash
git add server/rens-api/server.js server/rens-api/Dockerfile
git commit -m "feat(rens-api): serveur HTTP read-only (/fiches, /fiches/:id, /health)"
```

---

## Task 3: rens-api — rôles PostgreSQL + OpenAPI

**Files:**
- Create: `server/rens-api/migrations/002_roles.sql`
- Create: `server/rens-api/openapi.json`

**Interfaces:**
- Produces: rôles `rens_api` (utilisé par le conteneur) et `rens_ro` (utilisé par le MCP IAka), SELECT-only. `openapi.json` décrit `/fiches` et `/fiches/{id}`.

- [ ] **Step 1: migration 002 (rôles + grants)**

`server/rens-api/migrations/002_roles.sql` — les mots de passe sont posés **hors repo** au déploiement (Task 12) :

```sql
-- Rôles créés SANS mot de passe ici ; le mot de passe est posé au déploiement
-- (ALTER ROLE ... PASSWORD) via une variable d'environnement, jamais commité.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rens_api') THEN
    CREATE ROLE rens_api LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rens_ro') THEN
    CREATE ROLE rens_ro LOGIN;
  END IF;
END$$;

GRANT CONNECT ON DATABASE rens TO rens_api, rens_ro;
GRANT USAGE ON SCHEMA public TO rens_api, rens_ro;
GRANT SELECT ON frs, frs_mot_cle TO rens_api, rens_ro;
-- Les futures tables héritent du SELECT (utile si le schéma évolue) :
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO rens_api, rens_ro;
```

- [ ] **Step 2: openapi.json** (contrat minimal, sert un MCP-API en itération 2)

```json
{
 "openapi": "3.1.0",
 "info": { "title": "RENS Lookup API (FRS)", "version": "1.0.0",
   "description": "Consultation read-only des fiches de renseignement simplifiées (FRS). Enveloppe: succès { data }, erreur { error: { code, message } }." },
 "servers": [{ "url": "https://carnet.kerjean.net/rens-api", "description": "Production" }],
 "security": [{ "bearerAuth": [] }],
 "paths": {
  "/fiches": {
   "get": {
    "operationId": "listFiches",
    "summary": "Lister les FRS (filtres date, ggd, theme, q, limit)",
    "parameters": [
     { "name": "date", "in": "query", "schema": { "type": "string", "format": "date" }, "description": "Jour exact YYYY-MM-DD" },
     { "name": "ggd", "in": "query", "schema": { "type": "string" }, "description": "Code GGD exact, ex. 'GGD 49'" },
     { "name": "theme", "in": "query", "schema": { "type": "string" } },
     { "name": "q", "in": "query", "schema": { "type": "string" }, "description": "Recherche titre/texte/mot-clé" },
     { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 100, "maximum": 500 } }
    ],
    "responses": { "200": { "description": "Liste de fiches" } }
   }
  },
  "/fiches/{id}": {
   "get": {
    "operationId": "getFiche",
    "summary": "Détail d'une FRS",
    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "integer" } }],
    "responses": { "200": { "description": "Fiche" }, "404": { "description": "Introuvable" } }
   }
  }
 },
 "components": { "securitySchemes": { "bearerAuth": { "type": "http", "scheme": "bearer" } } }
}
```

- [ ] **Step 3: valider le JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('server/rens-api/openapi.json','utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 4: commit**

```bash
git add server/rens-api/migrations/002_roles.sql server/rens-api/openapi.json
git commit -m "feat(rens-api): rôles SELECT-only (rens_api, rens_ro) + openapi"
```

---

## Task 4: Seed — générateur déterministe + SQL commité

**Files:**
- Create: `server/rens-api/seed/generate.mjs`
- Create: `server/rens-api/seed/frs_seed.sql` (généré, commité)
- Test: `server/rens-api/seed/frs_seed.test.mjs`

**Interfaces:**
- Produces: `frs_seed.sql` — `INSERT INTO frs (...)` + `INSERT INTO frs_mot_cle (...)`, ~400-800 fiches du 2026-01-01 au 2026-07-18, plusieurs GGD, thématiques variées, **3 trames de signaux faibles** repérables par le mot-clé `signal-faible:<code>` (colonne technique dans `mots_cles`).

**Note conception :** générateur **déterministe** (PRNG `mulberry32` à graine fixe — pas de `Math.random`, seed reproductible). Les banques de textes sont volontairement modestes mais réalistes et GIPASP-safe ; elles peuvent être enrichies ensuite sans changer la structure. Les 3 trames sont injectées explicitement pour que la démo « signaux faibles » ait de la matière.

- [ ] **Step 1: écrire le test du seed (échoue)**

`server/rens-api/seed/frs_seed.test.mjs` :

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./frs_seed.sql', import.meta.url), 'utf8');

test('seed : volume attendu (400-800 fiches)', () => {
  const n = (sql.match(/INSERT INTO frs \(/g) || []).length;
  assert.ok(n >= 400 && n <= 800, `attendu 400-800 fiches, obtenu ${n}`);
});

test('seed : couvre plusieurs GGD', () => {
  for (const ggd of ['GGD 49', 'GGD 44', 'GGD 53', 'GGD 72', 'GGD 85']) {
    assert.ok(sql.includes(ggd), `GGD manquant : ${ggd}`);
  }
});

test('seed : bornes de dates 2026-01 → 2026-07', () => {
  assert.ok(sql.includes('2026-01-01'), 'début 2026-01-01 manquant');
  assert.match(sql, /2026-07-1[0-8]/, 'fin juillet manquante');
});

test('seed : 3 trames de signaux faibles plantées (hook technique)', () => {
  for (const code of ['signal-faible:demarchage-faux-agent', 'signal-faible:degradations-antenne', 'signal-faible:reperage-exploitation']) {
    const count = (sql.match(new RegExp(code, 'g')) || []).length;
    assert.ok(count >= 5, `trame ${code} : attendu >=5 occurrences, obtenu ${count}`);
  }
});

// Chaque trame doit avoir un mot-clé NATUREL signature rare-mais-présent (5-20), sinon la
// découverte par agrégation (GROUP BY mot HAVING count BETWEEN 5 AND 20) ne l'isolera pas.
// count(mot) = nombre de lignes frs_mot_cle avec cette valeur exacte.
test('seed : mots-clés signatures rares-mais-dispersés (5-20)', () => {
  const countMot = (mot) => (sql.match(new RegExp(`, '${mot.replace(/'/g, "''")}', `, 'g')) || []).length;
  for (const mot of ['faux agent', 'équipement technique', 'exploitation agricole']) {
    const n = countMot(mot);
    assert.ok(n >= 5 && n <= 20, `signature "${mot}" : attendu 5-20, obtenu ${n} (collision avec le bruit ?)`);
  }
});
```

- [ ] **Step 2: lancer le test (échoue)**

Run: `cd server/rens-api && node --test seed/frs_seed.test.mjs`
Expected: FAIL — `ENOENT ... frs_seed.sql`.

- [ ] **Step 3: implémenter `generate.mjs`**

```js
// Générateur DÉTERMINISTE du seed FRS. Aucune dépendance, aucun Math.random :
// PRNG mulberry32 à graine fixe → sortie stable et reproductible.
// Usage : node server/rens-api/seed/generate.mjs > server/rens-api/seed/frs_seed.sql
import { writeFileSync } from 'node:fs';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260118);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const esc = (s) => s.replace(/'/g, "''");

// GGD → départements + unités (COB/BTA) fictives mais plausibles.
const GGDS = [
  { ggd: 'GGD 49', dep: 'Maine-et-Loire', unites: ['COB Segré-en-Anjou Bleu', 'BTA Chalonnes-sur-Loire', 'COB Beaufort-en-Anjou', 'BTA Doué-en-Anjou'] },
  { ggd: 'GGD 44', dep: 'Loire-Atlantique', unites: ['COB Blain', 'BTA Machecoul', 'COB Nozay', 'BTA Clisson'] },
  { ggd: 'GGD 53', dep: 'Mayenne', unites: ['COB Évron', 'BTA Craon', 'COB Ernée'] },
  { ggd: 'GGD 72', dep: 'Sarthe', unites: ['COB Sablé-sur-Sarthe', 'BTA Bonnétable', 'COB Loué'] },
  { ggd: 'GGD 85', dep: 'Vendée', unites: ['COB Mortagne-sur-Sèvre', 'BTA Saint-Fulgent', 'COB Talmont-Saint-Hilaire'] },
];

// Thématiques ordinaires (bruit de fond). Chaque entrée fournit titres, mots-clés et
// gabarits de texte GIPASP-safe (personnes fictives, catégories autorisées).
const THEMES = [
  { theme: 'violences urbaines', titres: ['Rodéos motorisés récurrents', 'Attroupement et jets de projectiles', 'Dégradations de mobilier urbain'],
    mots: ['rodéo', 'deux-roues', 'nuisances', 'quartier'],
    textes: ['Signalements répétés de rodéos motorisés en soirée sur le secteur. Un deux-roues non homologué (type 50cc débridé) impliqué à plusieurs reprises ; immatriculation relevée partielle. Individus décrits comme jeunes majeurs du quartier.',
             "Attroupement d'une dizaine d'individus ayant occasionné des jets de projectiles sur la voie publique. Aucun blessé. Un véhicule utilitaire clair repéré à proximité à chaque épisode."] },
  { theme: 'trafic de stupéfiants', titres: ['Point de deal présumé', 'Va-et-vient suspects nocturnes'],
    mots: ['stupéfiants', 'deal', 'guet'],
    textes: ["Va-et-vient nocturnes réguliers autour d'un hall d'immeuble. Guetteurs positionnés en entrée de rue. Un véhicule berline sombre effectue des passages courts et répétés.",
             "Résidents signalant une odeur de cannabis et des transactions rapides sur un parking. Deux individus récurrents, l'un circulant à scooter."] },
  { theme: 'atteintes aux élus', titres: ['Menaces envers un élu local', 'Dégradation de permanence'],
    mots: ['élu', 'menaces', 'permanence'],
    textes: ["Un élu municipal fait état de courriers anonymes menaçants reçus à sa permanence. Ton revendicatif lié à un projet d'aménagement. Pas de passage à l'acte à ce stade.",
             "Inscriptions hostiles taguées sur la façade d'une permanence d'élu durant la nuit. Mode opératoire similaire à des faits antérieurs dans un secteur voisin."] },
  { theme: 'escroqueries aux personnes âgées', titres: ['Démarchage frauduleux de séniors', 'Faux agents à domicile'],
    mots: ['escroquerie', 'personnes âgées', 'démarchage'],
    textes: ["Plusieurs personnes âgées démarchées à domicile par un individu se présentant comme agent d'un service public. Tentative d'accès au domicile sous prétexte de vérification. Véhicule blanc utilitaire mentionné.",
             "Signalement d'appels téléphoniques ciblant des séniors isolés, l'interlocuteur usurpant la qualité d'agent administratif pour obtenir des coordonnées bancaires."] },
  { theme: 'dérive sectaire', titres: ['Groupe de développement personnel signalé', 'Emprise sur personne vulnérable'],
    mots: ['emprise', 'communauté', 'vulnérabilité'],
    textes: ["Une famille s'inquiète de l'isolement croissant d'un proche au sein d'un groupe de 'développement personnel'. Réunions fréquentes en zone rurale. Discours de rupture avec l'entourage rapporté.",
             "Signalement d'un rassemblement récurrent en propriété isolée, avec allées et venues de personnes présentées comme en situation de fragilité."] },
  { theme: 'écologie radicale', titres: ['Repérage sur site industriel', 'Tract appelant au blocage'],
    mots: ['militants', 'blocage', 'site'],
    textes: ["Présence de personnes photographiant les accès d'un site industriel classé. Repli à bord d'un véhicule de tourisme. Contexte de mobilisation annoncée.",
             "Distribution de tracts appelant au blocage d'un chantier. Petits groupes mobiles, repérages préalables des accès signalés par un riverain."] },
  { theme: 'radicalisation', titres: ['Changement de comportement signalé', 'Propos préoccupants en ligne'],
    mots: ['signalement', 'comportement', 'réseaux'],
    textes: ["Signalement émanant d'un proche quant à un changement rapide de comportement et un discours de rupture. Éléments à recouper, pas de menace caractérisée.",
             "Propos préoccupants relevés sur un réseau social par un tiers. Compte utilisant un pseudonyme ; contenus à évaluer."] },
];

// 3 TRAMES de signaux faibles : phénomène mineur récurrent, dispersé, en montée graduelle.
// CONCEPTION (cf. revue advisor) : la DÉCOUVERTE d'un signal faible passe par une requête
// d'AGRÉGATION (GROUP BY mot ... HAVING count BETWEEN 5 AND 20 AND depts>=3), PAS par une
// récupération brute LIMIT 60 (les ~7-8 fiches dispersées d'une trame ne seraient pas dans
// les 60 plus récentes). Pour que l'agrégation isole une trame, chaque trame porte au moins
// UN mot-clé NATUREL SIGNATURE, rare dans le bruit de fond et NON PARTAGÉ entre trames :
//   - trame 1 → 'faux agent' (+ 'utilitaire blanc')      (bruit escroquerie = 'escroquerie'/'démarchage')
//   - trame 2 → 'équipement technique' (+ 'sabotage discret')
//   - trame 3 → 'exploitation agricole' (+ 'repérage', présent SEULEMENT ici)
// Les mots-clés des thèmes de bruit sont très fréquents (count ~50-85 → exclus par la borne
// haute 20) ; les signatures de trame sont rares-mais-dispersées (5-20, depts>=3) → isolées.
// Le mot-clé technique 'signal-faible:<code>' reste UNIQUEMENT un HOOK DE TEST (frs_seed.test) :
// il est EXCLU de la découverte agrégée côté agent (WHERE mot NOT LIKE 'signal-faible:%') pour
// ne pas fuiter l'échafaudage dans la narration.
const TRAMES = [
  { code: 'demarchage-faux-agent', theme: 'escroqueries aux personnes âgées',
    titre: 'Démarchage par faux agent — signalement isolé',
    ggds: ['GGD 49', 'GGD 53', 'GGD 72', 'GGD 44'],
    jours: ['2026-01-14', '2026-02-03', '2026-02-27', '2026-03-19', '2026-04-08', '2026-05-02', '2026-05-28', '2026-06-16'],
    texte: "Personne âgée démarchée à domicile par un homme se présentant comme agent d'un organisme officiel, gilet et badge non vérifiables. Même mode opératoire signalé : prétexte de contrôle, véhicule utilitaire blanc, plaque partiellement mémorisée. Fait isolé en apparence.",
    mots: ['faux agent', 'utilitaire blanc', 'personnes âgées'] },
  { code: 'degradations-antenne', theme: 'écologie radicale',
    titre: 'Dégradation légère d\'équipement technique',
    ggds: ['GGD 85', 'GGD 44', 'GGD 72', 'GGD 49'],
    jours: ['2026-01-22', '2026-02-15', '2026-03-11', '2026-04-05', '2026-04-30', '2026-05-25', '2026-06-20'],
    texte: "Constatation de dégradations légères sur un équipement technique isolé (armoire, clôture d'accès). Aucune revendication. Mode opératoire discret, nocturne, sans effraction majeure.",
    mots: ['équipement technique', 'sabotage discret', 'nocturne'] },
  { code: 'reperage-exploitation', theme: 'atteintes aux biens',
    titre: 'Repérage suspect en zone d\'exploitation agricole',
    ggds: ['GGD 53', 'GGD 49', 'GGD 85', 'GGD 72'],
    jours: ['2026-02-09', '2026-03-02', '2026-03-28', '2026-04-21', '2026-05-14', '2026-06-06', '2026-07-01'],
    texte: "Véhicule de tourisme observé stationnant à proximité d'exploitations agricoles isolées, occupants observant les hangars. Départ à l'arrivée d'un tiers. Aucun vol constaté ce jour ; comportement d'observation. Immatriculation relevée incomplète.",
    mots: ['exploitation agricole', 'repérage', 'hangar'] },
];

function fmtInsert(f) {
  const lines = [];
  lines.push(
    `INSERT INTO frs (date_redaction, titre, unite, code_ggd, departement, thematique, texte) VALUES ` +
    `('${f.date}', '${esc(f.titre)}', '${esc(f.unite)}', '${f.ggd}', '${esc(f.dep)}', '${esc(f.theme)}', '${esc(f.texte)}') RETURNING id \\gset frs_`
  );
  // On insère les mots-clés via une sous-requête sur la dernière fiche (currval de la séquence).
  f.mots.forEach((mot, i) => {
    lines.push(`INSERT INTO frs_mot_cle (frs_id, mot, ordre) VALUES (currval('frs_id_seq'), '${esc(mot)}', ${i});`);
  });
  return lines.join('\n');
}

// NB : \\gset est psql-spécifique ; pour rester portable on utilise plutôt currval après
// chaque INSERT ... (voir ci-dessous, on n'émet PAS le RETURNING \\gset).
function fmtInsertPortable(f) {
  const out = [];
  out.push(
    `INSERT INTO frs (date_redaction, titre, unite, code_ggd, departement, thematique, texte) VALUES ` +
    `('${f.date}', '${esc(f.titre)}', '${esc(f.unite)}', '${f.ggd}', '${esc(f.dep)}', '${esc(f.theme)}', '${esc(f.texte)}');`
  );
  f.mots.forEach((mot, i) => {
    out.push(`INSERT INTO frs_mot_cle (frs_id, mot, ordre) VALUES (currval('frs_id_seq'), '${esc(mot)}', ${i});`);
  });
  return out.join('\n');
}

function daysBetween(start, end) {
  const out = [];
  const d = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (d <= last) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

const fiches = [];

// 1) Bruit de fond : 2 à 4 fiches / jour, GGD et thème variés.
for (const day of daysBetween('2026-01-01', '2026-07-18')) {
  const n = 2 + Math.floor(rng() * 3); // 2..4
  for (let k = 0; k < n; k++) {
    const g = pick(GGDS);
    const th = pick(THEMES);
    const idx = Math.floor(rng() * th.titres.length);
    fiches.push({
      date: day, ggd: g.ggd, dep: g.dep, unite: pick(g.unites),
      theme: th.theme, titre: th.titres[idx % th.titres.length],
      texte: pick(th.textes), mots: th.mots.slice(),
    });
  }
}

// 2) Trames : une fiche par (jour, ggd) prévu, mot-clé technique ajouté.
for (const tr of TRAMES) {
  tr.jours.forEach((day, i) => {
    const ggd = tr.ggds[i % tr.ggds.length];
    const g = GGDS.find((x) => x.ggd === ggd);
    fiches.push({
      date: day, ggd, dep: g.dep, unite: pick(g.unites),
      theme: tr.theme, titre: tr.titre, texte: tr.texte,
      mots: [...tr.mots, `signal-faible:${tr.code}`],
    });
  });
}

// Tri par date pour un fichier lisible.
fiches.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const header = `-- Seed FRS généré par generate.mjs (déterministe, graine 20260118). NE PAS éditer à la main.\n` +
  `-- ${fiches.length} fiches, 2026-01-01 → 2026-07-18. Identités fictives, catégories GIPASP.\nBEGIN;\n`;
const body = fiches.map(fmtInsertPortable).join('\n');
const footer = `\nCOMMIT;\n`;

writeFileSync(new URL('./frs_seed.sql', import.meta.url), header + body + footer);
console.error(`écrit frs_seed.sql : ${fiches.length} fiches`);
```

> **Note d'implémentation :** garder **uniquement** `fmtInsertPortable` (via `currval('frs_id_seq')`, portable psql/node-pg). La fonction `fmtInsert` avec `\gset` est laissée en commentaire pédagogique — la supprimer si l'oxlint « unused » proteste (`git rm` non requis, simple suppression du bloc).

- [ ] **Step 4: générer le seed**

Run: `node server/rens-api/seed/generate.mjs`
Expected (stderr): `écrit frs_seed.sql : <N> fiches` avec 400 ≤ N ≤ 800.

- [ ] **Step 5: lancer le test du seed (passe)**

Run: `cd server/rens-api && node --test seed/frs_seed.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: commit**

```bash
git add server/rens-api/seed/generate.mjs server/rens-api/seed/frs_seed.sql server/rens-api/seed/frs_seed.test.mjs
git commit -m "feat(rens-api): seed FRS déterministe + 3 trames signaux faibles"
```

---

## Task 5: IAka — runRensSynthese + extraction du markdown

**Files:**
- Modify: `server/iaka.mjs`
- Create: `server/rens.mjs`
- Test: `server/rens.test.mjs`

**Interfaces:**
- Consumes: `execWorkflow` (existant dans `iaka.mjs`).
- Produces: `runRensSynthese({ prompt, cfg, fetchImpl?, sleep? }) => Promise<string>` (result brut) ; `extractSynthese(result: string) => string` (markdown narratif). Erreur `RENS_INVALIDE` si vide.

- [ ] **Step 1: ajouter `runRensSynthese` dans `iaka.mjs`** (après `runWorkflowRaw`)

```js
// RENS : prompt langage naturel → result brut (chaîne). Le proxy extrait le markdown
// narratif (extractSynthese). L'agent IAka lit les fiches via MCP Postgres read-only.
export async function runRensSynthese({ prompt, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  return execWorkflow({ prompt, appId: cfg.rensAppId, cfg, fetchImpl, sleep });
}
```

- [ ] **Step 2: écrire le test de `extractSynthese` (échoue)**

`server/rens.test.mjs` :

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { extractSynthese } from './rens.mjs';

test('extractSynthese : retire la trace <tool>…</tool>, garde le markdown', () => {
  const raw = `<tool>execute_sql<tool-output>{"data":[]}</tool-output></tool>\n\n## Synthèse\nTrois fiches ce jour.`;
  assert.strictEqual(extractSynthese(raw), '## Synthèse\nTrois fiches ce jour.');
});

test('extractSynthese : déballe une fence markdown englobante', () => {
  const raw = '```markdown\n**Tendance** : hausse.\n```';
  assert.strictEqual(extractSynthese(raw), '**Tendance** : hausse.');
});

test('extractSynthese : conserve un tableau GFM', () => {
  const raw = `<tool>x<tool-output>{}</tool-output></tool>\n| Thème | N |\n| --- | --- |\n| Rodéos | 3 |`;
  assert.match(extractSynthese(raw), /\| Thème \| N \|/);
});

test('extractSynthese : vide → RENS_INVALIDE', () => {
  assert.throws(() => extractSynthese('<tool>x<tool-output>{}</tool-output></tool>'), /RENS_INVALIDE/);
  assert.throws(() => extractSynthese(42), /RENS_INVALIDE/);
});
```

- [ ] **Step 3: lancer (échoue)**

Run: `node --test server/rens.test.mjs`
Expected: FAIL — `Cannot find module './rens.mjs'`.

- [ ] **Step 4: implémenter `server/rens.mjs`**

```js
// Extrait le markdown narratif du result IAka de synthèse RENS : on retire la trace
// d'agent <tool>…</tool> (qui contient <tool-output>{JSON}</tool-output>) et on déballe
// une éventuelle fence markdown englobante. On NE déballe PAS les tableaux GFM (ils
// doivent rester tels quels pour le rendu react-markdown).
export function extractSynthese(result) {
  if (typeof result !== 'string') throw new Error('RENS_INVALIDE');
  let text = result.replace(/<tool>[\s\S]*?<\/tool>/gi, '').trim();
  const fence = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  if (fence) text = fence[1].trim();
  if (!text) throw new Error('RENS_INVALIDE');
  return text;
}
```

- [ ] **Step 5: lancer (passe)**

Run: `node --test server/rens.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: commit**

```bash
git add server/iaka.mjs server/rens.mjs server/rens.test.mjs
git commit -m "feat(rens): runRensSynthese + extraction markdown narratif"
```

---

## Task 6: Proxy — routes RENS (liste + synthèse) + config

**Files:**
- Modify: `server/proxy.mjs`
- Modify: `.env.example`
- Test: `server/proxy.test.mjs`

**Interfaces:**
- Consumes: `runRensSynthese` (Task 5), `extractSynthese` (Task 5), `forward` vers `rens-api`.
- Produces: `GET /api/rens/fiches` (relaie vers rens-api), `GET /api/rens/fiche?id=` (relaie), `POST /api/rens/synthese` `{ prompt }` → `{ markdown }`. Config `cfg.rensApiUrl`, `cfg.rensApiToken`, `cfg.rensAppId`.

- [ ] **Step 1: imports + statuts d'erreur + routes de forward**

Dans `server/proxy.mjs`, modifier l'import iaka (ligne 4) :

```js
import { runWorkflow, runWorkflowRaw, runRensSynthese } from "./iaka.mjs";
```

Ajouter l'import (près de la ligne 8) :

```js
import { extractSynthese } from "./rens.mjs";
```

Ajouter dans `ERROR_STATUS` (objet ligne 10) :

```js
  RENS_UPSTREAM: 502,
  RENS_INVALIDE: 502,
```

Ajouter, après la fonction `forwardRgp` (vers ligne 60), un forward RENS :

```js
async function forwardRens(req, res, cfg, fetchImpl, path, search) {
  try {
    const headers = {};
    if (cfg.rensApiToken) headers.Authorization = "Bearer " + cfg.rensApiToken;
    const upstream = await fetchImpl((cfg.rensApiUrl || "") + path + (search || ""), { method: "GET", headers });
    const text = await upstream.text();
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    console.error("rens_forward_error", e.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "RENS_UPSTREAM" }));
  }
}
```

- [ ] **Step 2: signature `createHandler` + routes dans le handler**

Modifier la signature de `createHandler` (ligne 142) pour injecter le stub de synthèse (testabilité) :

```js
export function createHandler({ cfg, run = runWorkflow, runRaw = runWorkflowRaw, identify = runIdentify, synthese = runSynthese, pvtcmp = runPvtcmp, rensSynthese = runRensSynthese, fetchImpl = fetch, minioClient }) {
```

Ajouter, juste après le bloc `if (rgpKey in RGP_ROUTES) {…}` (vers ligne 148) :

```js
    if (url.pathname === "/api/rens/fiches" && req.method === "GET") {
      return forwardRens(req, res, cfg, fetchImpl, "/fiches", url.search);
    }
    if (url.pathname === "/api/rens/fiche" && req.method === "GET") {
      const id = (url.searchParams.get("id") || "").replace(/[^0-9]/g, "");
      if (!id) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "ID_REQUIS" })); return; }
      return forwardRens(req, res, cfg, fetchImpl, "/fiches/" + id, "");
    }
    if (url.pathname === "/api/rens/synthese" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { prompt } = JSON.parse(raw || "{}");
        if (!prompt || typeof prompt !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "PROMPT_REQUIS" }));
          return;
        }
        // L'agent ne connaît pas la date du jour : on la préfixe (comme RGP) pour résoudre
        // « aujourd'hui / ce jour / cette semaine ».
        const today = new Date().toISOString().slice(0, 10);
        const dated = `(Contexte : la date du jour est ${today}. Interprète « aujourd'hui », « ce jour », « cette semaine » à partir de là. La base couvre 2026-01-01 à 2026-07-18.)\n${prompt}`;
        // L'agent décrit parfois l'appel d'outil au lieu de l'exécuter (variance LLM) : le
        // result n'a alors pas de <tool-output>. Lecture seule → réessai sans risque.
        const maxAttempts = cfg.maxAttempts ?? 3;
        let result;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          result = await rensSynthese({ prompt: dated, cfg, fetchImpl });
          if (result && result.includes("<tool-output>")) break;
        }
        const markdown = extractSynthese(result);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ markdown }));
      } catch (e) {
        const status = ERROR_STATUS[e.message] ?? 500;
        // FRS à diffusion restreinte : pas de dump du contenu sur erreur connue.
        if (!(e.message in ERROR_STATUS)) console.error(e.message);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
```

- [ ] **Step 3: config (bloc de démarrage direct, vers ligne 322)**

Ajouter dans l'objet `cfg` :

```js
    rensAppId: process.env.IAKA_RENS_APP_ID, // synthèse RENS (/api/rens/synthese)
    rensApiUrl: process.env.RENS_API_URL || "http://localhost:8081",
    rensApiToken: process.env.RENS_API_TOKEN,
```

- [ ] **Step 4: `.env.example`** — ajouter :

```
# RENS (base FRS + synthèse)
IAKA_RENS_APP_ID=
RENS_API_URL=http://localhost:8081
RENS_API_TOKEN=
```

- [ ] **Step 5: écrire les tests proxy (échouent)**

Ajouter à `server/proxy.test.mjs` (mêmes helpers `createHandler`/`createServer` déjà importés) :

```js
test("GET /api/rens/fiches relaie vers rens-api avec le token", async () => {
  let seen;
  const fetchImpl = async (u, init) => { seen = { u, auth: init.headers.Authorization }; return new Response(JSON.stringify({ data: [] }), { status: 200 }); };
  const h = createHandler({ cfg: { rensApiUrl: "http://x:8081", rensApiToken: "tok" }, fetchImpl });
  const res = await inject(h, "GET", "/api/rens/fiches?date=2026-03-04");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(seen.u, "http://x:8081/fiches?date=2026-03-04");
  assert.strictEqual(seen.auth, "Bearer tok");
});

test("GET /api/rens/fiche?id=12 relaie vers /fiches/12", async () => {
  let seen;
  const fetchImpl = async (u) => { seen = u; return new Response(JSON.stringify({ data: { id: 12 } }), { status: 200 }); };
  const h = createHandler({ cfg: { rensApiUrl: "http://x:8081" }, fetchImpl });
  await inject(h, "GET", "/api/rens/fiche?id=12");
  assert.strictEqual(seen, "http://x:8081/fiches/12");
});

test("POST /api/rens/synthese : préfixe la date, extrait le markdown", async () => {
  let gotPrompt;
  const rensSynthese = async ({ prompt }) => { gotPrompt = prompt; return "<tool>x<tool-output>{\"data\":[]}</tool-output></tool>\n\n## Synthèse\nRAS ce jour."; };
  const h = createHandler({ cfg: {}, rensSynthese });
  const res = await inject(h, "POST", "/api/rens/synthese", { prompt: "synthèse du 4 mars" });
  assert.strictEqual(res.status, 200);
  assert.match(gotPrompt, /date du jour est \d{4}-\d{2}-\d{2}/);
  assert.strictEqual(JSON.parse(res.body).markdown, "## Synthèse\nRAS ce jour.");
});

test("POST /api/rens/synthese : prompt manquant → 400", async () => {
  const h = createHandler({ cfg: {}, rensSynthese: async () => "" });
  const res = await inject(h, "POST", "/api/rens/synthese", {});
  assert.strictEqual(res.status, 400);
  assert.strictEqual(JSON.parse(res.body).error, "PROMPT_REQUIS");
});
```

> **Adapter aux helpers du fichier :** `server/proxy.test.mjs` utilise déjà un pattern d'appel (via `createServer(createHandler(...))` + requête HTTP, cf. lignes 11/92). Réutiliser le helper existant du fichier (`inject`/`request`/`fetch` local) au lieu d'en inventer un : lire les 30 premières lignes du fichier et calquer exactement la forme des tests RGP voisins (lignes 92-140).

- [ ] **Step 6: lancer (passe)**

Run: `node --test server/proxy.test.mjs`
Expected: PASS (tests RENS ajoutés inclus).

- [ ] **Step 7: commit**

```bash
git add server/proxy.mjs server/proxy.test.mjs .env.example
git commit -m "feat(proxy): routes RENS (liste + synthèse) + config"
```

---

## Task 7: Front — API client `rensApi.ts`

**Files:**
- Create: `src/features/rens/rensApi.ts`
- Test: `src/features/rens/rensApi.test.ts`

**Interfaces:**
- Produces:
  - `type Fiche = { id: number; date_redaction: string; titre: string; unite: string; code_ggd: string; departement: string; thematique: string; mots_cles: string[]; texte: string }`
  - `type FicheFilters = { date?: string; ggd?: string; theme?: string; q?: string }`
  - `fetchFiches(filters: FicheFilters, fetchImpl?): Promise<Fiche[]>`
  - `sendRensPrompt(prompt: string, fetchImpl?): Promise<string>` (le markdown)

- [ ] **Step 1: écrire le test (échoue)**

`src/features/rens/rensApi.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { fetchFiches, sendRensPrompt } from "./rensApi";

describe("fetchFiches", () => {
  it("construit la query string et renvoie data", async () => {
    let url = "";
    const fake: typeof fetch = async (u) => {
      url = String(u);
      return new Response(JSON.stringify({ data: [{ id: 1, date_redaction: "2026-03-04", titre: "T", unite: "U", code_ggd: "GGD 49", departement: "Maine-et-Loire", thematique: "rodéos", mots_cles: ["rodéo"], texte: "x" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const out = await fetchFiches({ date: "2026-03-04", ggd: "GGD 49" }, fake);
    expect(url).toContain("/api/rens/fiches?");
    expect(url).toContain("date=2026-03-04");
    expect(url).toContain("ggd=GGD+49");
    expect(out).toHaveLength(1);
    expect(out[0].mots_cles).toEqual(["rodéo"]);
  });

  it("erreur HTTP → throw le code", async () => {
    const fake: typeof fetch = async () => new Response(JSON.stringify({ error: "RENS_UPSTREAM" }), { status: 502 });
    await expect(fetchFiches({}, fake)).rejects.toThrow("RENS_UPSTREAM");
  });
});

describe("sendRensPrompt", () => {
  it("poste le prompt et renvoie le markdown", async () => {
    const fake: typeof fetch = async (_u, init) => {
      expect(JSON.parse((init!.body as string)).prompt).toBe("synthèse du jour");
      return new Response(JSON.stringify({ markdown: "## Synthèse" }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    expect(await sendRensPrompt("synthèse du jour", fake)).toBe("## Synthèse");
  });

  it("erreur HTTP → throw le code", async () => {
    const fake: typeof fetch = async () => new Response(JSON.stringify({ error: "IAKA_TIMEOUT" }), { status: 504 });
    await expect(sendRensPrompt("x", fake)).rejects.toThrow("IAKA_TIMEOUT");
  });
});
```

- [ ] **Step 2: lancer (échoue)**

Run: `npm test -- src/features/rens/rensApi.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: implémenter `rensApi.ts`**

```ts
export type Fiche = {
  id: number;
  date_redaction: string;
  titre: string;
  unite: string;
  code_ggd: string;
  departement: string;
  thematique: string;
  mots_cles: string[];
  texte: string;
};

export type FicheFilters = { date?: string; ggd?: string; theme?: string; q?: string };

async function orThrow(res: Response): Promise<unknown> {
  if (!res.ok) {
    let code = "ERREUR_INCONNUE";
    try { code = ((await res.json()) as { error?: string }).error ?? code; } catch { /* ignore */ }
    throw new Error(code);
  }
  return res.json();
}

export async function fetchFiches(filters: FicheFilters, fetchImpl: typeof fetch = fetch): Promise<Fiche[]> {
  const p = new URLSearchParams();
  if (filters.date) p.set("date", filters.date);
  if (filters.ggd) p.set("ggd", filters.ggd);
  if (filters.theme) p.set("theme", filters.theme);
  if (filters.q) p.set("q", filters.q);
  const res = await fetchImpl("/api/rens/fiches?" + p.toString());
  const body = (await orThrow(res)) as { data: Fiche[] };
  return body.data ?? [];
}

export async function sendRensPrompt(prompt: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl("/api/rens/synthese", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const body = (await orThrow(res)) as { markdown: string };
  return body.markdown ?? "";
}
```

- [ ] **Step 4: lancer (passe)**

Run: `npm test -- src/features/rens/rensApi.test.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/features/rens/rensApi.ts src/features/rens/rensApi.test.ts
git commit -m "feat(rens/front): client API (fetchFiches, sendRensPrompt)"
```

---

## Task 8: Front — store persisté `rensStore.ts`

**Files:**
- Create: `src/features/rens/rensStore.ts`
- Test: `src/features/rens/rensStore.test.ts`

**Interfaces:**
- Consumes: `createPersistedStore` (`src/lib/createPersistedStore`), `fetchFiches`, `sendRensPrompt`, `Fiche`, `FicheFilters` (Task 7).
- Produces:
  - `type RensState = { filters: FicheFilters; fiches: Fiche[]; loadingList: boolean; listError?: string; prompt: string; markdown?: string; synthError?: string; pending: boolean }`
  - `setFilters(patch: Partial<FicheFilters>): void`, `loadFiches(): Promise<void>`, `setPrompt(v: string): void`, `runSynthese(): Promise<void>`, `useRens` (hook), `snapshotForTest()`.

- [ ] **Step 1: écrire le test (échoue)**

`src/features/rens/rensStore.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("rensStore", () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetModules(); vi.restoreAllMocks(); });
  afterEach(() => sessionStorage.clear());

  it("loadFiches : remplit la liste", async () => {
    vi.doMock("./rensApi", () => ({
      fetchFiches: vi.fn().mockResolvedValue([{ id: 1, titre: "T" }]),
      sendRensPrompt: vi.fn(),
    }));
    const store = await import("./rensStore");
    await store.loadFiches();
    const s = store.snapshotForTest();
    expect(s.fiches).toHaveLength(1);
    expect(s.loadingList).toBe(false);
  });

  it("runSynthese : renseigne markdown, libère pending", async () => {
    vi.doMock("./rensApi", () => ({
      fetchFiches: vi.fn(),
      sendRensPrompt: vi.fn().mockResolvedValue("## Synthèse"),
    }));
    const store = await import("./rensStore");
    store.setPrompt("synthèse du jour");
    await store.runSynthese();
    const s = store.snapshotForTest();
    expect(s.markdown).toBe("## Synthèse");
    expect(s.pending).toBe(false);
  });

  it("runSynthese : erreur mappée", async () => {
    vi.doMock("./rensApi", () => ({
      fetchFiches: vi.fn(),
      sendRensPrompt: vi.fn().mockRejectedValue(new Error("IAKA_TIMEOUT")),
    }));
    const store = await import("./rensStore");
    store.setPrompt("x");
    await store.runSynthese();
    expect(store.snapshotForTest().synthError).toMatch(/dépassé/i);
  });

  it("filtres persistés en sessionStorage", async () => {
    vi.doMock("./rensApi", () => ({ fetchFiches: vi.fn(), sendRensPrompt: vi.fn() }));
    const store = await import("./rensStore");
    store.setFilters({ ggd: "GGD 49" });
    expect(sessionStorage.getItem("rens:etat")).toContain("GGD 49");
  });
});
```

- [ ] **Step 2: lancer (échoue)**

Run: `npm test -- src/features/rens/rensStore.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: implémenter `rensStore.ts`**

```ts
import { createPersistedStore } from "../../lib/createPersistedStore";
import { fetchFiches, sendRensPrompt, type Fiche, type FicheFilters } from "./rensApi";

// État de l'écran RENS conservé hors composant : filtres + liste + conversation de
// synthèse survivent aux changements de vue. Les requêtes tournent ICI.

const MESSAGES: Record<string, string> = {
  IAKA_TIMEOUT: "Délai dépassé. Réessayez.",
  IAKA_UPSTREAM: "Service de synthèse indisponible. Réessayez.",
  RENS_UPSTREAM: "Base RENS indisponible. Réessayez.",
  RENS_INVALIDE: "Réponse de synthèse vide. Reformulez.",
  ERREUR_INCONNUE: "Erreur inconnue.",
};
const msg = (code: string) => MESSAGES[code] ?? code;

export type RensState = {
  filters: FicheFilters;
  fiches: Fiche[];
  loadingList: boolean;
  listError?: string;
  prompt: string;
  markdown?: string;
  synthError?: string;
  pending: boolean;
};

const store = createPersistedStore<RensState>(
  { filters: {}, fiches: [], loadingList: false, prompt: "", pending: false },
  {
    key: "rens:etat",
    keys: ["filters", "prompt"],
    write: (s) => JSON.stringify({ filters: s.filters, prompt: s.prompt }),
    read: (raw) => {
      const { filters, prompt } = JSON.parse(raw) as { filters?: FicheFilters; prompt?: string };
      return { filters: filters ?? {}, prompt: prompt ?? "" };
    },
  }
);

export function setFilters(patch: Partial<FicheFilters>) {
  store.set({ filters: { ...store.get().filters, ...patch } });
}

export async function loadFiches() {
  store.set({ loadingList: true, listError: undefined });
  try {
    const fiches = await fetchFiches(store.get().filters);
    store.set({ fiches, loadingList: false });
  } catch (e) {
    store.set({ loadingList: false, listError: msg((e as Error).message) });
  }
}

export function setPrompt(prompt: string) {
  store.set({ prompt });
}

export async function runSynthese() {
  const p = store.get().prompt.trim();
  if (!p || store.get().pending) return;
  store.set({ pending: true, markdown: undefined, synthError: undefined });
  try {
    const markdown = await sendRensPrompt(p);
    store.set({ markdown, pending: false });
  } catch (e) {
    store.set({ synthError: msg((e as Error).message), pending: false });
  }
}

export const useRens = store.use;

export function snapshotForTest(): RensState {
  return store.get();
}
```

- [ ] **Step 4: lancer (passe)**

Run: `npm test -- src/features/rens/rensStore.test.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/features/rens/rensStore.ts src/features/rens/rensStore.test.ts
git commit -m "feat(rens/front): store persisté (filtres, liste, synthèse)"
```

---

## Task 9: Front — composants FicheList + RensResult

**Files:**
- Create: `src/features/rens/RensResult.tsx`
- Create: `src/features/rens/FicheList.tsx`

**Interfaces:**
- Consumes: `Fiche` (Task 7), `react-markdown` + `remark-gfm`.
- Produces: `<RensResult markdown={string} />` (rendu markdown accordé à la charte) ; `<FicheList fiches={Fiche[]} loading={boolean} error={string?} />`.

- [ ] **Step 1: `RensResult.tsx`** (rendu markdown, calqué `RgpResult`)

```tsx
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Rendu markdown accordé à la charte (tableaux GFM, gras, listes).
const mdComponents: Components = {
  table: ({ children }) => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: "2px solid #ddd", color: "#5C5F63", whiteSpace: "nowrap" }}>{children}</th>
  ),
  td: ({ children }) => <td style={{ padding: "6px 10px", borderBottom: "1px solid #eee" }}>{children}</td>,
  p: ({ children }) => <p style={{ margin: "0 0 8px" }}>{children}</p>,
  a: ({ children, href }) => <a href={href} style={{ color: "#000091" }}>{children}</a>,
};

export default function RensResult({ markdown }: { markdown: string }) {
  return (
    <div style={{ lineHeight: 1.5 }}>
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{markdown}</Markdown>
    </div>
  );
}
```

- [ ] **Step 2: `FicheList.tsx`** (liste read-only, sans emoji)

```tsx
import type { Fiche } from "./rensApi";

// Mots-clés techniques masqués de l'UI (usage interne aux trames signaux faibles).
const motVisible = (m: string) => !m.startsWith("signal-faible:");

function FicheCard({ f }: { f: Fiche }) {
  return (
    <article style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "#5C5F63" }}>
        <span>{f.date_redaction}</span>
        <span>{f.code_ggd} — {f.unite}</span>
      </div>
      <h3 style={{ fontSize: 15, margin: "4px 0 6px", color: "#161616" }}>{f.titre}</h3>
      <div style={{ fontSize: 12, color: "#000091", marginBottom: 6 }}>{f.thematique}</div>
      <p style={{ fontSize: 13, lineHeight: 1.5, color: "#3a3a3a", margin: "0 0 8px" }}>{f.texte}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {f.mots_cles.filter(motVisible).map((m) => (
          <span key={m} style={{ fontSize: 11, background: "#ececff", color: "#000091", borderRadius: 10, padding: "2px 8px" }}>{m}</span>
        ))}
      </div>
    </article>
  );
}

export default function FicheList({ fiches, loading, error }: { fiches: Fiche[]; loading: boolean; error?: string }) {
  if (loading) return <p style={{ color: "#5C5F63", fontSize: 14 }}>Chargement des fiches…</p>;
  if (error) return <p role="alert" style={{ color: "#e1000f", fontSize: 14 }}>{error}</p>;
  if (fiches.length === 0) return <p style={{ color: "#8a8a99", fontSize: 14 }}>Aucune fiche. Ajustez les filtres.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "#5C5F63" }}>{fiches.length} fiche(s)</div>
      {fiches.map((f) => <FicheCard key={f.id} f={f} />)}
    </div>
  );
}
```

- [ ] **Step 3: vérifier le typecheck**

Run: `npx tsc -b --noEmit`
Expected: pas d'erreur sur ces fichiers.

- [ ] **Step 4: commit**

```bash
git add src/features/rens/RensResult.tsx src/features/rens/FicheList.tsx
git commit -m "feat(rens/front): composants FicheList + RensResult"
```

---

## Task 10: Front — écran `RensApp.tsx` + wiring nav

**Files:**
- Create: `src/features/rens/RensApp.tsx`
- Test: `src/features/rens/RensApp.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useRens`, `setFilters`, `loadFiches`, `setPrompt`, `runSynthese` (Task 8) ; `FicheList`, `RensResult` (Task 9).
- Produces: écran par défaut route `/app/rens`, entrée `NAV`.

- [ ] **Step 1: écrire le test (échoue)**

`src/features/rens/RensApp.test.tsx` :

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

describe("RensApp", () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetModules(); vi.restoreAllMocks(); });

  it("charge les fiches au montage et les affiche", async () => {
    vi.doMock("./rensApi", () => ({
      fetchFiches: vi.fn().mockResolvedValue([
        { id: 1, date_redaction: "2026-03-04", titre: "Rodéos", unite: "COB Segré-en-Anjou Bleu", code_ggd: "GGD 49", departement: "Maine-et-Loire", thematique: "violences urbaines", mots_cles: ["rodéo"], texte: "…" },
      ]),
      sendRensPrompt: vi.fn().mockResolvedValue("## Synthèse\nRAS."),
    }));
    const { default: RensApp } = await import("./RensApp");
    render(<RensApp />);
    await waitFor(() => expect(screen.getByText("Rodéos")).toBeInTheDocument());
    expect(screen.getByText(/1 fiche/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: lancer (échoue)**

Run: `npm test -- src/features/rens/RensApp.test.tsx`
Expected: FAIL — module introuvable.

- [ ] **Step 3: implémenter `RensApp.tsx`** (2 zones, sans emoji)

```tsx
import { useEffect } from "react";
import { Button } from "@gouvfr-lasuite/cunningham-react";
import FicheList from "./FicheList";
import RensResult from "./RensResult";
import { useRens, setFilters, loadFiches, setPrompt, runSynthese } from "./rensStore";

const GGDS = ["GGD 49", "GGD 44", "GGD 53", "GGD 72", "GGD 85"];

export default function RensApp() {
  const s = useRens();

  // Charge la liste au montage et à chaque changement de filtre.
  useEffect(() => { loadFiches(); }, [s.filters.date, s.filters.ggd, s.filters.theme, s.filters.q]);

  function submit(e: React.FormEvent) { e.preventDefault(); runSynthese(); }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(340px, 1fr)", gap: 24, padding: "1.5rem 2rem 2rem", height: "100%", boxSizing: "border-box", minWidth: 0 }}>
      {/* Colonne gauche : filtres + liste */}
      <section style={{ minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <h1 style={{ fontSize: 20, color: "#000091", margin: "0 0 10px" }}>RENS — Fiches de renseignement</h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <input type="date" aria-label="Date de rédaction" value={s.filters.date ?? ""} onChange={(e) => setFilters({ date: e.target.value })}
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }} />
          <select aria-label="Groupement" value={s.filters.ggd ?? ""} onChange={(e) => setFilters({ ggd: e.target.value })}
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}>
            <option value="">Tous les GGD</option>
            {GGDS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <input type="text" aria-label="Recherche" placeholder="Recherche mot-clé / texte" value={s.filters.q ?? ""} onChange={(e) => setFilters({ q: e.target.value })}
            style={{ flex: 1, minWidth: 140, padding: "8px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }} />
        </div>
        <div style={{ overflowY: "auto", paddingRight: 4 }}>
          <FicheList fiches={s.fiches} loading={s.loadingList} error={s.listError} />
        </div>
      </section>

      {/* Colonne droite : synthèse IAka */}
      <section style={{ minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <h2 style={{ fontSize: 16, color: "#161616", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="material-icons" aria-hidden style={{ color: "#000091", fontSize: 20 }}>auto_awesome</span>
          Synthèse & signaux faibles
        </h2>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <textarea aria-label="Demande de synthèse" rows={3} value={s.prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ex : synthèse des fiches du 4 mars 2026 ; tendances par thématique cette semaine ; signaux faibles récurrents"
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc", fontSize: 14, resize: "vertical" }} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button type="submit" disabled={s.pending || !s.prompt.trim()}>{s.pending ? "Analyse…" : "Analyser"}</Button>
          </div>
        </form>
        <div style={{ overflowY: "auto", border: "1px solid #eee", borderRadius: 12, background: "#fafafb", padding: "14px 18px", flex: 1 }}>
          {s.pending && <p style={{ color: "#5C5F63", fontSize: 14 }}>IAka analyse les fiches…</p>}
          {s.synthError && <p role="alert" style={{ color: "#e1000f", fontSize: 14 }}>{s.synthError}</p>}
          {!s.pending && !s.synthError && s.markdown && <RensResult markdown={s.markdown} />}
          {!s.pending && !s.synthError && !s.markdown && (
            <p style={{ color: "#8a8a99", fontSize: 14 }}>Posez une demande en langage naturel : synthèse d'un jour, tendances, signaux faibles.</p>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: lancer le test (passe)**

Run: `npm test -- src/features/rens/RensApp.test.tsx`
Expected: PASS.

- [ ] **Step 5: wiring `src/App.tsx`**

Ajouter l'import (après ligne 10, `import PvApp ...`) :

```tsx
import RensApp from "./features/rens/RensApp";
```

Ajouter la route (après la ligne 29 `<Route path="rgp" ...>`) :

```tsx
              <Route path="rens" element={<RensApp />} />
```

Ajouter l'entrée `NAV` (dans le tableau lignes 45-52, après l'entrée `rgp`) :

```tsx
  { to: "rens", label: "RENS", icon: "hub" },
```

- [ ] **Step 6: typecheck + suite complète**

Run: `npx tsc -b --noEmit && npm test`
Expected: pas d'erreur TS ; toute la suite vitest verte.

- [ ] **Step 7: commit**

```bash
git add src/features/rens/RensApp.tsx src/features/rens/RensApp.test.tsx src/App.tsx
git commit -m "feat(rens/front): écran RENS (liste + synthèse) + navigation"
```

---

## Task 11: Déploiement OVH — base, seed, service, réseau

**Files:** aucun fichier repo (runbook). Actions sur le serveur `ssh ovh` (conteneur `brunogauville-postgres-1`, compose `/home/brunogauville/docker-compose.yml`).

**Interfaces:**
- Consumes: migrations + seed (Tasks 1,3,4), image `rens-api` (Task 2).
- Produces: base `rens` peuplée, conteneur `rens-api` joignable, `rens_ro` autorisé pour l'IP IAka `91.134.33.159`.

> **Ce sont des actions manuelles à diffusion restreinte. Chaque commande est explicite. Les mots de passe sont générés au moment du déploiement et posés hors repo.**

- [ ] **Step 1: créer la base `rens`**

```bash
ssh ovh "docker exec -i brunogauville-postgres-1 psql -U postgres -c \"CREATE DATABASE rens;\""
```

- [ ] **Step 2: appliquer les migrations (schéma puis rôles)**

```bash
scp server/rens-api/migrations/001_frs.sql server/rens-api/migrations/002_roles.sql ovh:/tmp/
ssh ovh "docker cp /tmp/001_frs.sql brunogauville-postgres-1:/tmp/ && docker exec brunogauville-postgres-1 psql -U postgres -d rens -f /tmp/001_frs.sql"
ssh ovh "docker cp /tmp/002_roles.sql brunogauville-postgres-1:/tmp/ && docker exec brunogauville-postgres-1 psql -U postgres -d rens -f /tmp/002_roles.sql"
```

- [ ] **Step 3: poser les mots de passe des rôles (hors repo)**

```bash
# Générer deux mots de passe et les NOTER dans le gestionnaire de secrets (pas dans le repo).
PW_API=$(openssl rand -base64 24); PW_RO=$(openssl rand -base64 24)
ssh ovh "docker exec brunogauville-postgres-1 psql -U postgres -d rens -c \"ALTER ROLE rens_api PASSWORD '$PW_API'; ALTER ROLE rens_ro PASSWORD '$PW_RO';\""
echo "rens_api=$PW_API"; echo "rens_ro=$PW_RO"   # → coffre à secrets, puis effacer l'historique shell
```

- [ ] **Step 4: charger le seed**

```bash
scp server/rens-api/seed/frs_seed.sql ovh:/tmp/
ssh ovh "docker cp /tmp/frs_seed.sql brunogauville-postgres-1:/tmp/ && docker exec brunogauville-postgres-1 psql -U postgres -d rens -f /tmp/frs_seed.sql"
ssh ovh "docker exec brunogauville-postgres-1 psql -U postgres -d rens -c 'SELECT count(*) FROM frs;'"
```
Expected: le count correspond au nombre de fiches du seed (400-800).

- [ ] **Step 5: ajouter le service `rens-api` au compose OVH**

Copier le dossier service et ajouter au `docker-compose.yml` (project `brunogauville`) un service calqué sur `rgp-api` :

```bash
rsync -a --exclude node_modules --exclude seed server/rens-api/ ovh:/home/brunogauville/rens-api/
```

Bloc à insérer dans `/home/brunogauville/docker-compose.yml` (adapter au style exact du service `rgp-api` voisin — réseau, dépendance postgres, variables) :

```yaml
  rens-api:
    build: ./rens-api
    environment:
      PGHOST: postgres
      PGUSER: rens_api
      PGPASSWORD: ${RENS_API_PW:?Set in .env}
      PGDATABASE: rens
      API_TOKEN: ${RENS_API_TOKEN:?Set in .env}
    depends_on:
      - postgres
    restart: unless-stopped
    # exposé au proxy/nginx sous /rens-api (voir bloc nginx)
```

Ajouter `RENS_API_PW` (= `rens_api` PW) et `RENS_API_TOKEN` (token API partagé avec le proxy) au `.env` OVH (hors repo).

- [ ] **Step 6: route nginx `/rens-api`**

Dupliquer le bloc `location /rgp-api` de la conf nginx (`brunogauville-nginx-1`) en `/rens-api` → `rens-api:8080`, avec réécriture identique (strip du préfixe). Recharger nginx :

```bash
ssh ovh "docker exec brunogauville-nginx-1 nginx -t && docker exec brunogauville-nginx-1 nginx -s reload"
```

- [ ] **Step 7: build + up du service**

```bash
ssh ovh "cd /home/brunogauville && docker compose up -d --build rens-api"
ssh ovh "curl -s http://localhost/rens-api/health || curl -s https://carnet.kerjean.net/rens-api/health"
```
Expected: `{"data":{"ok":true}}`.

- [ ] **Step 8: autoriser `rens_ro` pour l'IP de sortie IAka**

Le firewall `DOCKER-USER` autorise déjà `91.134.33.159` vers 5432 (règle `IAKA_FW`, cf. RGP). Ajouter la règle `pg_hba` :

```bash
ssh ovh "docker exec brunogauville-postgres-1 sh -c \"echo 'host rens rens_ro 91.134.33.159/32 scram-sha-256' >> /var/lib/postgresql/data/pg_hba.conf\" && docker exec brunogauville-postgres-1 psql -U postgres -c 'SELECT pg_reload_conf();'"
```

- [ ] **Step 9: vérifier la lecture externe (facultatif, depuis un client autorisé)**

Tester que `rens_ro` peut `SELECT` mais pas écrire (comme validé pour `rgp_ro`) : un `INSERT` doit être refusé.

- [ ] **Step 10: renseigner le `.env` local du proxy**

Dans le `.env` (poste dev / hébergement du proxy), poser `RENS_API_URL=https://carnet.kerjean.net/rens-api`, `RENS_API_TOKEN=<token>`, `IAKA_RENS_APP_ID=<à obtenir Task 12>`.

- [ ] **Step 11: commit du runbook** (si des ajustements de fichiers repo ont été nécessaires, sinon rien à committer ici)

---

## Task 12: Builder IAka — app RENS + MCP Postgres read-only

**Files:**
- Create: `docs/iaka-rens-workflow.md` (runbook, calqué `docs/iaka-rgp-workflow.md`).

**Interfaces:**
- Produces: workflow IAka « RENS » (app_id → `IAKA_RENS_APP_ID`), MCP Postgres read-only sur `rens`/`rens_ro`.

- [ ] **Step 1: rédiger `docs/iaka-rens-workflow.md`**

Contenu (structure calquée sur `iaka-rgp-workflow.md`, branche lecture uniquement) :

1. **Structure cible** : `DÉBUT → Agent synthèse + MCP Postgres RO → FIN`. Pas de routage (tout est lecture).
2. **MCP Postgres RO** : MCP Toolbox PostgreSQL, hôte `91.134.75.161`, port `5432`, base `rens`, rôle `rens_ro` (SELECT-only). Rappel réseau : firewall `IAKA_FW` (IP `91.134.33.159`) + `pg_hba` (Task 11 step 8).
3. **Prompt système de l'agent synthèse** (à coller) :

```
Tu es un analyste renseignement. À partir d'une demande en langage naturel d'un militaire,
tu interroges la base RENS des fiches de renseignement simplifiées (FRS) en appelant ton outil
execute_sql (UNE requête SELECT), PUIS tu RÉDIGES une réponse en markdown fondée UNIQUEMENT sur
les fiches remontées.

BASE (lecture seule) :
- Table frs(id, date_redaction, titre, unite, code_ggd, departement, thematique, texte).
- Table frs_mot_cle(frs_id, mot, ordre) — mots-clés (LEFT JOIN pour les remonter).
- La base couvre 2026-01-01 à 2026-07-18. Le proxy te préfixe la date du jour.

STRATÉGIE DE REQUÊTE — choisis selon la demande :

(A) SYNTHÈSE D'UN JOUR / D'UNE PÉRIODE COURTE / D'UN THÈME PRÉCIS → **récupération directe** :
- UNE requête SELECT filtrée (date_redaction, code_ggd, thematique) remontant titre, texte,
  date, unite, code_ggd, thematique + array_agg des mots-clés. LIMIT 60. Puis narre.

(B) SIGNAUX FAIBLES / TENDANCES SUR PLUSIEURS SEMAINES/MOIS → **découverte par agrégation
    D'ABORD, puis drill-in** (ne JAMAIS tenter de tout récupérer en brut : un signal faible
    est ~5-15 fiches dispersées dans des centaines, il ne serait pas dans un LIMIT 60) :
  1. Requête d'AGRÉGATION : regroupe par mot-clé, garde les phénomènes rares-mais-dispersés.
     EXCLUS toujours les marqueurs techniques (mot NOT LIKE 'signal-faible:%').
       SELECT m.mot, count(*) AS n, count(DISTINCT f.code_ggd) AS depts,
              min(f.date_redaction) AS debut, max(f.date_redaction) AS fin
       FROM frs f JOIN frs_mot_cle m ON m.frs_id=f.id
       WHERE m.mot NOT LIKE 'signal-faible:%'
       GROUP BY m.mot
       HAVING count(*) BETWEEN 5 AND 20 AND count(DISTINCT f.code_ggd) >= 3
       ORDER BY depts DESC, n DESC;
     → les mots très fréquents (thèmes de fond) sont exclus par la borne haute ; il reste les
       signaux faibles (mineurs mais dispersés géographiquement et dans le temps).
  2. DRILL-IN : pour le(s) candidat(s) le(s) plus saillant(s), récupère les fiches par ce
     mot-clé NATUREL (jamais le marqueur technique) pour narrer :
       SELECT f.date_redaction, f.code_ggd, f.unite, f.titre, f.texte
       FROM frs f JOIN frs_mot_cle m ON m.frs_id=f.id
       WHERE m.mot='faux agent' ORDER BY f.date_redaction;

- Tu DOIS réellement APPELER execute_sql (tool call). Ne te contente jamais de décrire l'appel.

RÉDACTION (markdown) :
- Synthèse d'un jour → un paragraphe + les faits saillants.
- Tendances (« par thématique / par département / cette semaine ») → tableau markdown GFM.
- Signaux faibles → présente le(s) phénomène(s) MINEUR(S) mais RÉCURRENT(S) et DISPERSÉS
  remontés par l'agrégation : nomme le phénomène, sa fenêtre temporelle (debut→fin), le nombre
  de départements touchés, et cite quelques dates/unités du drill-in. Explique pourquoi c'est
  invisible fiche par fiche.
- Fonde-toi UNIQUEMENT sur les fiches remontées. N'invente rien. Si rien de saillant, dis-le.
```

4. **Tool à attacher** : `execute_sql` du MCP Toolbox pointé sur `rens` (obtenir le tool_id côté builder). Isolation : lecture seule, jamais d'écriture.
5. **Récupérer l'`app_id`** du workflow → le poser en `IAKA_RENS_APP_ID` (proxy).
6. **Exemples de requêtes** :

```sql
-- (A) « synthèse des fiches du 4 mars 2026 » — récupération directe
SELECT f.titre, f.texte, f.date_redaction, f.unite, f.code_ggd, f.thematique,
       COALESCE(array_agg(m.mot) FILTER (WHERE m.mot IS NOT NULL AND m.mot NOT LIKE 'signal-faible:%'), '{}') AS mots
FROM frs f LEFT JOIN frs_mot_cle m ON m.frs_id=f.id
WHERE f.date_redaction='2026-03-04'
GROUP BY f.id ORDER BY f.code_ggd LIMIT 60;

-- (B.1) « fais émerger des signaux faibles depuis janvier » — DÉCOUVERTE par agrégation
SELECT m.mot, count(*) AS n, count(DISTINCT f.code_ggd) AS depts,
       min(f.date_redaction) AS debut, max(f.date_redaction) AS fin
FROM frs f JOIN frs_mot_cle m ON m.frs_id=f.id
WHERE m.mot NOT LIKE 'signal-faible:%'
GROUP BY m.mot
HAVING count(*) BETWEEN 5 AND 20 AND count(DISTINCT f.code_ggd) >= 3
ORDER BY depts DESC, n DESC;
-- → surface p.ex. 'faux agent' (8 fiches, 4 dépts, jan→juin), 'exploitation agricole', etc.

-- (B.2) drill-in sur le candidat, par mot-clé NATUREL
SELECT f.date_redaction, f.code_ggd, f.unite, f.titre, f.texte
FROM frs f JOIN frs_mot_cle m ON m.frs_id=f.id
WHERE m.mot='faux agent' ORDER BY f.date_redaction;
```

> **Pourquoi pas le marqueur `signal-faible:*` ?** Il est réservé au test du seed (`frs_seed.test.mjs`). Le faire découvrir/citer par l'agent fuiterait l'échafaudage : la démo doit surfacer le signal via des mots-clés NATURELS (agrégation), pas via un code caché qui présuppose la réponse.

- [ ] **Step 2: valider bout-en-bout** (une fois Task 11 + builder faits)

Depuis l'app front (`/app/rens`), demander « synthèse des fiches du 4 mars 2026 », puis « signaux faibles récurrents depuis janvier ». Vérifier que la synthèse relie une des 3 trames plantées.

- [ ] **Step 3: commit**

```bash
git add docs/iaka-rens-workflow.md
git commit -m "docs(rens): runbook workflow IAka RENS + MCP Postgres read-only"
```

---

## Self-Review

**1. Spec coverage** (spec §1-§12 → tâches) :
- §3 architecture double accès → T2 (rens-api HTTP) + T5/T11/T12 (MCP synthèse). ✓
- §4 modèle données (pas de cotation, table mots-clés) → T1 (001_frs.sql), T3 (rôles). ✓
- §5 workflow IAka mono-branche + 2 stratégies (récup directe LIMIT 60 / découverte par agrégation + drill-in) → T5 (runRensSynthese), T12 (prompt agent). Corrige le gap advisor : les signaux faibles se **découvrent par agrégation** (GROUP BY mot HAVING count 5-20, depts≥3), pas par récup brute qui les raterait. Couplé à T4 (mots-clés signatures rares non partagés + test 5-20). ✓
- §6 rens-api read-only 3 endpoints → T1/T2/T3. ✓
- §7 proxy 2+1 routes + date prefix + extraction → T6. ✓
- §8 front 1 écran + markdown + no-emoji → T7/T8/T9/T10. ✓
- §9 seed ~400-800, multi-GGD, 3 trames, reproductible → T4. ✓
- §10 déploiement OVH ordre → T11. ✓
- §11 tests → présents dans chaque tâche (node:test rens-api, vitest front, proxy). ✓
- §2 GIPASP (identités fictives, pas de PII structurée) → T1 (schéma métadonnées), T4 (textes fictifs). ✓
- §12 dette (RO, token serveur, cross-corpus itération 2) → respectée (SELECT-only, token env, LIMIT + note). ✓

**2. Placeholder scan** : le seul point à surveiller — la fonction `fmtInsert` (avec `\gset`) est laissée en commentaire pédagogique dans T4 ; la note d'implémentation dit de garder `fmtInsertPortable`. Pas de « TBD/TODO ». Les banques de textes T4 sont réelles et suffisantes pour produire un SQL valide (enrichissables). ✓

**3. Type consistency** :
- `Fiche` (T7) : `mots_cles: string[]` ← rens-api renvoie `mots_cles` via `array_agg` (T1). ✓
- `sendRensPrompt → string` (T7) ← proxy renvoie `{ markdown }` (T6) ← `extractSynthese` (T5). Cohérent. ✓
- `runRensSynthese({prompt,cfg,...})` (T5) = signature appelée par le proxy (T6) et stubbée dans les tests (T6). ✓
- `cfg.rensAppId` (T5) ← posé dans la config proxy (T6) depuis `IAKA_RENS_APP_ID`. ✓
- Route front `/api/rens/fiche?id=` (T7 n'appelle QUE `/api/rens/fiches` liste ; le détail `/api/rens/fiche` est exposé côté proxy T6 mais non consommé par le front en itération 1 — cohérent, endpoint prêt pour un futur détail). ✓

Aucune incohérence bloquante détectée.

---

## Execution Handoff

**Plan complet et sauvegardé dans `docs/superpowers/plans/2026-07-18-base-rens-frs-synthese-iaka.md`.**
