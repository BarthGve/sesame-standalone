# Contrôle qualité des FRS (GIPASP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auditer chaque nuit la conformité GIPASP des ~1 000 FRS produites la veille, et livrer au contrôleur une page listant les fiches à traiter, chaque écart rendu avec son fondement juridique.

**Architecture:** Un job Node (`server/rens-api/audit/`) découpe la production de la veille en fragments de ~40 fiches et déclenche N exécutions d'un workflow IAka fixe (3 sous-agents parallèles + jointure), avec concurrence bornée. Les écarts sont persistés dans trois tables ; le front est un pur lecteur. Les critères déterministes (`C2`, `C8`, `C10`) sont évalués en SQL, jamais par le LLM.

**Tech Stack:** Node 20 natif (`node:test`, `http`, `pg`), CommonJS pour le serveur rens-api, ESM pour les jobs, React 19 + TS + Vitest côté front.

**Spec:** `docs/superpowers/specs/2026-08-05-controle-qualite-frs-gipasp-design.md`

## Global Constraints

- **Aucun emoji dans le front.** Icônes Material Icons (`@fontsource/material-icons`) ou SVG inline uniquement.
- **`server/rens-api/*.js` est en CommonJS** (`require` / `module.exports`). **`server/rens-api/**/*.mjs` est en ESM.** Ne pas mélanger dans un même fichier.
- **Les query builders sont des fonctions pures** renvoyant `{ text, values }`, testées sans base de données. C'est le patron de `server/rens-api/fiches.js`.
- **Enveloppe HTTP rens-api** : succès `{ data }`, erreur `{ error: { code, message } }`.
- **La gravité n'est jamais lue depuis la sortie du LLM** : elle est dérivée du code de critère côté serveur (`CRITERES[code].gravite`). Un modèle ne doit pas pouvoir inflater une gravité.
- **Le mot-clé `defaut:` ne doit jamais entrer dans un prompt.** Le fragment est composé par liste blanche de champs.
- **Codes de critères** : `A1 A3 A4 B5 B6 B7 C2 C8 C9 C10 D11 D12`. Jamais renumérotés.
- Tests serveur : `node --test`. Tests front : `npm test` (Vitest). Les deux doivent passer avant chaque commit.

---

### Task 1: Migration — colonnes `frs` et tables d'audit

**Files:**
- Create: `server/rens-api/migrations/006_audit.sql`
- Create: `server/rens-api/migrations/006_audit.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces: colonnes `frs.motif`, `frs.date_evenement`, `frs.origine_info` ; tables `frs_audit_run`, `frs_audit_fragment`, `frs_audit`.

- [ ] **Step 1: Write the failing test**

Le test lit le SQL et vérifie sa forme (pas de base requise), comme `seed/frs_seed.test.mjs`.

```js
// server/rens-api/migrations/006_audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./006_audit.sql', import.meta.url), 'utf8');

test('006 : ajoute les 3 colonnes frs, toutes NULLables', () => {
  assert.match(sql, /ALTER TABLE frs ADD COLUMN motif\s+text;/);
  assert.match(sql, /ALTER TABLE frs ADD COLUMN date_evenement\s+date;/);
  assert.match(sql, /ALTER TABLE frs ADD COLUMN origine_info\s+text;/);
  assert.doesNotMatch(sql, /ADD COLUMN (motif|date_evenement|origine_info)[^;]*NOT NULL/);
});

test('006 : frs_audit_run a un jour UNIQUE (idempotence du rejeu)', () => {
  assert.match(sql, /CREATE TABLE frs_audit_run/);
  assert.match(sql, /jour\s+date NOT NULL UNIQUE/);
});

test('006 : frs_audit dédoublonne en base sur (run_id, frs_id, critere)', () => {
  assert.match(sql, /UNIQUE \(run_id, frs_id, critere\)/);
});

test('006 : les tables d\'audit cascadent depuis le run', () => {
  const cascades = sql.match(/REFERENCES frs_audit_run\(id\) ON DELETE CASCADE/g) || [];
  assert.strictEqual(cascades.length, 2, 'fragment et audit cascadent tous deux');
});

test('006 : frs_audit_fragment trace le statut, sans quoi « conforme » et « non traité » sont indiscernables', () => {
  assert.match(sql, /CREATE TABLE frs_audit_fragment/);
  assert.match(sql, /statut\s+text NOT NULL DEFAULT 'en_attente'/);
  assert.match(sql, /frs_ids\s+integer\[\] NOT NULL/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rens-api/migrations/006_audit.test.mjs`
Expected: FAIL — `ENOENT: no such file or directory ... 006_audit.sql`

- [ ] **Step 3: Write the migration**

```sql
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/rens-api/migrations/006_audit.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/rens-api/migrations/006_audit.sql server/rens-api/migrations/006_audit.test.mjs
git commit -m "feat(audit): migration des colonnes frs et des tables d'audit"
```

---

### Task 2: Référentiel des critères et des motifs

**Files:**
- Create: `server/rens-api/audit/criteres.js`
- Create: `server/rens-api/audit/criteres.test.js`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `CRITERES` — objet `{ [code]: { libelle: string, gravite: 'bloquant'|'majeur'|'mineur', famille: 'legalite'|'donnees'|'redaction'|'structurel' } }`
  - `MOTIFS` — `string[]`, référentiel fermé des motifs d'enregistrement
  - `graviteDe(code: string): string` — lève `Error` si le code est inconnu
  - `estCodeValide(code: string): boolean`

- [ ] **Step 1: Write the failing test**

```js
// server/rens-api/audit/criteres.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { CRITERES, MOTIFS, graviteDe, fondementDe, estCodeValide } = require('./criteres');

test('les 12 codes de la grille sont présents, et eux seuls', () => {
  assert.deepStrictEqual(
    Object.keys(CRITERES).sort(),
    ['A1', 'A3', 'A4', 'B5', 'B6', 'B7', 'C10', 'C2', 'C8', 'C9', 'D11', 'D12'].sort()
  );
});

test('chaque critère porte une gravité connue et une famille connue', () => {
  const gravites = ['bloquant', 'majeur', 'mineur'];
  const familles = ['legalite', 'donnees', 'redaction', 'structurel'];
  for (const [code, c] of Object.entries(CRITERES)) {
    assert.ok(gravites.includes(c.gravite), `${code} : gravité inconnue`);
    assert.ok(familles.includes(c.famille), `${code} : famille inconnue`);
    assert.ok(c.libelle.length > 3, `${code} : libellé vide`);
  }
});

test('les critères bloquants sont exactement A1, B5, C9', () => {
  const bloquants = Object.entries(CRITERES).filter(([, c]) => c.gravite === 'bloquant').map(([k]) => k);
  assert.deepStrictEqual(bloquants.sort(), ['A1', 'B5', 'C9']);
});

test('les critères structurels (SQL) sont exactement C2, C8, C10', () => {
  const struct = Object.entries(CRITERES).filter(([, c]) => c.famille === 'structurel').map(([k]) => k);
  assert.deepStrictEqual(struct.sort(), ['C10', 'C2', 'C8']);
});

test('graviteDe dérive la gravité du code, et refuse un code inconnu', () => {
  assert.strictEqual(graviteDe('A1'), 'bloquant');
  assert.strictEqual(graviteDe('D12'), 'mineur');
  assert.throws(() => graviteDe('Z9'), /Z9/);
});

test('chaque critère cite un article du CSI : sans fondement, pas de verdict opposable', () => {
  for (const [code, c] of Object.entries(CRITERES)) {
    assert.match(c.fondement, /^CSI R\. 236-\d+/, `${code} : fondement absent ou mal formé`);
  }
  assert.strictEqual(fondementDe('C8'), 'CSI R. 236-25');
  assert.throws(() => fondementDe('Z9'), /Z9/);
});

test('estCodeValide filtre ce qui vient du LLM', () => {
  assert.strictEqual(estCodeValide('B5'), true);
  assert.strictEqual(estCodeValide('b5'), false);
  assert.strictEqual(estCodeValide(''), false);
  assert.strictEqual(estCodeValide(undefined), false);
});

test('le référentiel des motifs est fermé et contient les motifs à seuil', () => {
  assert.ok(MOTIFS.includes('radicalisation'));
  assert.ok(MOTIFS.includes("sûreté de l'État"));
  assert.strictEqual(MOTIFS.length, 10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rens-api/audit/criteres.test.js`
Expected: FAIL — `Cannot find module './criteres'`

- [ ] **Step 3: Write the implementation**

```js
// server/rens-api/audit/criteres.js
// Grille de contrôle GIPASP. Source unique des codes, libellés et gravités.
// La gravité est TOUJOURS dérivée du code côté serveur : la sortie d'un agent
// n'est jamais autorisée à la fixer (un modèle ne doit pas pouvoir inflater une gravité).

// `fondement` est l'article que CE critère met en cause. Il sert de valeur par défaut
// aux écarts détectés en SQL — un écart structurel doit citer son article comme les autres,
// c'est tout l'argument de l'outil : un verdict sourcé est opposable, un verdict de style non.
const CRITERES = {
  A1:  { libelle: "Atteinte à la sécurité publique non caractérisée", gravite: 'bloquant', famille: 'legalite',   fondement: 'CSI R. 236-21' },
  A3:  { libelle: "Motif incohérent avec les faits",                  gravite: 'majeur',   famille: 'legalite',   fondement: 'CSI R. 236-22, 4°' },
  A4:  { libelle: "Personne citée hors des catégories admises",       gravite: 'majeur',   famille: 'legalite',   fondement: 'CSI R. 236-22, II à IV' },
  B5:  { libelle: "Donnée sensible interdite",                        gravite: 'bloquant', famille: 'donnees',    fondement: 'CSI R. 236-23' },
  B6:  { libelle: "Donnée hors nomenclature R. 236-22",               gravite: 'majeur',   famille: 'donnees',    fondement: 'CSI R. 236-22, I' },
  B7:  { libelle: "Données excessives au regard du motif",            gravite: 'mineur',   famille: 'donnees',    fondement: 'CSI R. 236-30' },
  C2:  { libelle: "Motif d'enregistrement non renseigné",             gravite: 'majeur',   famille: 'structurel', fondement: 'CSI R. 236-22, 4°' },
  C8:  { libelle: "Date d'événement absente ou incohérente",          gravite: 'majeur',   famille: 'structurel', fondement: 'CSI R. 236-25' },
  C9:  { libelle: "Minorité non traitée (âge < 13 ans ou non repérable)", gravite: 'bloquant', famille: 'redaction', fondement: 'CSI R. 236-25, al. 2' },
  C10: { libelle: "Fiche au-delà d'un an de conservation",            gravite: 'mineur',   famille: 'structurel', fondement: 'CSI R. 236-24' },
  D11: { libelle: "Origine de l'information non identifiable",        gravite: 'mineur',   famille: 'redaction',  fondement: 'CSI R. 236-30' },
  D12: { libelle: "Défaut de factualité (jugement de valeur)",        gravite: 'mineur',   famille: 'redaction',  fondement: 'CSI R. 236-30' },
};

// Référentiel FERMÉ des motifs d'enregistrement (recommandation du référent national :
// définir pour chacun le seuil d'atteinte justifiant l'inscription).
const MOTIFS = [
  'violences urbaines',
  "violences en marge d'événements sportifs",
  'atteinte aux institutions',
  'radicalisation',
  'mouvance contestataire',
  'atteintes aux biens en série',
  'trafic de stupéfiants',
  "détention d'armes",
  'dangerosité psychiatrique',
  "sûreté de l'État",
];

function estCodeValide(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(CRITERES, code);
}

function graviteDe(code) {
  if (!estCodeValide(code)) throw new Error(`Code de critère inconnu : ${code}`);
  return CRITERES[code].gravite;
}

function fondementDe(code) {
  if (!estCodeValide(code)) throw new Error(`Code de critère inconnu : ${code}`);
  return CRITERES[code].fondement;
}

module.exports = { CRITERES, MOTIFS, estCodeValide, graviteDe, fondementDe };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/rens-api/audit/criteres.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/rens-api/audit/criteres.js server/rens-api/audit/criteres.test.js
git commit -m "feat(audit): référentiel des 12 critères et des motifs d'enregistrement"
```

---

### Task 3: Contrôle structurel SQL (`C2`, `C8`, `C10`)

**Files:**
- Create: `server/rens-api/audit/structurel.js`
- Create: `server/rens-api/audit/structurel.test.js`

**Interfaces:**
- Consumes: `MOTIFS` de `./criteres`.
- Produces: `buildStructurelQuery(jour: string): { text, values }` — renvoie des lignes `{ frs_id: int, critere: string }` pour `C2`, `C8`, `C10` sur les fiches du jour.

- [ ] **Step 1: Write the failing test**

```js
// server/rens-api/audit/structurel.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildStructurelQuery } = require('./structurel');

test('une seule requête couvre les trois critères déterministes', () => {
  const q = buildStructurelQuery('2026-08-04');
  assert.match(q.text, /'C2' AS critere/);
  assert.match(q.text, /'C8' AS critere/);
  assert.match(q.text, /'C10' AS critere/);
  assert.strictEqual((q.text.match(/UNION ALL/g) || []).length, 2);
});

test('C2 : motif absent OU hors référentiel fermé', () => {
  const q = buildStructurelQuery('2026-08-04');
  assert.match(q.text, /motif IS NULL OR motif <> ALL\(\$2::text\[\]\)/);
  assert.ok(Array.isArray(q.values[1]));
  assert.ok(q.values[1].includes('radicalisation'));
});

test("C8 : date d'événement absente ou postérieure à la rédaction", () => {
  const q = buildStructurelQuery('2026-08-04');
  assert.match(q.text, /date_evenement IS NULL OR date_evenement > date_redaction/);
});

test('C10 : au-delà d\'un an de conservation', () => {
  const q = buildStructurelQuery('2026-08-04');
  assert.match(q.text, /date_redaction < \$1::date - INTERVAL '1 year'/);
});

test('le jour est paramétré, jamais interpolé', () => {
  const q = buildStructurelQuery("2026-08-04'; DROP TABLE frs; --");
  assert.doesNotMatch(q.text, /DROP TABLE/);
  assert.strictEqual(q.values[0], "2026-08-04'; DROP TABLE frs; --");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rens-api/audit/structurel.test.js`
Expected: FAIL — `Cannot find module './structurel'`

- [ ] **Step 3: Write the implementation**

```js
// server/rens-api/audit/structurel.js
// Critères déterministes de la grille GIPASP. Ce qui s'écrit en WHERE ne se paie pas
// en tokens et ne se joue pas aux dés : C2, C8 et C10 sont évalués ici, sur 100 % du
// flux, jamais par un modèle. Fonction PURE (testable sans base).

const { MOTIFS } = require('./criteres');

function buildStructurelQuery(jour) {
  const text = `
    SELECT id AS frs_id, 'C2' AS critere FROM frs
     WHERE date_redaction = $1::date AND (motif IS NULL OR motif <> ALL($2::text[]))
    UNION ALL
    SELECT id AS frs_id, 'C8' AS critere FROM frs
     WHERE date_redaction = $1::date AND (date_evenement IS NULL OR date_evenement > date_redaction)
    UNION ALL
    SELECT id AS frs_id, 'C10' AS critere FROM frs
     WHERE date_redaction = $1::date AND date_redaction < $1::date - INTERVAL '1 year'
    ORDER BY frs_id, critere`;
  return { text, values: [jour, MOTIFS] };
}

module.exports = { buildStructurelQuery };
```

> `C10` ne remontera jamais rien tant que la purge glissante de `seed/nightly.mjs` est à 90 jours. Le critère est conservé parce qu'il est juste et gratuit ; le front l'annonce explicitement (Task 11).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/rens-api/audit/structurel.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/rens-api/audit/structurel.js server/rens-api/audit/structurel.test.js
git commit -m "feat(audit): contrôle structurel SQL des critères C2, C8, C10"
```

---

### Task 4: Composition des fragments et filtrage de la vérité terrain

**Files:**
- Create: `server/rens-api/audit/fragments.mjs`
- Create: `server/rens-api/audit/fragments.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `decouper(fiches: object[], taille: number): object[][]`
  - `composerFragment(rang: number, fiches: object[]): { fragment: number, fiches: object[] }` — liste blanche de champs
  - `CHAMPS_FRAGMENT: string[]` — les champs transmis au workflow

- [ ] **Step 1: Write the failing test**

```js
// server/rens-api/audit/fragments.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { decouper, composerFragment, CHAMPS_FRAGMENT } from './fragments.mjs';

const fiche = (id, extra = {}) => ({
  id, date_redaction: '2026-08-04', date_evenement: null, titre: 'T' + id,
  motif: null, origine_info: 'tiers', unite: 'COB X', code_ggd: 'GGD 49',
  commune: 'Segré', texte: 'texte ' + id, porte_pii: true, ...extra,
});

test('decouper : découpe en paquets de la taille demandée, reste inclus', () => {
  const f = Array.from({ length: 95 }, (_, i) => fiche(i + 1));
  const frags = decouper(f, 40);
  assert.strictEqual(frags.length, 3);
  assert.deepStrictEqual(frags.map((x) => x.length), [40, 40, 15]);
  assert.strictEqual(frags[2][14].id, 95);
});

test('decouper : liste vide → aucun fragment', () => {
  assert.deepStrictEqual(decouper([], 40), []);
});

test('decouper : taille invalide → repli sur 40 plutôt que boucle infinie', () => {
  const f = Array.from({ length: 41 }, (_, i) => fiche(i + 1));
  assert.strictEqual(decouper(f, 0).length, 2);
  assert.strictEqual(decouper(f, -3).length, 2);
});

test('composerFragment : liste blanche — un champ inconnu ne passe pas', () => {
  const { fiches } = composerFragment(1, [fiche(7, { secret: 'x', mots_cles: ['a'] })]);
  assert.deepStrictEqual(Object.keys(fiches[0]).sort(), [...CHAMPS_FRAGMENT].sort());
  assert.strictEqual(fiches[0].secret, undefined);
  assert.strictEqual(fiches[0].mots_cles, undefined);
});

test("composerFragment : le marqueur de vérité terrain ne fuit JAMAIS dans le prompt", () => {
  const piegee = fiche(9, { mots_cles: ['stupéfiants', 'defaut:A3'], defaut: 'A3' });
  const payload = JSON.stringify(composerFragment(2, [piegee]));
  assert.ok(!payload.includes('defaut:'), 'le mot-clé defaut: est présent dans le fragment');
  assert.ok(!payload.includes('"defaut"'), 'le champ defaut est présent dans le fragment');
});

test('composerFragment : porte le rang du fragment', () => {
  assert.strictEqual(composerFragment(5, [fiche(1)]).fragment, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rens-api/audit/fragments.test.mjs`
Expected: FAIL — `Cannot find module ... fragments.mjs`

- [ ] **Step 3: Write the implementation**

```js
// server/rens-api/audit/fragments.mjs
// Découpage du lot et composition du payload transmis au workflow.
//
// LISTE BLANCHE, pas liste noire : on énumère les champs autorisés au lieu d'essayer
// de retirer les indésirables. C'est ce qui garantit que le marqueur de vérité terrain
// `defaut:<code>` — et tout champ ajouté plus tard — ne peut pas fuiter dans le prompt.
// Un agent qui lit la réponse ne mesure plus rien.

export const CHAMPS_FRAGMENT = [
  'id', 'date_redaction', 'date_evenement', 'titre', 'motif', 'origine_info',
  'unite', 'code_ggd', 'commune', 'texte', 'porte_pii',
];

export const TAILLE_DEFAUT = 40;

export function decouper(fiches, taille) {
  const t = Number.isInteger(taille) && taille > 0 ? taille : TAILLE_DEFAUT;
  const out = [];
  for (let i = 0; i < fiches.length; i += t) out.push(fiches.slice(i, i + t));
  return out;
}

export function composerFragment(rang, fiches) {
  return {
    fragment: rang,
    fiches: fiches.map((f) => {
      const o = {};
      for (const c of CHAMPS_FRAGMENT) o[c] = f[c] ?? null;
      return o;
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/rens-api/audit/fragments.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/rens-api/audit/fragments.mjs server/rens-api/audit/fragments.test.mjs
git commit -m "feat(audit): découpage en fragments et liste blanche des champs transmis"
```

---

### Task 5: Parsing de la sortie des agents (frontière de confiance)

**Files:**
- Create: `server/rens-api/audit/parse.mjs`
- Create: `server/rens-api/audit/parse.test.mjs`

**Interfaces:**
- Consumes: `estCodeValide`, `graviteDe` de `./criteres.js`.
- Produces: `parseSortieAgents(brut: unknown, idsAutorises: number[]): { ecarts: Ecart[], rejets: {raison: string, entree: unknown}[] }`
  où `Ecart = { frs_id: number, critere: string, gravite: string, fondement: string, extrait: string|null, explication: string|null, confiance: 'haute'|'moyenne' }`

- [ ] **Step 1: Write the failing test**

```js
// server/rens-api/audit/parse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { parseSortieAgents } from './parse.mjs';

const IDS = [10, 11, 12];
const ok = { frs_id: 10, critere: 'A3', fondement: 'CSI R. 236-22, 4°', extrait: 'e', explication: 'x', confiance: 'haute' };

test('accepte un tableau JSON nu', () => {
  const r = parseSortieAgents(JSON.stringify([ok]), IDS);
  assert.strictEqual(r.ecarts.length, 1);
  assert.strictEqual(r.ecarts[0].frs_id, 10);
});

test('accepte un objet déjà désérialisé', () => {
  assert.strictEqual(parseSortieAgents([ok], IDS).ecarts.length, 1);
});

test('tolère les clôtures markdown que les modèles ajoutent', () => {
  const r = parseSortieAgents('```json\n' + JSON.stringify([ok]) + '\n```', IDS);
  assert.strictEqual(r.ecarts.length, 1);
});

test('un fragment sain rend un tableau vide, et c\'est un résultat', () => {
  const r = parseSortieAgents('[]', IDS);
  assert.deepStrictEqual(r.ecarts, []);
  assert.deepStrictEqual(r.rejets, []);
});

test('la gravité vient du code, jamais du modèle', () => {
  const r = parseSortieAgents([{ ...ok, critere: 'D12', gravite: 'bloquant' }], IDS);
  assert.strictEqual(r.ecarts[0].gravite, 'mineur');
});

test('rejette un code de critère inventé', () => {
  const r = parseSortieAgents([{ ...ok, critere: 'X9' }], IDS);
  assert.strictEqual(r.ecarts.length, 0);
  assert.match(r.rejets[0].raison, /critere/);
});

test('rejette un frs_id hors du fragment (hallucination d\'identifiant)', () => {
  const r = parseSortieAgents([{ ...ok, frs_id: 999 }], IDS);
  assert.strictEqual(r.ecarts.length, 0);
  assert.match(r.rejets[0].raison, /frs_id/);
});

test('rejette un signalement sans fondement : pas d\'article, pas d\'écart', () => {
  const r = parseSortieAgents([{ ...ok, fondement: '  ' }], IDS);
  assert.strictEqual(r.ecarts.length, 0);
  assert.match(r.rejets[0].raison, /fondement/);
});

test('une confiance inconnue est ramenée à moyenne, pas rejetée', () => {
  const r = parseSortieAgents([{ ...ok, confiance: 'certaine' }], IDS);
  assert.strictEqual(r.ecarts[0].confiance, 'moyenne');
});

test('du texte non JSON lève, pour que le fragment soit marqué en échec', () => {
  assert.throws(() => parseSortieAgents("Je n'ai pas pu analyser ces fiches.", IDS), /SORTIE_ILLISIBLE/);
});

test('trie les rejets sans perdre les écarts valides du même lot', () => {
  const r = parseSortieAgents([ok, { ...ok, critere: 'ZZ' }, { ...ok, frs_id: 11, critere: 'B5' }], IDS);
  assert.strictEqual(r.ecarts.length, 2);
  assert.strictEqual(r.rejets.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rens-api/audit/parse.test.mjs`
Expected: FAIL — `Cannot find module ... parse.mjs`

- [ ] **Step 3: Write the implementation**

```js
// server/rens-api/audit/parse.mjs
// FRONTIÈRE DE CONFIANCE. Tout ce qui sort d'un agent est une entrée non fiable :
// codes inventés, identifiants hallucinés, gravité inflatée, JSON entouré de prose.
// Rien n'est persisté sans avoir été validé ici.

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { estCodeValide, graviteDe } = require_('./criteres.js');

const CONFIANCES = ['haute', 'moyenne'];

// Les modèles encadrent volontiers leur JSON de ``` ou d'une phrase. On récupère le
// premier tableau JSON équilibré plutôt que d'exiger une sortie parfaite.
function extraireJSON(brut) {
  if (typeof brut !== 'string') return brut;
  const sansFences = brut.replace(/```(?:json)?/gi, '').trim();
  const debut = sansFences.indexOf('[');
  const fin = sansFences.lastIndexOf(']');
  if (debut === -1 || fin <= debut) throw new Error('SORTIE_ILLISIBLE');
  try {
    return JSON.parse(sansFences.slice(debut, fin + 1));
  } catch {
    throw new Error('SORTIE_ILLISIBLE');
  }
}

export function parseSortieAgents(brut, idsAutorises) {
  const donnees = extraireJSON(brut);
  const liste = Array.isArray(donnees) ? donnees : donnees && Array.isArray(donnees.ecarts) ? donnees.ecarts : null;
  if (!liste) throw new Error('SORTIE_ILLISIBLE');

  const autorises = new Set(idsAutorises);
  const ecarts = [], rejets = [];

  for (const e of liste) {
    if (!e || typeof e !== 'object') { rejets.push({ raison: 'entree_non_objet', entree: e }); continue; }
    const frsId = Number(e.frs_id);
    if (!Number.isInteger(frsId) || !autorises.has(frsId)) {
      rejets.push({ raison: 'frs_id hors du fragment', entree: e }); continue;
    }
    if (!estCodeValide(e.critere)) {
      rejets.push({ raison: 'critere inconnu', entree: e }); continue;
    }
    const fondement = typeof e.fondement === 'string' ? e.fondement.trim() : '';
    if (!fondement) {
      // Règle de fond : sans article citable, le signalement n'est pas opposable.
      rejets.push({ raison: 'fondement manquant', entree: e }); continue;
    }
    ecarts.push({
      frs_id: frsId,
      critere: e.critere,
      gravite: graviteDe(e.critere), // jamais e.gravite
      fondement,
      extrait: typeof e.extrait === 'string' && e.extrait.trim() ? e.extrait.trim() : null,
      explication: typeof e.explication === 'string' && e.explication.trim() ? e.explication.trim() : null,
      confiance: CONFIANCES.includes(e.confiance) ? e.confiance : 'moyenne',
    });
  }
  return { ecarts, rejets };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/rens-api/audit/parse.test.mjs`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add server/rens-api/audit/parse.mjs server/rens-api/audit/parse.test.mjs
git commit -m "feat(audit): validation de la sortie des agents en frontière de confiance"
```

---

### Task 6: Client IAka minimal et concurrence bornée

**Files:**
- Create: `server/rens-api/audit/iaka.mjs`
- Create: `server/rens-api/audit/iaka.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `execWorkflow({ prompt, appId, cfg, fetchImpl, sleep }): Promise<unknown>` — `cfg = { baseUrl, jwt, tenantId, pollIntervalMs, pollTimeoutMs }`
  - `mapConcurrent(items: T[], limite: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>`

> `server/iaka.mjs` (BFF) n'est pas réutilisable ici : `rens-api` est une image Docker séparée, avec son propre `package.json` et son propre contexte de build. On réécrit 40 lignes plutôt que de partager un module à travers deux images.

- [ ] **Step 1: Write the failing test**

```js
// server/rens-api/audit/iaka.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execWorkflow, mapConcurrent } from './iaka.mjs';

const cfg = { baseUrl: 'https://iaka.test', jwt: 'J', tenantId: 'T', pollIntervalMs: 1, pollTimeoutMs: 50 };
const rep = (obj, ok = true, status = 200) => ({ ok, status, json: async () => obj, text: async () => JSON.stringify(obj) });

test('poste app_id + prompt puis poll jusqu\'à SUCCESS', async () => {
  const appels = [];
  const fetchImpl = async (url, opt) => {
    appels.push(url);
    if (opt?.method === 'POST') return rep({ execution_id: 'X1' });
    return appels.length < 4 ? rep({ status: 'RUNNING' }) : rep({ status: 'SUCCESS', result: '[]' });
  };
  const r = await execWorkflow({ prompt: '{"fragment":1}', appId: 'A', cfg, fetchImpl, sleep: async () => {} });
  assert.strictEqual(r, '[]');
  assert.match(appels[0], /\/workflows\/execute$/);
  assert.match(appels[1], /\/workflows\/executions\/X1\?tenant_id=T$/);
});

test('statut ERROR → IAKA_UPSTREAM', async () => {
  const fetchImpl = async (u, o) => (o?.method === 'POST' ? rep({ execution_id: 'X' }) : rep({ status: 'ERROR' }));
  await assert.rejects(() => execWorkflow({ prompt: 'p', appId: 'A', cfg, fetchImpl, sleep: async () => {} }), /IAKA_UPSTREAM/);
});

test('exécution jamais terminée → IAKA_TIMEOUT', async () => {
  const fetchImpl = async (u, o) => (o?.method === 'POST' ? rep({ execution_id: 'X' }) : rep({ status: 'RUNNING' }));
  await assert.rejects(() => execWorkflow({ prompt: 'p', appId: 'A', cfg, fetchImpl, sleep: async () => {} }), /IAKA_TIMEOUT/);
});

test('HTTP non ok au déclenchement → IAKA_UPSTREAM', async () => {
  const fetchImpl = async () => rep({}, false, 500);
  await assert.rejects(() => execWorkflow({ prompt: 'p', appId: 'A', cfg, fetchImpl, sleep: async () => {} }), /IAKA_UPSTREAM/);
});

test('mapConcurrent : respecte la limite et conserve l\'ordre des résultats', async () => {
  let enCours = 0, max = 0;
  const fn = async (n) => {
    enCours++; max = Math.max(max, enCours);
    await new Promise((r) => setTimeout(r, 5));
    enCours--; return n * 2;
  };
  const r = await mapConcurrent([1, 2, 3, 4, 5, 6, 7], 3, fn);
  assert.deepStrictEqual(r, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(max <= 3, `concurrence observée ${max} > 3`);
});

test('mapConcurrent : un rejet n\'interrompt pas les autres (les échecs sont gérés par l\'appelant)', async () => {
  const fn = async (n) => { if (n === 2) throw new Error('boom'); return n; };
  const r = await mapConcurrent([1, 2, 3], 2, async (n) => fn(n).catch((e) => ({ erreur: e.message })));
  assert.deepStrictEqual(r, [1, { erreur: 'boom' }, 3]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rens-api/audit/iaka.test.mjs`
Expected: FAIL — `Cannot find module ... iaka.mjs`

- [ ] **Step 3: Write the implementation**

```js
// server/rens-api/audit/iaka.mjs
// Client IAka minimal pour le job d'audit : POST /workflows/execute puis poll de
// /workflows/executions/{id} jusqu'à SUCCESS. Volontairement dupliqué depuis le BFF
// (server/iaka.mjs) : rens-api est une image Docker distincte, partager un module
// entre deux contextes de build coûterait plus que ces 40 lignes.

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function execWorkflow({ prompt, appId, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const headers = { Authorization: `Bearer ${cfg.jwt}`, 'Content-Type': 'application/json' };

  const execRes = await fetchImpl(`${cfg.baseUrl}/workflows/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ app_id: appId, tenant_id: cfg.tenantId, prompt, langue: 'fr', include_traitement: false }),
  });
  if (!execRes.ok) throw new Error('IAKA_UPSTREAM');
  const { execution_id: id } = await execRes.json();
  if (!id) throw new Error('IAKA_UPSTREAM');

  const statusUrl = `${cfg.baseUrl}/workflows/executions/${id}?tenant_id=${cfg.tenantId}`;
  const debut = Date.now();
  while (Date.now() - debut <= cfg.pollTimeoutMs) {
    const res = await fetchImpl(statusUrl, { method: 'GET', headers });
    if (!res.ok) throw new Error('IAKA_UPSTREAM');
    const body = await res.json();
    if (body.status === 'SUCCESS') return body.result;
    if (body.status === 'ERROR') throw new Error('IAKA_UPSTREAM');
    await sleep(cfg.pollIntervalMs);
  }
  throw new Error('IAKA_TIMEOUT');
}

// Exécute fn sur items avec au plus `limite` promesses en vol. Les résultats gardent
// l'ordre des items. IAka n'itère pas ; c'est ici que vit la boucle.
export async function mapConcurrent(items, limite, fn) {
  const n = Number.isInteger(limite) && limite > 0 ? limite : 1;
  const out = new Array(items.length);
  let curseur = 0;
  const ouvrier = async () => {
    while (curseur < items.length) {
      const i = curseur++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, ouvrier));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/rens-api/audit/iaka.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/rens-api/audit/iaka.mjs server/rens-api/audit/iaka.test.mjs
git commit -m "feat(audit): client IAka du job et exécution à concurrence bornée"
```

---

### Task 7: Persistance du run, des fragments et des écarts

**Files:**
- Create: `server/rens-api/audit/store.mjs`
- Create: `server/rens-api/audit/store.test.mjs`

**Interfaces:**
- Consumes: rien (reçoit un `client` façon `pg`, injecté).
- Produces (toutes prennent `client` en premier argument) :
  - `creerRun(client, { jour, tailleFragment }): Promise<number>` — supprime le run existant du jour puis le recrée ; renvoie `run_id`
  - `creerFragments(client, runId, fragments: object[][]): Promise<void>`
  - `enregistrerStructurels(client, runId, lignes: {frs_id, critere}[]): Promise<number>`
  - `enregistrerEcarts(client, runId, ecarts): Promise<number>`
  - `marquerFragment(client, runId, rang, statut, erreur?): Promise<void>`
  - `cloreRun(client, runId, totalFiches): Promise<'complet'|'partiel'>`

- [ ] **Step 1: Write the failing test**

Un faux `client` enregistre les requêtes — pas de base nécessaire.

```js
// server/rens-api/audit/store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { creerRun, creerFragments, enregistrerStructurels, enregistrerEcarts, marquerFragment, cloreRun } from './store.mjs';

function faux(reponses = {}) {
  const appels = [];
  return {
    appels,
    query: async (text, values) => {
      appels.push({ text, values });
      for (const [motif, rep] of Object.entries(reponses)) if (text.includes(motif)) return rep;
      return { rows: [], rowCount: 0 };
    },
  };
}

test('creerRun : supprime le run du jour avant de le recréer (idempotence)', async () => {
  const c = faux({ 'INSERT INTO frs_audit_run': { rows: [{ id: 7 }] } });
  const id = await creerRun(c, { jour: '2026-08-04', tailleFragment: 40 });
  assert.strictEqual(id, 7);
  assert.match(c.appels[0].text, /DELETE FROM frs_audit_run WHERE jour = \$1/);
  assert.deepStrictEqual(c.appels[0].values, ['2026-08-04']);
});

test('enregistrerStructurels : gravité dérivée du code, source = sql', async () => {
  const c = faux();
  const n = await enregistrerStructurels(c, 7, [{ frs_id: 1, critere: 'C2' }, { frs_id: 2, critere: 'C8' }]);
  assert.strictEqual(n, 2);
  assert.match(c.appels[0].text, /INSERT INTO frs_audit/);
  assert.deepStrictEqual(c.appels[0].values.slice(0, 6), [7, 1, 'C2', 'majeur', 'sql', 'CSI R. 236-22, 4°']);
  assert.strictEqual(c.appels[1].values[5], 'CSI R. 236-25');
});

test('enregistrerEcarts : upsert conservant la confiance la plus haute', async () => {
  const c = faux();
  await enregistrerEcarts(c, 7, [{ frs_id: 3, critere: 'A3', gravite: 'majeur', fondement: 'R.236-22', extrait: 'e', explication: 'x', confiance: 'haute' }]);
  assert.match(c.appels[0].text, /ON CONFLICT \(run_id, frs_id, critere\) DO UPDATE/);
  assert.match(c.appels[0].text, /frs_audit\.confiance = 'moyenne'/);
  assert.deepStrictEqual(c.appels[0].values.slice(0, 5), [7, 3, 'A3', 'majeur', 'llm']);
});

test('enregistrerEcarts : liste vide → aucune requête', async () => {
  const c = faux();
  assert.strictEqual(await enregistrerEcarts(c, 7, []), 0);
  assert.strictEqual(c.appels.length, 0);
});

test('marquerFragment : porte le message d\'erreur, tronqué', async () => {
  const c = faux();
  await marquerFragment(c, 7, 3, 'echec', 'x'.repeat(600));
  assert.match(c.appels[0].text, /UPDATE frs_audit_fragment SET statut/);
  assert.strictEqual(c.appels[0].values[1].length, 500);
});

test('cloreRun : complet si tous les fragments sont ok', async () => {
  const c = faux({ 'FROM frs_audit_fragment': { rows: [{ total: 3, ok: 3 }] } });
  assert.strictEqual(await cloreRun(c, 7, 120), 'complet');
});

test('cloreRun : un jour sans production est COMPLET, pas partiel', async () => {
  const c = faux({ 'FROM frs_audit_fragment': { rows: [{ total: 0, ok: 0 }] } });
  assert.strictEqual(await cloreRun(c, 7, 0), 'complet');
});

test('cloreRun : partiel dès qu\'un fragment manque — jamais silencieux', async () => {
  const c = faux({ 'FROM frs_audit_fragment': { rows: [{ total: 3, ok: 2 }] } });
  assert.strictEqual(await cloreRun(c, 7, 120), 'partiel');
  const maj = c.appels.find((a) => a.text.includes('UPDATE frs_audit_run'));
  assert.ok(maj.values.includes('partiel'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rens-api/audit/store.test.mjs`
Expected: FAIL — `Cannot find module ... store.mjs`

- [ ] **Step 3: Write the implementation**

```js
// server/rens-api/audit/store.mjs
// Persistance de l'audit. Le dédoublonnage n'est pas écrit ici : il est porté par la
// contrainte UNIQUE (run_id, frs_id, critere) et un ON CONFLICT — une règle en base
// vaut mieux qu'une règle en code, elle ne peut pas être contournée.

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { graviteDe, fondementDe } = require_('./criteres.js');

export async function creerRun(client, { jour, tailleFragment }) {
  await client.query('DELETE FROM frs_audit_run WHERE jour = $1', [jour]);
  const { rows } = await client.query(
    `INSERT INTO frs_audit_run (jour, taille_fragment) VALUES ($1, $2) RETURNING id`,
    [jour, tailleFragment]
  );
  return rows[0].id;
}

export async function creerFragments(client, runId, fragments) {
  for (let i = 0; i < fragments.length; i++) {
    await client.query(
      `INSERT INTO frs_audit_fragment (run_id, rang, frs_ids) VALUES ($1, $2, $3)`,
      [runId, i, fragments[i].map((f) => f.id)]
    );
  }
  await client.query('UPDATE frs_audit_run SET fragments_total = $2 WHERE id = $1', [runId, fragments.length]);
}

const INSERT_ECART = `
  INSERT INTO frs_audit (run_id, frs_id, critere, gravite, source, fondement, extrait, explication, confiance)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (run_id, frs_id, critere) DO UPDATE SET
    fondement   = EXCLUDED.fondement,
    extrait     = EXCLUDED.extrait,
    explication = EXCLUDED.explication,
    confiance   = CASE WHEN frs_audit.confiance = 'moyenne' THEN EXCLUDED.confiance ELSE frs_audit.confiance END`;

export async function enregistrerStructurels(client, runId, lignes) {
  for (const l of lignes) {
    await client.query(INSERT_ECART, [runId, l.frs_id, l.critere, graviteDe(l.critere), 'sql', fondementDe(l.critere), null, null, null]);
  }
  return lignes.length;
}

export async function enregistrerEcarts(client, runId, ecarts) {
  for (const e of ecarts) {
    await client.query(INSERT_ECART, [runId, e.frs_id, e.critere, e.gravite, 'llm', e.fondement, e.extrait, e.explication, e.confiance]);
  }
  return ecarts.length;
}

export async function marquerFragment(client, runId, rang, statut, erreur = null) {
  await client.query(
    'UPDATE frs_audit_fragment SET statut = $3, erreur = $4 WHERE run_id = $1 AND rang = $2',
    [runId, rang, statut, erreur ? String(erreur).slice(0, 500) : null]
  );
}

export async function cloreRun(client, runId, totalFiches) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE statut = 'ok')::int AS ok
       FROM frs_audit_fragment WHERE run_id = $1`,
    [runId]
  );
  const { total, ok } = rows[0];
  // total === 0 → journée sans production : c'est un audit COMPLET, pas partiel.
  const statut = ok === total ? 'complet' : 'partiel';
  await client.query(
    // COALESCE : en reprise on ne recompte pas le lot, on garde le total du run initial.
    `UPDATE frs_audit_run SET statut = $2, fragments_ok = $3, total_fiches = COALESCE($4, total_fiches), termine_a = now() WHERE id = $1`,
    [runId, statut, ok, totalFiches]
  );
  return statut;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/rens-api/audit/store.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/rens-api/audit/store.mjs server/rens-api/audit/store.test.mjs
git commit -m "feat(audit): persistance des runs, fragments et écarts"
```

---

### Task 8: Orchestrateur `audit/nightly.mjs`

**Files:**
- Create: `server/rens-api/audit/nightly.mjs`
- Create: `server/rens-api/audit/nightly.test.mjs`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `auditerJour({ client, jour, cfg, deps }): Promise<{ statut, totalFiches, fragments, ecarts, rejets }>`
  où `deps = { execWorkflow, structurelQuery }` (injectables pour le test) et `cfg = { appId, tailleFragment, concurrence, baseUrl, jwt, tenantId, pollIntervalMs, pollTimeoutMs }`.
  `main()` lit l'environnement et appelle `auditerJour`.

- [ ] **Step 1: Write the failing test**

```js
// server/rens-api/audit/nightly.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { auditerJour } from './nightly.mjs';

const fiches = (n) => Array.from({ length: n }, (_, i) => ({
  id: i + 1, date_redaction: '2026-08-04', date_evenement: null, titre: 'T', motif: null,
  origine_info: 'tiers', unite: 'COB X', code_ggd: 'GGD 49', commune: 'C', texte: 'texte', porte_pii: true,
}));

function client(fichesDuJour, structurels = []) {
  const appels = [];
  return {
    appels,
    query: async (text, values) => {
      appels.push({ text, values });
      if (text.includes('INSERT INTO frs_audit_run')) return { rows: [{ id: 1 }] };
      if (text.includes("'C2' AS critere")) return { rows: structurels };
      if (text.includes('FROM frs f') || text.includes('FROM frs\n')) return { rows: fichesDuJour };
      if (text.includes('FROM frs_audit_fragment')) {
        const ko = appels.filter((a) => a.text.includes('SET statut') && a.values[2] === 'echec').length;
        const tot = appels.filter((a) => a.text.includes('INSERT INTO frs_audit_fragment')).length;
        return { rows: [{ total: tot, ok: tot - ko }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const cfg = { appId: 'A', tailleFragment: 40, concurrence: 2, baseUrl: 'x', jwt: 'j', tenantId: 't', pollIntervalMs: 1, pollTimeoutMs: 10 };

test('découpe 95 fiches en 3 fragments et appelle le workflow 3 fois', async () => {
  let n = 0;
  const c = client(fiches(95));
  const r = await auditerJour({ client: c, jour: '2026-08-04', cfg, deps: { execWorkflow: async () => { n++; return '[]'; } } });
  assert.strictEqual(n, 3);
  assert.strictEqual(r.fragments, 3);
  assert.strictEqual(r.totalFiches, 95);
  assert.strictEqual(r.statut, 'complet');
});

test('un fragment en échec n\'interrompt pas le run, qui finit partiel', async () => {
  let n = 0;
  const c = client(fiches(80));
  const r = await auditerJour({
    client: c, jour: '2026-08-04', cfg,
    deps: { execWorkflow: async () => { n++; if (n === 1) throw new Error('IAKA_TIMEOUT'); return '[]'; } },
  });
  assert.strictEqual(r.statut, 'partiel');
  const echec = c.appels.find((a) => a.text.includes('SET statut') && a.values[2] === 'echec');
  assert.match(echec.values[3], /IAKA_TIMEOUT/);
});

test('une sortie illisible marque le fragment en échec, sans faire tomber le run', async () => {
  const c = client(fiches(40));
  const r = await auditerJour({ client: c, jour: '2026-08-04', cfg, deps: { execWorkflow: async () => 'désolé, je ne peux pas' } });
  assert.strictEqual(r.statut, 'partiel');
  const echec = c.appels.find((a) => a.text.includes('SET statut') && a.values[2] === 'echec');
  assert.match(echec.values[3], /SORTIE_ILLISIBLE/);
});

test('les écarts structurels sont enregistrés même si aucun fragment LLM ne réussit', async () => {
  const c = client(fiches(40), [{ frs_id: 1, critere: 'C2' }, { frs_id: 2, critere: 'C8' }]);
  await auditerJour({ client: c, jour: '2026-08-04', cfg, deps: { execWorkflow: async () => { throw new Error('IAKA_UPSTREAM'); } } });
  const sql = c.appels.filter((a) => a.text.includes('INSERT INTO frs_audit') && a.values[4] === 'sql');
  assert.strictEqual(sql.length, 2);
});

test('jour sans aucune fiche : run complet, zéro fragment, pas d\'appel workflow', async () => {
  let n = 0;
  const c = client([]);
  const r = await auditerJour({ client: c, jour: '2026-08-04', cfg, deps: { execWorkflow: async () => { n++; return '[]'; } } });
  assert.strictEqual(n, 0);
  assert.strictEqual(r.fragments, 0);
  assert.strictEqual(r.statut, 'complet');
});

test('reprise : ne rejoue QUE les fragments en échec, sans recréer le run', async () => {
  const c = client(fiches(0));
  c.query = async (text, values) => {
    c.appels.push({ text, values });
    if (text.includes("g.statut = 'echec'")) return { rows: [{ run_id: 1, rang: 2, frs_ids: [81, 82] }] };
    if (text.includes('f.id = ANY')) return { rows: fiches(2) };
    if (text.includes('FROM frs_audit_fragment')) return { rows: [{ total: 3, ok: 3 }] };
    return { rows: [], rowCount: 0 };
  };
  let n = 0;
  const r = await auditerJour({
    client: c, jour: '2026-08-04', cfg: { ...cfg, reprise: true },
    deps: { execWorkflow: async () => { n++; return '[]'; } },
  });
  assert.strictEqual(n, 1, 'un seul fragment rejoué');
  assert.strictEqual(r.statut, 'complet');
  assert.ok(!c.appels.some((a) => a.text.includes('DELETE FROM frs_audit_run')), 'le run ne doit pas être recréé');
});

test('reprise : plus aucun fragment en échec → rien à faire', async () => {
  const c = client(fiches(0));
  c.query = async (text) => (text.includes("g.statut = 'echec'") ? { rows: [] } : { rows: [], rowCount: 0 });
  let n = 0;
  const r = await auditerJour({
    client: c, jour: '2026-08-04', cfg: { ...cfg, reprise: true },
    deps: { execWorkflow: async () => { n++; return '[]'; } },
  });
  assert.strictEqual(n, 0);
  assert.strictEqual(r.statut, 'complet');
});

test('chaque fragment est écrit via avecClient, un par un (grain de reprise)', async () => {
  const c = client(fiches(80));
  const transactions = [];
  await auditerJour({
    client: c, jour: '2026-08-04', cfg,
    deps: {
      execWorkflow: async () => '[]',
      avecClient: async (fn) => { transactions.push(1); return fn(c); },
    },
  });
  assert.strictEqual(transactions.length, 2, 'une transaction par fragment');
});

test('le prompt envoyé au workflow ne contient jamais le marqueur defaut:', async () => {
  const avecPiege = fiches(3).map((f) => ({ ...f, mots_cles: ['defaut:A3'] }));
  let vu = '';
  const c = client(avecPiege);
  await auditerJour({ client: c, jour: '2026-08-04', cfg, deps: { execWorkflow: async ({ prompt }) => { vu = prompt; return '[]'; } } });
  assert.ok(!vu.includes('defaut:'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rens-api/audit/nightly.test.mjs`
Expected: FAIL — `Cannot find module ... nightly.mjs`

- [ ] **Step 3: Write the implementation**

```js
// server/rens-api/audit/nightly.mjs
// Orchestrateur du contrôle qualité nocturne.
//
// IAka ne sait pas boucler mais parallélise depuis une entrée : le workflow reste fixe
// (un fragment, trois agents, une jointure) et la boucle vit ICI, où elle se teste.
//
// Un fragment en échec n'interrompt jamais le run : il est marqué, le run finit
// « partiel », et le front l'affiche. Un audit incomplet qui se tairait ressemblerait
// à un audit vierge — c'est la pire défaillance possible pour un outil de conformité.

import { Pool } from 'pg';
import { createRequire } from 'node:module';
import { decouper, composerFragment, TAILLE_DEFAUT } from './fragments.mjs';
import { parseSortieAgents } from './parse.mjs';
import { execWorkflow as execWorkflowReel, mapConcurrent } from './iaka.mjs';
import { creerRun, creerFragments, enregistrerStructurels, enregistrerEcarts, marquerFragment, cloreRun } from './store.mjs';

const require_ = createRequire(import.meta.url);
const { buildStructurelQuery } = require_('./structurel.js');

const SELECT_JOUR = `
  SELECT f.id, to_char(f.date_redaction, 'YYYY-MM-DD') AS date_redaction,
         to_char(f.date_evenement, 'YYYY-MM-DD') AS date_evenement,
         f.titre, f.motif, f.origine_info, f.unite, f.code_ggd, f.commune, f.texte,
         (f.texte ~ '[A-ZÉÈÀÇ]{3,}[[:space:]]' OR f.texte ~ '[A-Z]{2}-[0-9]{3}-[A-Z]{2}'
          OR f.texte ~* '(t\\.me/|x\\.com/|facebook|instagram|tiktok|discord)'
          OR f.texte ~ 'né\\(e\\) le') AS porte_pii
    FROM frs f
   WHERE f.date_redaction = $1::date
   ORDER BY f.id`;

const SELECT_JOUR_IDS = SELECT_JOUR.replace('f.date_redaction = $1::date', 'f.id = ANY($1::int[])');

// Un fragment = UNE transaction, sur SA PROPRE connexion.
//
// Deux raisons, toutes deux nécessaires. (1) Le batch dure ~4 min : si tout tenait dans
// une transaction unique, un redémarrage de conteneur annulerait les 24 fragments déjà
// traités ET les statuts qui permettent la reprise — la reprise par fragment ne serait
// qu'une promesse. (2) Un client `pg` ne porte QU'UNE transaction : avec une concurrence
// de 6 sur un client partagé, les BEGIN/COMMIT s'entrelaceraient silencieusement.
// D'où `avecClient`, qui prête une connexion dédiée le temps de l'écriture.
async function traiterFragment({ avecClient, runId, rang, lot, cfg, execWorkflow }) {
  const ids = lot.map((f) => f.id);
  // L'appel au workflow (le temps long) se fait HORS connexion : on ne monopolise pas
  // une connexion du pool pendant 45 s d'attente réseau.
  let ecarts, rejets;
  try {
    const brut = await execWorkflow({
      prompt: JSON.stringify(composerFragment(rang, lot)),
      appId: cfg.appId, cfg,
    });
    ({ ecarts, rejets } = parseSortieAgents(brut, ids));
  } catch (e) {
    await avecClient(async (c) => marquerFragment(c, runId, rang, 'echec', e.message));
    console.error(`[audit] fragment ${rang} en échec : ${e.message}`);
    return { ecarts: 0, rejets: 0 };
  }

  await avecClient(async (c) => {
    await enregistrerEcarts(c, runId, ecarts);
    await marquerFragment(c, runId, rang, 'ok');
  });
  if (rejets.length) console.warn(`[audit] fragment ${rang} : ${rejets.length} entrée(s) rejetée(s)`, rejets.map((r) => r.raison));
  return { ecarts: ecarts.length, rejets: rejets.length };
}

export async function auditerJour({ client, jour, cfg, deps = {} }) {
  const execWorkflow = deps.execWorkflow || execWorkflowReel;
  // Par défaut (tests, dry-run), l'écriture réutilise le client courant : une seule
  // connexion, pas de transaction imbriquée. En production, main() injecte un avecClient
  // qui emprunte une connexion au pool et l'entoure d'un BEGIN/COMMIT.
  const avecClient = deps.avecClient || ((fn) => fn(client));
  const taille = Number.isInteger(cfg.tailleFragment) && cfg.tailleFragment > 0 ? cfg.tailleFragment : TAILLE_DEFAUT;

  // REPRISE : on garde le run et ses fragments, on ne rejoue que ceux en échec.
  // Sans ce mode, « un fragment en échec est rejoué seul » serait une promesse sans code.
  if (cfg.reprise) {
    const { rows } = await client.query(
      `SELECT r.id AS run_id, g.rang, g.frs_ids
         FROM frs_audit_run r JOIN frs_audit_fragment g ON g.run_id = r.id
        WHERE r.jour = $1::date AND g.statut = 'echec' ORDER BY g.rang`, [jour]
    );
    if (!rows.length) return { statut: 'complet', totalFiches: 0, fragments: 0, ecarts: 0, rejets: 0, reprise: true };
    const runId = rows[0].run_id;
    const aRejouer = rows.map((r) => ({ rang: r.rang, ids: r.frs_ids }));
    let ecarts = 0;
    await mapConcurrent(aRejouer, cfg.concurrence, async ({ rang, ids }) => {
      const { rows: lot } = await client.query(SELECT_JOUR_IDS, [ids]);
      const r = await traiterFragment({ avecClient, runId, rang, lot, cfg, execWorkflow });
      ecarts += r.ecarts;
    });
    const statut = await cloreRun(client, runId, null);
    return { statut, totalFiches: 0, fragments: aRejouer.length, ecarts, rejets: 0, reprise: true };
  }

  const runId = await creerRun(client, { jour, tailleFragment: taille });

  // 1. Déterministe d'abord : exhaustif, gratuit, et acquis même si tout le LLM échoue.
  const qs = buildStructurelQuery(jour);
  const { rows: structurels } = await client.query(qs.text, qs.values);
  await enregistrerStructurels(client, runId, structurels);

  // 2. Le lot du jour, puis les fragments.
  const { rows: fiches } = await client.query(SELECT_JOUR, [jour]);
  const fragments = decouper(fiches, taille);
  await creerFragments(client, runId, fragments);

  let totalEcarts = 0, totalRejets = 0;

  await mapConcurrent(fragments, cfg.concurrence, async (lot, rang) => {
    const r = await traiterFragment({ avecClient, runId, rang, lot, cfg, execWorkflow });
    totalEcarts += r.ecarts;
    totalRejets += r.rejets;
  });

  const statut = await cloreRun(client, runId, fiches.length);
  return { statut, totalFiches: fiches.length, fragments: fragments.length, ecarts: totalEcarts, rejets: totalRejets };
}

async function main() {
  const jour = process.env.AUDIT_JOUR || null;
  const dry = process.env.AUDIT_DRY === '1';
  const cfg = {
    appId: process.env.IAKA_QUALITE_APP_ID,
    baseUrl: process.env.IAKA_BASE_URL,
    jwt: process.env.IAKA_JWT,
    tenantId: process.env.IAKA_TENANT_ID,
    tailleFragment: Number(process.env.AUDIT_TAILLE_FRAGMENT ?? TAILLE_DEFAUT),
    concurrence: Number(process.env.AUDIT_CONCURRENCE ?? 6),
    pollIntervalMs: Number(process.env.AUDIT_POLL_MS ?? 2000),
    pollTimeoutMs: Number(process.env.AUDIT_TIMEOUT_MS ?? 300000),
    reprise: process.env.AUDIT_REPRISE === '1',
    dry,
  };
  const stamp = new Date().toISOString();
  const pool = new Pool({ max: Math.max(2, cfg.concurrence + 1) });
  const client = await pool.connect();
  try {
    const { rows: [{ j }] } = await client.query(
      'SELECT to_char(COALESCE($1::date, CURRENT_DATE - 1), \'YYYY-MM-DD\') AS j', [jour]
    );

    // En DRY-RUN : une seule connexion, une seule transaction, ROLLBACK final — rien
    // n'est écrit. Sinon : une connexion et une transaction PAR FRAGMENT, pour que
    // chaque fragment traité soit durable et serve de point de reprise.
    let avecClient;
    if (dry) {
      await client.query('BEGIN');
      avecClient = (fn) => fn(client);
    } else {
      avecClient = async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const out = await fn(c);
          await c.query('COMMIT');
          return out;
        } catch (e) {
          await c.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      };
    }

    const r = await auditerJour({ client, jour: j, cfg, deps: { avecClient } });
    if (dry) await client.query('ROLLBACK');

    console.log(`[audit ${stamp}] ${dry ? 'DRY-RUN ' : ''}${cfg.reprise ? 'REPRISE ' : ''}${j} : ${r.statut}, ${r.totalFiches} fiches, ${r.fragments} fragments, ${r.ecarts} écarts, ${r.rejets} rejets.`);
    if (r.statut !== 'complet') process.exitCode = 1;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[audit ${stamp}] ÉCHEC : ${e.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('nightly.mjs')) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/rens-api/audit/nightly.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add server/rens-api/audit/nightly.mjs server/rens-api/audit/nightly.test.mjs
git commit -m "feat(audit): orchestrateur nocturne, reprise par fragment et statut partiel"
```

---

### Task 9: Requêtes de lecture du rapport et routes rens-api

**Files:**
- Create: `server/rens-api/audit/rapport.js`
- Create: `server/rens-api/audit/rapport.test.js`
- Modify: `server/rens-api/server.js` (ajout de deux routes avant le `404` final)
- Modify: `server/rens-api/openapi.json`

**Interfaces:**
- Consumes: `CRITERES` de `./criteres.js`.
- Produces:
  - `buildRapportQuery(jour: string|null, ggd: string): { text, values }` — un objet JSON `{ run, synthese, fiches }`
  - `buildRapportFicheQuery(jour: string, frsId: number): { text, values }`

- [ ] **Step 1: Write the failing test**

```js
// server/rens-api/audit/rapport.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildRapportQuery, buildRapportFicheQuery } = require('./rapport');

test('rapport : renvoie run, synthese et fiches en un seul objet', () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /'run'/);
  assert.match(q.text, /'synthese'/);
  assert.match(q.text, /'fiches'/);
  assert.deepStrictEqual(q.values, ['2026-08-04']);
});

test('rapport : sans jour → dernier run terminé', () => {
  const q = buildRapportQuery(null, '');
  assert.match(q.text, /ORDER BY jour DESC[\s\S]*LIMIT 1/);
  assert.deepStrictEqual(q.values, []);
});

test('rapport : le filtre GGD est paramétré', () => {
  const q = buildRapportQuery('2026-08-04', 'GGD 49');
  assert.deepStrictEqual(q.values, ['2026-08-04', 'GGD 49']);
  assert.match(q.text, /f\.code_ggd = \$2/);
});

test('rapport : la couverture (fragments) fait partie du run, pas d\'une option', () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /fragments_total/);
  assert.match(q.text, /fragments_ok/);
  assert.match(q.text, /'statut', r\.statut/);
});

test('rapport : gravite_max ordonne bloquant > majeur > mineur', () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /WHEN 'bloquant' THEN 3/);
  assert.match(q.text, /WHEN 'majeur' THEN 2/);
});

test('rapport : agrège par critère et par unité', () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /'par_critere'/);
  assert.match(q.text, /'par_unite'/);
  assert.match(q.text, /'par_gravite'/);
});

test('detail fiche : texte intégral et écarts, paramétrés', () => {
  const q = buildRapportFicheQuery('2026-08-04', 1204);
  assert.match(q.text, /f\.texte/);
  assert.match(q.text, /'ecarts'/);
  assert.deepStrictEqual(q.values, ['2026-08-04', 1204]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rens-api/audit/rapport.test.js`
Expected: FAIL — `Cannot find module './rapport'`

- [ ] **Step 3: Write the implementation**

```js
// server/rens-api/audit/rapport.js
// Lecture du rapport d'audit. Toute l'agrégation est faite par la base : le front
// affiche, il ne calcule pas. Fonctions PURES (testables sans base).

const { CRITERES } = require('./criteres');

// Table de correspondance code → libellé, injectée comme VALUES pour que les libellés
// restent une source unique côté Node.
const LIBELLES = Object.entries(CRITERES).map(([c, v]) => `('${c}','${v.libelle.replace(/'/g, "''")}')`).join(',');

const RANG_GRAVITE = `CASE gravite WHEN 'bloquant' THEN 3 WHEN 'majeur' THEN 2 ELSE 1 END`;

function buildRapportQuery(jour, ggd) {
  const values = [];
  let selRun;
  if (jour) { values.push(jour); selRun = `SELECT * FROM frs_audit_run WHERE jour = $1::date`; }
  else { selRun = `SELECT * FROM frs_audit_run ORDER BY jour DESC LIMIT 1`; }

  let filtreGgd = '';
  if (ggd) { values.push(ggd); filtreGgd = ` AND f.code_ggd = $${values.length}`; }

  const text = `
    WITH r AS (${selRun}),
    e AS (
      SELECT a.*, f.unite, f.code_ggd, f.commune, f.titre,
             to_char(f.date_redaction, 'YYYY-MM-DD') AS date_redaction
        FROM frs_audit a JOIN r ON a.run_id = r.id JOIN frs f ON f.id = a.frs_id
       WHERE true${filtreGgd}
    ),
    par_fiche AS (
      SELECT frs_id, titre, unite, code_ggd, commune, date_redaction,
             count(*)::int AS n_ecarts,
             max(${RANG_GRAVITE})::int AS rang_max,
             array_agg(critere ORDER BY critere) AS criteres
        FROM e GROUP BY frs_id, titre, unite, code_ggd, commune, date_redaction
    ),
    lib(code, libelle) AS (VALUES ${LIBELLES})
    SELECT json_build_object(
      'run', (SELECT json_build_object(
                'jour', to_char(r.jour,'YYYY-MM-DD'), 'statut', r.statut,
                'termine_a', r.termine_a, 'total_fiches', r.total_fiches,
                'fragments_total', r.fragments_total, 'fragments_ok', r.fragments_ok,
                'taille_fragment', r.taille_fragment) FROM r),
      'synthese', json_build_object(
        'fiches_non_conformes', (SELECT count(*)::int FROM par_fiche),
        'taux_conformite', (SELECT CASE WHEN COALESCE(r.total_fiches,0) = 0 THEN NULL
                              ELSE round(1 - (SELECT count(*)::numeric FROM par_fiche) / r.total_fiches, 3) END FROM r),
        'par_gravite', (SELECT COALESCE(json_object_agg(g, n), '{}'::json) FROM
                          (SELECT gravite AS g, count(DISTINCT frs_id)::int AS n FROM e GROUP BY gravite) x),
        'par_critere', (SELECT COALESCE(json_agg(json_build_object('critere', c, 'libelle', l, 'n', n) ORDER BY n DESC), '[]'::json)
                          FROM (SELECT e.critere AS c, lib.libelle AS l, count(*)::int AS n
                                  FROM e JOIN lib ON lib.code = e.critere GROUP BY e.critere, lib.libelle) y),
        'par_unite', (SELECT COALESCE(json_agg(json_build_object('unite', u, 'n', n, 'bloquant', b) ORDER BY b DESC, n DESC), '[]'::json)
                        FROM (SELECT unite AS u, count(DISTINCT frs_id)::int AS n,
                                     count(DISTINCT frs_id) FILTER (WHERE gravite = 'bloquant')::int AS b
                                FROM e GROUP BY unite) z)),
      'fiches', (SELECT COALESCE(json_agg(json_build_object(
                    'frs_id', frs_id, 'titre', titre, 'unite', unite, 'code_ggd', code_ggd,
                    'commune', commune, 'date_redaction', date_redaction, 'n_ecarts', n_ecarts,
                    'criteres', criteres,
                    'gravite_max', CASE rang_max WHEN 3 THEN 'bloquant' WHEN 2 THEN 'majeur' ELSE 'mineur' END)
                    ORDER BY rang_max DESC, unite, frs_id), '[]'::json) FROM par_fiche)
    ) AS rapport`;
  return { text, values };
}

function buildRapportFicheQuery(jour, frsId) {
  const text = `
    WITH r AS (SELECT id FROM frs_audit_run WHERE jour = $1::date),
    lib(code, libelle) AS (VALUES ${LIBELLES})
    SELECT json_build_object(
      'frs_id', f.id, 'titre', f.titre, 'unite', f.unite, 'code_ggd', f.code_ggd,
      'commune', f.commune, 'motif', f.motif, 'origine_info', f.origine_info,
      'date_redaction', to_char(f.date_redaction,'YYYY-MM-DD'),
      'date_evenement', to_char(f.date_evenement,'YYYY-MM-DD'),
      'texte', f.texte,
      'ecarts', (SELECT COALESCE(json_agg(json_build_object(
                    'critere', a.critere, 'libelle', lib.libelle, 'gravite', a.gravite,
                    'source', a.source, 'fondement', a.fondement, 'extrait', a.extrait,
                    'explication', a.explication, 'confiance', a.confiance)
                    ORDER BY ${RANG_GRAVITE.replace(/gravite/g, 'a.gravite')} DESC, a.critere), '[]'::json)
                   FROM frs_audit a JOIN r ON a.run_id = r.id JOIN lib ON lib.code = a.critere
                  WHERE a.frs_id = f.id)
    ) AS fiche
    FROM frs f WHERE f.id = $2`;
  return { text, values: [jour, frsId] };
}

module.exports = { buildRapportQuery, buildRapportFicheQuery };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/rens-api/audit/rapport.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Add the two routes to `server.js`**

Ajouter l'import en tête de `server/rens-api/server.js`, sous les autres `require` :

```js
const { buildRapportQuery, buildRapportFicheQuery } = require('./audit/rapport');
```

Puis, juste avant `return err(res, 404, 'not_found', 'Route inconnue');` :

```js
  if (u.pathname === '/audit/rapport' && req.method === 'GET') {
    const jour = (u.searchParams.get('jour') || '').trim();
    if (jour && !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return err(res, 400, 'bad_request', "Paramètre 'jour' invalide (YYYY-MM-DD)");
    try {
      const q = buildRapportQuery(jour || null, (u.searchParams.get('ggd') || '').trim());
      const r = await pool.query(q.text, q.values);
      const rapport = r.rows[0] && r.rows[0].rapport;
      // Aucun run pour ce jour : 404 explicite. Un rapport vide se confondrait avec « tout est conforme ».
      if (!rapport || !rapport.run) return err(res, 404, 'no_run', `Aucun audit pour ${jour || 'le dernier jour'}`);
      return json(res, 200, { data: rapport });
    } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
  }

  if (u.pathname === '/audit/fiche' && req.method === 'GET') {
    const jour = (u.searchParams.get('jour') || '').trim();
    const id = parseInt(u.searchParams.get('frs_id'), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return err(res, 400, 'bad_request', "Paramètre 'jour' requis (YYYY-MM-DD)");
    if (!Number.isInteger(id)) return err(res, 400, 'bad_request', "Paramètre 'frs_id' requis");
    try {
      const q = buildRapportFicheQuery(jour, id);
      const r = await pool.query(q.text, q.values);
      if (!r.rows.length) return err(res, 404, 'not_found', `Fiche ${id} introuvable`);
      return json(res, 200, { data: r.rows[0].fiche });
    } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
  }
```

- [ ] **Step 6: Declare the routes in `openapi.json`**

Ajouter dans `paths`, à côté de `/signaux` :

```json
"/audit/rapport": {
 "get": {
  "operationId": "auditRapport",
  "summary": "Rapport d'audit qualité GIPASP d'un jour (run nocturne). Sans 'jour', renvoie le dernier run.",
  "parameters": [
   { "name": "jour", "in": "query", "schema": { "type": "string", "format": "date" } },
   { "name": "ggd", "in": "query", "schema": { "type": "string" } }
  ],
  "responses": { "200": { "description": "Rapport" }, "404": { "description": "Aucun audit pour ce jour" } }
 }
},
"/audit/fiche": {
 "get": {
  "operationId": "auditFiche",
  "summary": "Détail d'une fiche auditée : texte intégral et écarts avec leur fondement.",
  "parameters": [
   { "name": "jour", "in": "query", "required": true, "schema": { "type": "string", "format": "date" } },
   { "name": "frs_id", "in": "query", "required": true, "schema": { "type": "integer" } }
  ],
  "responses": { "200": { "description": "Fiche et écarts" }, "404": { "description": "Introuvable" } }
 }
}
```

- [ ] **Step 7: Faire PARSER les deux requêtes par Postgres**

Tous les tests de ce dépôt vérifient `q.text` par expression régulière. C'est la convention, et elle suffit pour `fiches.js`. Mais `buildRapportQuery` empile quatre niveaux de `json_build_object` et une CTE `VALUES` de littéraux non typés — cas classique de `failed to determine data type of column`. Une requête qui ne compile pas passe tous les tests regex du monde.

Faire exécuter les deux requêtes une fois contre la base réelle. Un jour vide suffit : on ne cherche pas des lignes, on cherche que Postgres accepte de typer la requête.

```bash
node -e "
const { Pool } = require('pg');
const { buildRapportQuery, buildRapportFicheQuery } = require('./server/rens-api/audit/rapport');
(async () => {
  const pool = new Pool();
  for (const q of [buildRapportQuery('2000-01-01', ''), buildRapportQuery(null, 'GGD 49'), buildRapportFicheQuery('2000-01-01', 1)]) {
    await pool.query(q.text, q.values);
    console.log('OK');
  }
  await pool.end();
})().catch((e) => { console.error('ÉCHEC :', e.message); process.exit(1); });
"
```

Si Postgres refuse de typer la CTE, ajouter les casts explicites : `lib(code, libelle) AS (VALUES ('A1'::text, '…'::text), …)` — il suffit de typer la **première** ligne.

- [ ] **Step 8: Run the whole rens-api suite**

Run: `node --test server/rens-api/`
Expected: PASS — les tests existants (`fiches.test.js`) et les nouveaux.

- [ ] **Step 9: Commit**

```bash
git add server/rens-api/audit/rapport.js server/rens-api/audit/rapport.test.js server/rens-api/server.js server/rens-api/openapi.json
git commit -m "feat(audit): requêtes et routes de lecture du rapport d'audit"
```

---

### Task 10: Routes BFF

**Files:**
- Modify: `server/proxy.mjs` (routes `/api/rens/audit/*`, à placer près de `/api/rens/fiches`)
- Modify: `server/proxy.test.mjs` (ou créer `server/proxy.audit.test.mjs` si le fichier existant dépasse 400 lignes)

**Interfaces:**
- Consumes: le helper de forward déjà utilisé par `/api/rens/fiches` dans `proxy.mjs` (`cfg.rensApiUrl`, `cfg.rensApiToken`, en-tête `Authorization: Bearer`).
- Produces: `GET /api/rens/audit/rapport` et `GET /api/rens/audit/fiche`, forwards purs vers rens-api.

- [ ] **Step 1: Write the failing test**

```js
// server/proxy.audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { createHandler } from './proxy.mjs';

const cfg = { rensApiUrl: 'https://rens.test', rensApiToken: 'TK' };
const faireReq = (url) => ({ url, method: 'GET', headers: {} });
const faireRes = () => {
  const r = { code: 0, corps: '', entetes: {} };
  r.writeHead = (c, h) => { r.code = c; r.entetes = h; };
  r.end = (b) => { r.corps = b; };
  return r;
};

test('/api/rens/audit/rapport forwarde jour et ggd avec le Bearer serveur', async () => {
  let vue = null;
  const fetchImpl = async (url, opt) => {
    vue = { url, auth: opt.headers.Authorization };
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { run: { jour: '2026-08-04' } } }) };
  };
  const h = createHandler({ cfg, fetchImpl });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/rapport?jour=2026-08-04&ggd=GGD%2049'), res);
  assert.strictEqual(res.code, 200);
  assert.match(vue.url, /^https:\/\/rens\.test\/audit\/rapport\?jour=2026-08-04&ggd=GGD(%20|\+)49$/);
  assert.strictEqual(vue.auth, 'Bearer TK');
  assert.match(res.corps, /2026-08-04/);
});

test('/api/rens/audit/fiche forwarde frs_id', async () => {
  let vue = '';
  const fetchImpl = async (url) => { vue = url; return { ok: true, status: 200, text: async () => '{"data":{}}' }; };
  const h = createHandler({ cfg, fetchImpl });
  await h(faireReq('/api/rens/audit/fiche?jour=2026-08-04&frs_id=1204'), faireRes());
  assert.match(vue, /\/audit\/fiche\?jour=2026-08-04&frs_id=1204$/);
});

test('404 amont (aucun audit) est transmis tel quel, pas transformé en rapport vide', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => '{"error":{"code":"no_run","message":"Aucun audit"}}' });
  const h = createHandler({ cfg, fetchImpl });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/rapport?jour=2026-08-04'), res);
  assert.strictEqual(res.code, 404);
  assert.match(res.corps, /no_run/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/proxy.audit.test.mjs`
Expected: FAIL — la route renvoie 404 « Route inconnue » au lieu de forwarder.

- [ ] **Step 3: Add the routes**

Dans `server/proxy.mjs`, à côté du bloc `if (url.pathname === "/api/rens/fiches" ...)` (ligne ~162), en réutilisant le même helper de forward :

```js
    if (url.pathname === "/api/rens/audit/rapport" && req.method === "GET") {
      return forwardRens("/audit/rapport", url.search, res);
    }
    if (url.pathname === "/api/rens/audit/fiche" && req.method === "GET") {
      return forwardRens("/audit/fiche", url.search, res);
    }
```

> Le helper de forward existe déjà (il sert `/api/rens/fiches` et `/api/rens/fiche`, cf. `server/proxy.mjs:84-90`). S'il n'est pas encore une fonction nommée, l'extraire en `forwardRens(path, search, res)` **sans changer son comportement**, et faire pointer les routes existantes dessus dans le même commit.

- [ ] **Step 4: Run tests**

Run: `node --test server/proxy.audit.test.mjs && node --test server/`
Expected: PASS — les nouveaux tests et tous les tests BFF existants.

- [ ] **Step 5: Commit**

```bash
git add server/proxy.mjs server/proxy.audit.test.mjs
git commit -m "feat(audit): routes BFF de lecture du rapport d'audit"
```

---

### Task 11: Défauts plantés dans l'alimentation nocturne

> **Cette tâche introduit un marqueur technique dans `frs_mot_cle`, qui est lu par une feature déjà en production.** Sans l'étape 5, `defaut:A3` s'afficherait comme mot-clé dans la liste RENS, et surtout : ~40 marqueurs par nuit répartis sur 11 codes donnent 3-4 occurrences par code et par nuit, dispersées entre départements. En quelques jours chaque code entre dans la fenêtre `count BETWEEN 5 AND 20 AND depts >= 3` — **la découverte de signaux faibles se mettrait à annoncer `defaut:A3` comme phénomène émergent.** L'étape 5 n'est pas une finition, c'est une condition.

**Files:**
- Modify: `server/rens-api/seed/corpus.mjs` (ajout de `MUTATIONS`)
- Modify: `server/rens-api/seed/nightly.mjs` (application des mutations, insertion de `motif` / `date_evenement` / `origine_info`)
- Create: `server/rens-api/seed/mutations.test.mjs`
- Modify: `server/rens-api/fiches.js` (exclusion des marqueurs techniques)
- Modify: `server/rens-api/fiches.test.js`

**Interfaces:**
- Consumes: les trames existantes de `corpus.mjs`.
- Produces: `MUTATIONS` — tableau de `{ code: string, applique: (fiche) => fiche }`, et `appliquerDefauts(fiches, rand)` exporté depuis `corpus.mjs`.

- [ ] **Step 1: Write the failing test**

```js
// server/rens-api/seed/mutations.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { MUTATIONS, appliquerDefauts } from './corpus.mjs';

const base = () => Array.from({ length: 200 }, (_, i) => ({
  titre: 'T' + i, unite: 'COB X', ggd: 'GGD 49', dep: 'Maine-et-Loire', commune: 'Segré',
  texte: 'Faits constatés le 3 août sur la commune, sans interpellation.',
  mots: ['ordre public'], motif: 'violences urbaines',
  date_evenement: '2026-08-03', origine_info: 'constatation directe',
}));

test('chaque mutation porte un code de la grille et une fonction', () => {
  const codes = ['A1', 'A3', 'A4', 'B5', 'B6', 'B7', 'C2', 'C8', 'C9', 'D11', 'D12'];
  for (const m of MUTATIONS) {
    assert.ok(codes.includes(m.code), `code inattendu : ${m.code}`);
    assert.strictEqual(typeof m.applique, 'function');
  }
  assert.deepStrictEqual([...new Set(MUTATIONS.map((m) => m.code))].sort(), codes.sort());
});

test('C10 n\'est PAS planté : la purge à 90 jours le rend inatteignable', () => {
  assert.ok(!MUTATIONS.some((m) => m.code === 'C10'));
});

test('appliquerDefauts : marque chaque fiche mutée d\'un mot-clé defaut:<code>', () => {
  let n = 0;
  const rand = () => (n++ % 7) / 7;
  const f = appliquerDefauts(base(), rand, 40);
  const mutees = f.filter((x) => x.mots.some((m) => m.startsWith('defaut:')));
  assert.strictEqual(mutees.length, 40);
  for (const m of mutees) {
    const code = m.mots.find((x) => x.startsWith('defaut:')).slice(7);
    assert.ok(MUTATIONS.some((mu) => mu.code === code));
  }
});

test('appliquerDefauts : mute des trames existantes, ne fabrique pas de fiches neuves', () => {
  const avant = base();
  const apres = appliquerDefauts(avant.map((x) => ({ ...x, mots: [...x.mots] })), () => 0.5, 10);
  assert.strictEqual(apres.length, avant.length);
  for (const f of apres) assert.match(f.titre, /^T\d+$/);
});

test('C2 : la mutation retire réellement le motif', () => {
  const m = MUTATIONS.find((x) => x.code === 'C2');
  assert.strictEqual(m.applique({ ...base()[0] }).motif, null);
});

test('C8 : la mutation retire la date d\'événement', () => {
  const m = MUTATIONS.find((x) => x.code === 'C8');
  assert.strictEqual(m.applique({ ...base()[0] }).date_evenement, null);
});

test('A3 : la mutation pose un motif sans rapport avec les faits narrés', () => {
  const m = MUTATIONS.find((x) => x.code === 'A3');
  const f = m.applique({ ...base()[0] });
  assert.strictEqual(f.motif, 'radicalisation');
  assert.match(f.texte, /aucun élément de provocation/i);
});

test("AUCUNE mutation ne remplace le texte de la trame : elle le GREFFE", () => {
  // Une fiche défectueuse écrite « à part » se reconnaîtrait au style et reviendrait
  // à l'identique chaque nuit ; l'agent apprendrait une forme au lieu de raisonner,
  // et le taux de détection mesurerait autre chose que ce qu'on croit.
  const origine = base()[0];
  const noyau = 'Faits constatés le 3 août sur la commune';
  for (const m of MUTATIONS) {
    const f = m.applique({ ...origine });
    assert.ok(f.texte.includes(noyau), `${m.code} : le texte de la trame a été perdu`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rens-api/seed/mutations.test.mjs`
Expected: FAIL — `MUTATIONS is not exported`

- [ ] **Step 3: Add mutations to `corpus.mjs`**

Ajouter en fin de `server/rens-api/seed/corpus.mjs` :

```js
// --- Vérité terrain : défauts plantés -------------------------------------------------------
// Le corpus est CONFORME PAR CONSTRUCTION (cf. en-tête) : sans défauts, l'audit afficherait
// 100 % et ne prouverait rien. Chaque mutation part d'une trame EXISTANTE — jamais d'un
// gabarit neuf : une fiche défectueuse écrite « à part » se reconnaîtrait au style, et
// l'agent apprendrait une forme au lieu de raisonner sur le fond.
// C10 (péremption à un an) est absent : la purge glissante à 90 jours le rend inatteignable.

export const MUTATIONS = [
  { code: 'C2',  applique: (f) => ({ ...f, motif: null }) },
  { code: 'C8',  applique: (f) => ({ ...f, date_evenement: null }) },
  { code: 'D11', applique: (f) => ({ ...f, origine_info: null,
      texte: f.texte + " Il se dit dans le voisinage que l'intéressé prépare d'autres actions." }) },
  { code: 'D12', applique: (f) => ({ ...f,
      texte: f.texte + " Individu manifestement nuisible et sans le moindre scrupule, au comportement inquiétant." }) },
  // Cas cité par le référent national : un fait anodin qualifié de radicalisme. On GREFFE
  // le motif inadapté sur la trame tirée, on ne remplace pas son texte — sinon la même
  // phrase reviendrait chaque nuit et l'agent reconnaîtrait une forme au lieu de raisonner.
  { code: 'A3',  applique: (f) => ({ ...f, motif: 'radicalisation',
      texte: f.texte + " Aucun élément de provocation, de menace ni de violence n'est relevé ; les intéressés ont obtempéré sans incident." }) },
  // A1 : on désamorce les faits de la trame — il ne reste plus d'atteinte à caractériser,
  // alors que la fiche continue de nommer des personnes.
  { code: 'A1',  applique: (f) => ({ ...f, motif: 'violences urbaines',
      texte: f.texte.replace(/\.\s*$/, '') + ". Vérification faite, il s'agit d'un différend de voisinage relatif à une haie mitoyenne : aucune violence, aucune menace, médiation acceptée par les deux parties." }) },
  { code: 'A4',  applique: (f) => ({ ...f,
      texte: f.texte + " Était également présente sur les lieux Mme Julie LEROY, commerçante du quartier, qui n'a fait que constater la scène depuis sa vitrine." }) },
  { code: 'B5',  applique: (f) => ({ ...f,
      texte: f.texte + " L'intéressé, d'origine maghrébine, suit un traitement pour dépression depuis deux ans selon son entourage." }) },
  { code: 'B6',  applique: (f) => ({ ...f,
      texte: f.texte + " Son compte est accessible avec le mot de passe communiqué par un tiers : « soleil2026 »." }) },
  { code: 'B7',  applique: (f) => ({ ...f,
      texte: f.texte + " Son épouse est aide-soignante à l'hôpital, ses deux enfants sont scolarisés en primaire, sa belle-mère réside au domicile et perçoit une pension de réversion." }) },
  // C9 : on rattache la trame à un mineur de moins de 13 ans, sans réécrire les faits.
  { code: 'C9',  applique: (f) => ({ ...f,
      texte: f.texte + " Parmi les personnes concernées figure un collégien de 12 ans, scolarisé dans l'établissement voisin, dont les parents ont été reçus." }) },
];

// Applique `combien` mutations sur des fiches tirées dans le lot, et marque chaque fiche
// mutée d'un mot-clé technique `defaut:<code>` — même mécanisme que `signal-faible:<code>`.
// Ce mot-clé ne doit JAMAIS atteindre un prompt (cf. audit/fragments.mjs, liste blanche).
export function appliquerDefauts(fiches, rand, combien) {
  const n = Math.min(combien, fiches.length);
  const pris = new Set();
  for (let i = 0; i < n; i++) {
    let idx = Math.floor(rand() * fiches.length);
    while (pris.has(idx)) idx = (idx + 1) % fiches.length;
    pris.add(idx);
    const mut = MUTATIONS[i % MUTATIONS.length];
    fiches[idx] = mut.applique(fiches[idx]);
    fiches[idx].mots = [...fiches[idx].mots, `defaut:${mut.code}`];
  }
  return fiches;
}
```

- [ ] **Step 4: Wire it into `nightly.mjs`**

Dans `server/rens-api/seed/nightly.mjs` : importer `appliquerDefauts` depuis `./corpus.mjs`, l'appliquer en fin de `buildFiches()` (`return appliquerDefauts(fiches, Math.random, Number(process.env.AUDIT_DEFAUTS ?? 40));`), et étendre l'`INSERT` pour porter les trois nouvelles colonnes :

```js
      const { rows: [{ id }] } = await client.query(
        `INSERT INTO frs (date_redaction, titre, unite, code_ggd, departement, commune, texte,
                          motif, date_evenement, origine_info)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [f.titre, f.unite, f.ggd, f.dep, f.commune, f.texte,
         f.motif ?? null, f.date_evenement ?? null, f.origine_info ?? null]
      );
```

Les trames non mutées doivent recevoir un `motif` du référentiel, une `date_evenement` (la veille de la rédaction) et une `origine_info` — sans quoi *toutes* les fiches seraient `C2`/`C8` et le taux de conformité serait nul. Les poser dans `buildFiches()` avant l'appel à `appliquerDefauts`.

- [ ] **Step 5: Exclure les marqueurs techniques des lectures RENS existantes**

Écrire d'abord le test qui échoue, dans `server/rens-api/fiches.test.js` :

```js
test('les marqueurs techniques sont exclus de TOUTES les agrégations par mot-clé', () => {
  const requetes = [
    buildSignauxQuery(P('date=2026-08-04')).text,
    buildSignauxFaiblesQuery(P('')).text,
    buildAgregatsQuery('2026-08-04').text,
  ];
  for (const t of requetes) {
    assert.match(t, /NOT LIKE 'signal-faible:%'/);
    assert.match(t, /NOT LIKE 'defaut:%'/);
  }
});

test('buildListQuery : les mots-clés rendus au front excluent les marqueurs techniques', () => {
  const t = buildListQuery(P('date=2026-08-04')).text;
  assert.match(t, /FILTER \(WHERE m\.mot IS NOT NULL AND m\.mot NOT LIKE 'defaut:%' AND m\.mot NOT LIKE 'signal-faible:%'\)/);
});
```

Run: `node --test server/rens-api/fiches.test.js` → FAIL sur les deux.

Puis, dans `server/rens-api/fiches.js` :

1. Ajouter en tête, sous le commentaire d'ouverture :

```js
// Marqueurs techniques de test : jamais affichés au front, jamais agrégés. Un marqueur
// planté ~4 fois par nuit et par code entre en quelques jours dans la fenêtre des signaux
// faibles (5-20 occurrences, >= 3 départements) — il serait annoncé comme un phénomène
// émergent. L'exclusion appartient donc à la requête, pas à la recette.
const EXCLUT_MARQUEURS = "m.mot NOT LIKE 'signal-faible:%' AND m.mot NOT LIKE 'defaut:%'";
```

2. Dans `SELECT_LIST`, remplacer le `FILTER` de l'agrégat par :

```sql
         COALESCE(array_agg(m.mot ORDER BY m.ordre) FILTER (WHERE m.mot IS NOT NULL AND m.mot NOT LIKE 'defaut:%' AND m.mot NOT LIKE 'signal-faible:%'), '{}') AS mots_cles
```

3. Dans `buildSignauxFaiblesQuery`, `buildAgregatsQuery` et `buildSignauxQuery`, remplacer chaque `m.mot NOT LIKE 'signal-faible:%'` par `${EXCLUT_MARQUEURS}` (trois emplacements ; `buildAgregatsQuery` en a un dans le sous-select `top_mots`).

4. Dans le filtre `q` de `buildFilters`, la sous-requête `EXISTS ... mk.mot ILIKE` doit exclure les marqueurs pour qu'une recherche libre ne puisse pas les atteindre :

```js
    where.push(`(f.titre ILIKE ${i} OR f.texte ILIKE ${i} OR EXISTS (SELECT 1 FROM frs_mot_cle mk WHERE mk.frs_id = f.id AND mk.mot ILIKE ${i} AND mk.mot NOT LIKE 'signal-faible:%' AND mk.mot NOT LIKE 'defaut:%'))`);
```

- [ ] **Step 6: Run tests**

Run: `node --test server/rens-api/`
Expected: PASS — `mutations.test.mjs` (7 tests), les deux nouveaux tests de `fiches.test.js`, et **tous les tests RENS existants inchangés**.

- [ ] **Step 7: Commit**

```bash
git add server/rens-api/seed/corpus.mjs server/rens-api/seed/nightly.mjs server/rens-api/seed/mutations.test.mjs server/rens-api/fiches.js server/rens-api/fiches.test.js
git commit -m "feat(audit): défauts plantés par mutation de trames, marqueurs exclus des lectures RENS"
```

---

### Task 12: Front — client API et store

**Files:**
- Create: `src/features/qualite/qualiteApi.ts`
- Create: `src/features/qualite/qualiteApi.test.ts`
- Create: `src/features/qualite/qualiteStore.ts`
- Create: `src/features/qualite/qualiteStore.test.ts`

**Interfaces:**
- Consumes: `GET /api/rens/audit/rapport`, `GET /api/rens/audit/fiche`.
- Produces:
  - types `Rapport`, `FicheLigne`, `FicheDetail`, `Ecart`, `Gravite = 'bloquant'|'majeur'|'mineur'`
  - `fetchRapport(jour: string|null, ggd: string): Promise<Rapport>`
  - `fetchFicheAudit(jour: string, frsId: number): Promise<FicheDetail>`
  - `filtrerParFile(fiches: FicheLigne[], file: 'supprimer'|'corriger'|'surveiller'): FicheLigne[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/qualite/qualiteApi.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchRapport, fetchFicheAudit } from "./qualiteApi";

afterEach(() => vi.unstubAllGlobals());

const rep = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

describe("qualiteApi", () => {
  it("appelle /api/rens/audit/rapport avec jour et ggd", async () => {
    const spy = vi.fn(async () => rep({ data: { run: { jour: "2026-08-04" }, synthese: {}, fiches: [] } }));
    vi.stubGlobal("fetch", spy);
    await fetchRapport("2026-08-04", "GGD 49");
    expect(spy.mock.calls[0][0]).toContain("/api/rens/audit/rapport?jour=2026-08-04&ggd=GGD+49");
  });

  it("omet le paramètre jour quand il est nul (dernier run)", async () => {
    const spy = vi.fn(async () => rep({ data: { run: {}, synthese: {}, fiches: [] } }));
    vi.stubGlobal("fetch", spy);
    await fetchRapport(null, "");
    expect(spy.mock.calls[0][0]).not.toContain("jour=");
  });

  it("remonte le code d'erreur du BFF plutôt qu'un message générique", async () => {
    vi.stubGlobal("fetch", async () => rep({ error: { code: "no_run", message: "Aucun audit" } }, false, 404));
    await expect(fetchRapport("2026-08-04", "")).rejects.toThrow("no_run");
  });

  it("fetchFicheAudit passe jour et frs_id", async () => {
    const spy = vi.fn(async () => rep({ data: { frs_id: 12, ecarts: [] } }));
    vi.stubGlobal("fetch", spy);
    const f = await fetchFicheAudit("2026-08-04", 12);
    expect(spy.mock.calls[0][0]).toContain("frs_id=12");
    expect(f.frs_id).toBe(12);
  });
});
```

```ts
// src/features/qualite/qualiteStore.test.ts
import { describe, it, expect } from "vitest";
import { filtrerParFile } from "./qualiteStore";
import type { FicheLigne } from "./qualiteApi";

const f = (frs_id: number, gravite_max: FicheLigne["gravite_max"]): FicheLigne => ({
  frs_id, titre: "T", unite: "COB X", code_ggd: "GGD 49", commune: "C",
  date_redaction: "2026-08-04", n_ecarts: 1, criteres: ["A1"], gravite_max,
});

describe("filtrerParFile", () => {
  const lot = [f(1, "bloquant"), f(2, "majeur"), f(3, "mineur"), f(4, "bloquant")];

  it("« à supprimer » ne contient que les bloquants", () => {
    expect(filtrerParFile(lot, "supprimer").map((x) => x.frs_id)).toEqual([1, 4]);
  });

  it("« à corriger » exclut les fiches déjà bloquantes, pour ne pas les traiter deux fois", () => {
    expect(filtrerParFile(lot, "corriger").map((x) => x.frs_id)).toEqual([2]);
  });

  it("« à surveiller » ne garde que les fiches sans écart plus grave", () => {
    expect(filtrerParFile(lot, "surveiller").map((x) => x.frs_id)).toEqual([3]);
  });

  it("les trois files partitionnent le lot : aucune fiche perdue, aucune comptée deux fois", () => {
    const total = (["supprimer", "corriger", "surveiller"] as const)
      .flatMap((file) => filtrerParFile(lot, file).map((x) => x.frs_id));
    expect(total.sort()).toEqual([1, 2, 3, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/qualite`
Expected: FAIL — `Failed to resolve import "./qualiteApi"`

- [ ] **Step 3: Write the implementation**

```ts
// src/features/qualite/qualiteApi.ts
export type Gravite = "bloquant" | "majeur" | "mineur";

export type Ecart = {
  critere: string; libelle: string; gravite: Gravite;
  source: "sql" | "llm"; fondement: string | null;
  extrait: string | null; explication: string | null;
  confiance: "haute" | "moyenne" | null;
};

export type FicheLigne = {
  frs_id: number; titre: string; unite: string; code_ggd: string; commune: string;
  date_redaction: string; n_ecarts: number; criteres: string[]; gravite_max: Gravite;
};

export type FicheDetail = {
  frs_id: number; titre: string; unite: string; code_ggd: string; commune: string;
  motif: string | null; origine_info: string | null;
  date_redaction: string; date_evenement: string | null;
  texte: string; ecarts: Ecart[];
};

export type Rapport = {
  run: {
    jour: string; statut: "en_cours" | "complet" | "partiel" | "echec";
    termine_a: string | null; total_fiches: number;
    fragments_total: number; fragments_ok: number; taille_fragment: number;
  };
  synthese: {
    fiches_non_conformes: number;
    taux_conformite: number | null;
    par_gravite: Partial<Record<Gravite, number>>;
    par_critere: { critere: string; libelle: string; n: number }[];
    par_unite: { unite: string; n: number; bloquant: number }[];
  };
  fiches: FicheLigne[];
};

async function lire<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // On remonte le code du BFF : « no_run » et « db_error » n'appellent pas le même message.
    throw new Error(body?.error?.code || `http_${res.status}`);
  }
  return body.data as T;
}

export function fetchRapport(jour: string | null, ggd: string): Promise<Rapport> {
  const p = new URLSearchParams();
  if (jour) p.set("jour", jour);
  if (ggd) p.set("ggd", ggd);
  const q = p.toString();
  return lire<Rapport>("/api/rens/audit/rapport" + (q ? "?" + q : ""));
}

export function fetchFicheAudit(jour: string, frsId: number): Promise<FicheDetail> {
  return lire<FicheDetail>(`/api/rens/audit/fiche?jour=${encodeURIComponent(jour)}&frs_id=${frsId}`);
}
```

```ts
// src/features/qualite/qualiteStore.ts
import type { FicheLigne } from "./qualiteApi";

export type File = "supprimer" | "corriger" | "surveiller";

// Les trois files PARTITIONNENT le lot : une fiche apparaît dans une seule, celle de son
// écart le plus grave. Sans ça, le contrôleur traiterait deux fois la même fiche.
export function filtrerParFile(fiches: FicheLigne[], file: File): FicheLigne[] {
  const cible = { supprimer: "bloquant", corriger: "majeur", surveiller: "mineur" } as const;
  return fiches.filter((f) => f.gravite_max === cible[file]);
}

export const LIBELLE_FILE: Record<File, string> = {
  supprimer: "À supprimer",
  corriger: "À corriger",
  surveiller: "À surveiller",
};
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/features/qualite`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/qualite/qualiteApi.ts src/features/qualite/qualiteApi.test.ts src/features/qualite/qualiteStore.ts src/features/qualite/qualiteStore.test.ts
git commit -m "feat(qualite): client API et files de travail du rapport d'audit"
```

---

### Task 13: Front — en-tête de couverture et états

**Files:**
- Create: `src/features/qualite/RapportEntete.tsx`
- Create: `src/features/qualite/RapportEntete.test.tsx`

**Interfaces:**
- Consumes: type `Rapport` de `./qualiteApi`.
- Produces: `<RapportEntete rapport={Rapport} />` — bandeau de couverture, taux, compteurs de gravité.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/qualite/RapportEntete.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RapportEntete } from "./RapportEntete";
import type { Rapport } from "./qualiteApi";

const rapport = (over: Partial<Rapport["run"]> = {}): Rapport => ({
  run: { jour: "2026-08-04", statut: "complet", termine_a: "2026-08-05T03:12:44Z",
         total_fiches: 1043, fragments_total: 26, fragments_ok: 26, taille_fragment: 40, ...over },
  synthese: { fiches_non_conformes: 168, taux_conformite: 0.839,
              par_gravite: { bloquant: 11, majeur: 74, mineur: 83 },
              par_critere: [], par_unite: [] },
  fiches: [],
});

describe("RapportEntete", () => {
  it("annonce la couverture avant le résultat", () => {
    render(<RapportEntete rapport={rapport()} />);
    expect(screen.getByText(/1\s?043 fiches contrôlées/)).toBeTruthy();
    expect(screen.getByText(/26\s?\/\s?26 fragments/)).toBeTruthy();
    expect(screen.getByText(/83,9\s?%/)).toBeTruthy();
  });

  it("affiche les trois compteurs de gravité", () => {
    render(<RapportEntete rapport={rapport()} />);
    expect(screen.getByText(/11 bloquants?/)).toBeTruthy();
    expect(screen.getByText(/74 majeurs?/)).toBeTruthy();
    expect(screen.getByText(/83 mineurs?/)).toBeTruthy();
  });

  it("un run partiel est ANNONCÉ, avec le nombre de fiches non contrôlées", () => {
    render(<RapportEntete rapport={rapport({ statut: "partiel", fragments_ok: 24 })} />);
    const alerte = screen.getByRole("alert");
    expect(alerte.textContent).toMatch(/24\s?\/\s?26/);
    expect(alerte.textContent).toMatch(/80 fiches non contrôlées/);
  });

  it("un run complet n'affiche aucune alerte", () => {
    render(<RapportEntete rapport={rapport()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("n'utilise aucun emoji", () => {
    const { container } = render(<RapportEntete rapport={rapport({ statut: "partiel", fragments_ok: 20 })} />);
    expect(container.textContent || "").not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/qualite/RapportEntete`
Expected: FAIL — `Failed to resolve import "./RapportEntete"`

- [ ] **Step 3: Write the implementation**

```tsx
// src/features/qualite/RapportEntete.tsx
import type { Rapport } from "./qualiteApi";

const nombre = (n: number) => n.toLocaleString("fr-FR");

// La couverture passe AVANT le résultat : un rapport qui laisse croire à une couverture
// totale qu'il n'a pas est pire que pas de rapport.
export function RapportEntete({ rapport }: { rapport: Rapport }) {
  const { run, synthese } = rapport;
  const g = synthese.par_gravite;
  const taux = synthese.taux_conformite;
  const manquants = run.fragments_total > 0
    ? (run.fragments_total - run.fragments_ok) * run.taille_fragment
    : 0;

  return (
    <header className="qualite-entete">
      <h1>Audit du {new Date(run.jour).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</h1>

      <p className="qualite-couverture">
        {nombre(run.total_fiches)} fiches contrôlées, {run.fragments_ok}/{run.fragments_total} fragments
        {run.termine_a ? ` · terminé à ${new Date(run.termine_a).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}
      </p>

      {run.statut === "partiel" && (
        <p role="alert" className="qualite-alerte">
          <span className="material-icons" aria-hidden="true">warning</span>
          Audit incomplet : {run.fragments_ok}/{run.fragments_total} fragments traités,
          soit environ {nombre(manquants)} fiches non contrôlées.
        </p>
      )}

      <p className="qualite-taux">
        {taux != null ? `${(taux * 100).toFixed(1).replace(".", ",")} % conformes` : "Taux indisponible"}
      </p>

      <ul className="qualite-gravites">
        <li>{g.bloquant ?? 0} bloquants</li>
        <li>{g.majeur ?? 0} majeurs</li>
        <li>{g.mineur ?? 0} mineurs</li>
      </ul>
    </header>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/features/qualite/RapportEntete`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/qualite/RapportEntete.tsx src/features/qualite/RapportEntete.test.tsx
git commit -m "feat(qualite): bandeau de couverture affichant les audits partiels"
```

---

### Task 14: Front — files de travail, détail d'une fiche, page

**Files:**
- Create: `src/features/qualite/FicheDetailVue.tsx`
- Create: `src/features/qualite/FicheDetailVue.test.tsx`
- Create: `src/features/qualite/QualiteApp.tsx`
- Create: `src/features/qualite/QualiteApp.test.tsx`
- Modify: le routeur de l'application (là où `RensApp` est monté) pour ajouter la route `/qualite`

**Interfaces:**
- Consumes: `fetchRapport`, `fetchFicheAudit`, `filtrerParFile`, `LIBELLE_FILE`, `RapportEntete`.
- Produces: `<QualiteApp />`, `<FicheDetailVue fiche={FicheDetail} />`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/qualite/FicheDetailVue.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FicheDetailVue } from "./FicheDetailVue";
import type { FicheDetail } from "./qualiteApi";

const fiche: FicheDetail = {
  frs_id: 12, titre: "Camping", unite: "COB X", code_ggd: "GGD 49", commune: "Segré",
  motif: "radicalisation", origine_info: null,
  date_redaction: "2026-08-04", date_evenement: null,
  texte: "Trouble à la tranquillité publique dans un camping. Les jeunes ont obtempéré.",
  ecarts: [{ critere: "A3", libelle: "Motif incohérent avec les faits", gravite: "majeur",
             source: "llm", fondement: "CSI R. 236-22, 4°",
             extrait: "Les jeunes ont obtempéré", explication: "Motif sans rapport.", confiance: "haute" }],
};

describe("FicheDetailVue", () => {
  it("montre le texte INTÉGRAL, pas seulement l'extrait", () => {
    render(<FicheDetailVue fiche={fiche} />);
    expect(screen.getByText(/Trouble à la tranquillité publique dans un camping/)).toBeTruthy();
  });

  it("surligne l'extrait incriminé à l'intérieur du texte", () => {
    const { container } = render(<FicheDetailVue fiche={fiche} />);
    const marque = container.querySelector("mark");
    expect(marque?.textContent).toBe("Les jeunes ont obtempéré");
  });

  it("met le fondement juridique en avant : c'est ce qui rend l'écart opposable", () => {
    render(<FicheDetailVue fiche={fiche} />);
    expect(screen.getByText("CSI R. 236-22, 4°")).toBeTruthy();
  });

  it("signale une confiance moyenne comme appelant une relecture", () => {
    const f = { ...fiche, ecarts: [{ ...fiche.ecarts[0], confiance: "moyenne" as const }] };
    render(<FicheDetailVue fiche={f} />);
    expect(screen.getByText(/relecture/i)).toBeTruthy();
  });

  it("un extrait absent n'empêche pas l'affichage du texte", () => {
    const f = { ...fiche, ecarts: [{ ...fiche.ecarts[0], extrait: null }] };
    const { container } = render(<FicheDetailVue fiche={f} />);
    expect(container.querySelector("mark")).toBeNull();
    expect(screen.getByText(/camping/)).toBeTruthy();
  });
});
```

```tsx
// src/features/qualite/QualiteApp.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QualiteApp } from "./QualiteApp";

afterEach(() => vi.unstubAllGlobals());

const rapport = {
  run: { jour: "2026-08-04", statut: "complet", termine_a: null, total_fiches: 100,
         fragments_total: 3, fragments_ok: 3, taille_fragment: 40 },
  synthese: { fiches_non_conformes: 2, taux_conformite: 0.98,
              par_gravite: { bloquant: 1, majeur: 1 }, par_critere: [],
              par_unite: [{ unite: "COB X", n: 2, bloquant: 1 }] },
  fiches: [
    { frs_id: 1, titre: "A", unite: "COB X", code_ggd: "GGD 49", commune: "C",
      date_redaction: "2026-08-04", n_ecarts: 1, criteres: ["A1"], gravite_max: "bloquant" },
    { frs_id: 2, titre: "B", unite: "COB X", code_ggd: "GGD 49", commune: "C",
      date_redaction: "2026-08-04", n_ecarts: 1, criteres: ["A3"], gravite_max: "majeur" },
  ],
};

const stub = (body: unknown, ok = true, status = 200) =>
  vi.stubGlobal("fetch", async () => ({ ok, status, json: async () => body }) as Response);

describe("QualiteApp", () => {
  it("affiche les fiches de la file « à supprimer » par défaut", async () => {
    stub({ data: rapport });
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());
    expect(screen.queryByText("B")).toBeNull();
  });

  it("« aucun audit » est un message explicite, jamais un écran vide", async () => {
    stub({ error: { code: "no_run", message: "Aucun audit" } }, false, 404);
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText(/aucun audit/i)).toBeTruthy());
  });

  it("une erreur technique ne ressemble pas à « tout est conforme »", async () => {
    stub({ error: { code: "db_error", message: "Erreur" } }, false, 500);
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByText(/conformes/)).toBeNull();
  });

  it("un jour sans aucune non-conformité le dit explicitement", async () => {
    stub({ data: { ...rapport, synthese: { ...rapport.synthese, fiches_non_conformes: 0, par_gravite: {} }, fiches: [] } });
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText(/aucune non-conformité/i)).toBeTruthy());
  });

  it("n'utilise aucun emoji", async () => {
    stub({ data: rapport });
    const { container } = render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());
    expect(container.textContent || "").not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/features/qualite`
Expected: FAIL — `Failed to resolve import "./FicheDetailVue"` et `"./QualiteApp"`

- [ ] **Step 3: Write `FicheDetailVue.tsx`**

```tsx
// src/features/qualite/FicheDetailVue.tsx
import type { Ecart, FicheDetail } from "./qualiteApi";

// Le texte est affiché INTÉGRALEMENT, l'extrait surligné dedans : un contrôleur juge
// en contexte. Un extrait isolé transforme un constat en accusation.
function TexteSurligne({ texte, extraits }: { texte: string; extraits: string[] }) {
  const cible = extraits.find((e) => e && texte.includes(e));
  if (!cible) return <p className="qualite-texte">{texte}</p>;
  const i = texte.indexOf(cible);
  return (
    <p className="qualite-texte">
      {texte.slice(0, i)}
      <mark>{cible}</mark>
      {texte.slice(i + cible.length)}
    </p>
  );
}

function EcartVue({ ecart }: { ecart: Ecart }) {
  return (
    <li className={`qualite-ecart qualite-ecart--${ecart.gravite}`}>
      <p className="qualite-ecart-titre">
        <span className="qualite-code">{ecart.critere}</span> {ecart.libelle}
      </p>
      {ecart.fondement && <p className="qualite-fondement">{ecart.fondement}</p>}
      {ecart.explication && <p>{ecart.explication}</p>}
      {ecart.confiance === "moyenne" && (
        <p className="qualite-confiance">
          <span className="material-icons" aria-hidden="true">help_outline</span>
          Confiance moyenne — appelle une relecture humaine.
        </p>
      )}
    </li>
  );
}

export function FicheDetailVue({ fiche }: { fiche: FicheDetail }) {
  return (
    <section className="qualite-detail">
      <p className="qualite-meta">
        {fiche.unite} · {fiche.code_ggd} · {fiche.commune} · rédigée le {fiche.date_redaction}
        {fiche.motif ? ` · motif : ${fiche.motif}` : " · motif non renseigné"}
      </p>
      <TexteSurligne texte={fiche.texte} extraits={fiche.ecarts.map((e) => e.extrait || "")} />
      <ul className="qualite-ecarts">
        {fiche.ecarts.map((e) => <EcartVue key={e.critere} ecart={e} />)}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Write `QualiteApp.tsx`**

```tsx
// src/features/qualite/QualiteApp.tsx
import { useEffect, useState } from "react";
import { fetchRapport, fetchFicheAudit, type Rapport, type FicheDetail } from "./qualiteApi";
import { filtrerParFile, LIBELLE_FILE, type File } from "./qualiteStore";
import { RapportEntete } from "./RapportEntete";
import { FicheDetailVue } from "./FicheDetailVue";

const MESSAGES: Record<string, string> = {
  no_run: "Aucun audit n'a encore été produit pour cette journée. Le contrôle nocturne n'est peut-être pas passé.",
  db_error: "Le rapport n'a pas pu être chargé (erreur base de données).",
};

export function QualiteApp() {
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [file, setFile] = useState<File>("supprimer");
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [detail, setDetail] = useState<FicheDetail | null>(null);

  useEffect(() => {
    let vivant = true;
    fetchRapport(null, "")
      .then((r) => vivant && (setRapport(r), setErreur(null)))
      .catch((e) => vivant && (setErreur(e.message), setRapport(null)));
    return () => { vivant = false; };
  }, []);

  useEffect(() => {
    if (ouverte == null || !rapport) return setDetail(null);
    let vivant = true;
    fetchFicheAudit(rapport.run.jour, ouverte).then((f) => vivant && setDetail(f)).catch(() => vivant && setDetail(null));
    return () => { vivant = false; };
  }, [ouverte, rapport]);

  // Une erreur ne doit jamais ressembler à « tout est conforme » : on n'affiche RIEN d'autre.
  if (erreur) {
    return (
      <p role="alert" className="qualite-alerte">
        <span className="material-icons" aria-hidden="true">error_outline</span>
        {MESSAGES[erreur] || "Le rapport n'a pas pu être chargé."}
      </p>
    );
  }
  if (!rapport) return <p>Chargement du rapport…</p>;

  const lignes = filtrerParFile(rapport.fiches, file);

  return (
    <main className="qualite">
      <RapportEntete rapport={rapport} />

      {rapport.synthese.fiches_non_conformes === 0 ? (
        <p className="qualite-vide">Aucune non-conformité relevée sur cette journée.</p>
      ) : (
        <>
          <nav className="qualite-files">
            {(Object.keys(LIBELLE_FILE) as File[]).map((f) => (
              <button key={f} type="button" aria-pressed={file === f} onClick={() => setFile(f)}>
                {LIBELLE_FILE[f]} ({filtrerParFile(rapport.fiches, f).length})
              </button>
            ))}
          </nav>

          {lignes.length === 0 ? (
            <p className="qualite-vide">Aucune fiche dans cette file.</p>
          ) : (
            <ul className="qualite-liste">
              {lignes.map((f) => (
                <li key={f.frs_id}>
                  <button type="button" onClick={() => setOuverte(ouverte === f.frs_id ? null : f.frs_id)}>
                    {f.titre} — {f.unite} · {f.n_ecarts} écart{f.n_ecarts > 1 ? "s" : ""} · {f.criteres.join(", ")}
                  </button>
                  {ouverte === f.frs_id && detail && <FicheDetailVue fiche={detail} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="qualite-notice">
        Diagnostic d'aide au contrôle. Ne vaut pas décision. Données et identités fictives.
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Mount the route**

Repérer d'abord où `RensApp` est monté :

```bash
grep -rn "RensApp" src --include=*.tsx | grep -v features/rens
```

Ajouter `/qualite` → `<QualiteApp />` dans ce même fichier, en suivant exactement le motif de la route RENS (même mécanisme de navigation, même libellé de menu s'il y en a un). Ne pas introduire de routeur si le projet n'en utilise pas.

- [ ] **Step 6: Run tests**

Run: `npm test -- src/features/qualite && npx tsc -b`
Expected: PASS (10 tests) et typecheck sans erreur.

- [ ] **Step 7: Commit**

```bash
git add src/features/qualite/
git add "$(grep -rln 'RensApp' src --include=*.tsx | grep -v features/rens)"
git commit -m "feat(qualite): page d'audit — files de travail et détail sourcé des écarts"
```

---

### Task 15: Front — sélecteur de jour, vue par unité, encart méthode

**Files:**
- Modify: `server/rens-api/audit/rapport.js` (bloc `methode` dans le rapport)
- Modify: `server/rens-api/audit/rapport.test.js`
- Create: `src/features/qualite/VueUnite.tsx`
- Create: `src/features/qualite/VueUnite.test.tsx`
- Create: `src/features/qualite/EncartMethode.tsx`
- Create: `src/features/qualite/EncartMethode.test.tsx`
- Modify: `src/features/qualite/qualiteApi.ts` (type `Rapport.methode`)
- Modify: `src/features/qualite/QualiteApp.tsx` (sélecteur jour + GGD, onglet unités, encart)

**Interfaces:**
- Consumes: `Rapport` de `./qualiteApi`, `buildRapportQuery` de `audit/rapport.js`.
- Produces:
  - `Rapport.methode: { taille_fragment: number, defauts_plantes: number, defauts_detectes: number }`
  - `<VueUnite unites={Rapport["synthese"]["par_unite"]} />`
  - `<EncartMethode methode={Rapport["methode"]} />`

- [ ] **Step 1: Write the failing test for the `methode` block**

```js
// à ajouter dans server/rens-api/audit/rapport.test.js
test('rapport : bloc methode — défauts plantés et défauts effectivement détectés', () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /'methode'/);
  assert.match(q.text, /'defauts_plantes'/);
  assert.match(q.text, /'defauts_detectes'/);
  assert.match(q.text, /LIKE 'defaut:%'/);
});

test("rapport : un défaut n'est « détecté » que si le critère relevé est celui qui a été planté", () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /substring\(m\.mot from 8\) = a\.critere/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rens-api/audit/rapport.test.js`
Expected: FAIL — `'methode'` absent de la requête.

- [ ] **Step 3: Add the `methode` block**

Dans `buildRapportQuery`, ajouter une clé au `json_build_object` final, après `'synthese'` :

```js
      'methode', (SELECT json_build_object(
        'taille_fragment', (SELECT taille_fragment FROM r),
        'defauts_plantes', (SELECT count(*)::int FROM frs f
                              JOIN frs_mot_cle m ON m.frs_id = f.id
                             WHERE f.date_redaction = (SELECT jour FROM r) AND m.mot LIKE 'defaut:%'),
        'defauts_detectes', (SELECT count(*)::int FROM frs f
                               JOIN frs_mot_cle m ON m.frs_id = f.id
                               JOIN frs_audit a ON a.frs_id = f.id AND a.run_id = (SELECT id FROM r)
                              WHERE m.mot LIKE 'defaut:%' AND substring(m.mot from 8) = a.critere))),
```

> `substring(m.mot from 8)` retire le préfixe `defaut:` (7 caractères). Un défaut n'est compté comme détecté que si l'agent a relevé **le bon critère** sur **la bonne fiche** — relever `D12` sur une fiche piégée en `B5` n'est pas une détection, c'est une coïncidence.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/rens-api/audit/rapport.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Write the failing front tests**

```tsx
// src/features/qualite/VueUnite.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VueUnite } from "./VueUnite";

const unites = [
  { unite: "COB Segré", n: 9, bloquant: 3 },
  { unite: "BTA Cholet", n: 12, bloquant: 0 },
];

describe("VueUnite", () => {
  it("classe les unités porteuses de bloquants en premier, même avec moins d'écarts", () => {
    render(<VueUnite unites={unites} />);
    const lignes = screen.getAllByRole("row").slice(1);
    expect(lignes[0].textContent).toContain("COB Segré");
  });

  it("affiche le volume et le nombre de bloquants par unité", () => {
    render(<VueUnite unites={unites} />);
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("liste vide : message explicite, pas de tableau fantôme", () => {
    render(<VueUnite unites={[]} />);
    expect(screen.getByText(/aucune unité/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
```

```tsx
// src/features/qualite/EncartMethode.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EncartMethode } from "./EncartMethode";

describe("EncartMethode", () => {
  it("affiche le taux de détection mesuré, pas une estimation", () => {
    render(<EncartMethode methode={{ taille_fragment: 40, defauts_plantes: 40, defauts_detectes: 34 }} />);
    expect(screen.getByText(/34\s*\/\s*40/)).toBeTruthy();
    expect(screen.getByText(/85\s?%/)).toBeTruthy();
  });

  it("annonce que C10 ne peut pas se déclencher, plutôt que de laisser croire à une conformité", () => {
    render(<EncartMethode methode={{ taille_fragment: 40, defauts_plantes: 40, defauts_detectes: 34 }} />);
    expect(screen.getByText(/C10/)).toBeTruthy();
    expect(screen.getByText(/90 jours/)).toBeTruthy();
  });

  it("sans défaut planté, ne montre pas un taux de 0 % trompeur", () => {
    render(<EncartMethode methode={{ taille_fragment: 40, defauts_plantes: 0, defauts_detectes: 0 }} />);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByText(/aucun défaut planté/i)).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- src/features/qualite/VueUnite src/features/qualite/EncartMethode`
Expected: FAIL — modules introuvables.

- [ ] **Step 7: Write the components**

```tsx
// src/features/qualite/VueUnite.tsx
import type { Rapport } from "./qualiteApi";

// Ce que la liste de fiches ne dit pas : QUI produit les écarts. C'est l'information
// qui déclenche une action de formation plutôt qu'un travail de correction.
export function VueUnite({ unites }: { unites: Rapport["synthese"]["par_unite"] }) {
  if (unites.length === 0) return <p className="qualite-vide">Aucune unité concernée sur cette journée.</p>;
  const triees = [...unites].sort((a, b) => b.bloquant - a.bloquant || b.n - a.n);
  return (
    <table className="qualite-unites">
      <thead>
        <tr><th scope="col">Unité</th><th scope="col">Fiches en écart</th><th scope="col">Dont bloquants</th></tr>
      </thead>
      <tbody>
        {triees.map((u) => (
          <tr key={u.unite}><td>{u.unite}</td><td>{u.n}</td><td>{u.bloquant}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
```

```tsx
// src/features/qualite/EncartMethode.tsx
import type { Rapport } from "./qualiteApi";

export function EncartMethode({ methode }: { methode: Rapport["methode"] }) {
  const { taille_fragment, defauts_plantes, defauts_detectes } = methode;
  const taux = defauts_plantes > 0 ? Math.round((defauts_detectes / defauts_plantes) * 100) : null;
  return (
    <details className="qualite-methode">
      <summary>Méthode et limites</summary>
      <p>Fiches examinées par lot de {taille_fragment} par agent.</p>
      {taux != null ? (
        <p>
          Taux de détection mesuré sur les défauts plantés : {defauts_detectes} / {defauts_plantes} ({taux} %).
        </p>
      ) : (
        <p>Aucun défaut planté sur cette journée : le taux de détection n'est pas mesurable.</p>
      )}
      <p>
        Le critère C10 (conservation au-delà d'un an) ne peut pas se déclencher : la base applique une
        purge glissante à 90 jours. Son absence d'écart ne vaut pas conformité vérifiée.
      </p>
    </details>
  );
}
```

- [ ] **Step 8: Extend the `Rapport` type**

Dans `src/features/qualite/qualiteApi.ts`, ajouter au type `Rapport`, après `synthese` :

```ts
  methode: { taille_fragment: number; defauts_plantes: number; defauts_detectes: number };
```

- [ ] **Step 9: Wire the selector and the tabs into `QualiteApp.tsx`**

Ajouter deux états et brancher le chargement dessus :

```tsx
  const [jour, setJour] = useState<string | null>(null);
  const [ggd, setGgd] = useState("");
  const [vue, setVue] = useState<"fiches" | "unites">("fiches");
```

Remplacer les dépendances de l'effet de chargement par `[jour, ggd]` et l'appel par `fetchRapport(jour, ggd)`. Ajouter au-dessus des files :

```tsx
      <form className="qualite-selecteur" onSubmit={(e) => e.preventDefault()}>
        <label>
          Journée
          <input type="date" value={jour ?? rapport.run.jour} onChange={(e) => setJour(e.target.value)} />
        </label>
        <label>
          Groupement
          <input type="text" placeholder="Tous les GGD" value={ggd} onChange={(e) => setGgd(e.target.value)} />
        </label>
      </form>

      <nav className="qualite-vues">
        <button type="button" aria-pressed={vue === "fiches"} onClick={() => setVue("fiches")}>Fiches à traiter</button>
        <button type="button" aria-pressed={vue === "unites"} onClick={() => setVue("unites")}>Par unité</button>
      </nav>
```

Encadrer le bloc des files et de la liste par `{vue === "fiches" && (…)}`, ajouter `{vue === "unites" && <VueUnite unites={rapport.synthese.par_unite} />}`, et poser `<EncartMethode methode={rapport.methode} />` juste avant la notice. Importer les deux composants en tête.

> `<input type="date">` natif plutôt qu'un sélecteur de dates : le navigateur le localise, le rend accessible au clavier et le valide. Aucune dépendance à ajouter.

- [ ] **Step 10: Add a test for the selector in `QualiteApp.test.tsx`**

```tsx
  it("changer de journée recharge le rapport pour ce jour", async () => {
    const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: rapport }) }) as Response);
    vi.stubGlobal("fetch", spy);
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Journée/), { target: { value: "2026-07-30" } });
    await waitFor(() => expect(spy.mock.calls.some((c) => String(c[0]).includes("jour=2026-07-30"))).toBe(true));
  });
```

Ajouter `fireEvent` à l'import de `@testing-library/react`, et `methode: { taille_fragment: 40, defauts_plantes: 0, defauts_detectes: 0 }` à l'objet `rapport` du fichier de test.

- [ ] **Step 11: Run everything**

Run: `node --test server/rens-api/ && npm test -- src/features/qualite && npx tsc -b`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add server/rens-api/audit/rapport.js server/rens-api/audit/rapport.test.js src/features/qualite/
git commit -m "feat(qualite): sélecteur de journée, vue par unité et encart méthode mesuré"
```

---

### Task 16: Runbook du workflow IAka et câblage du cron

**Files:**
- Create: `docs/iaka-qualite-workflow.md`
- Modify: `.env.example`
- Modify: `README.md` (section commandes)

**Interfaces:**
- Consumes: le contrat d'entrée/sortie des Tasks 4 et 5.
- Produces: la documentation nécessaire pour construire le workflow dans le builder IAka et lancer le cron.

- [ ] **Step 1: Write the runbook**

Créer `docs/iaka-qualite-workflow.md`, sur le modèle de `docs/iaka-rens-workflows.md`. Il doit contenir :

1. **La topologie** : `DÉBUT (fragment JSON) → 3 sous-agents en parallèle → nœud de jointure → FIN`.
2. **Les trois corpus RAG à créer**, avec leur contenu :
   - `gipasp-legalite` : texte des articles R. 236-21 et R. 236-22 CSI + le référentiel des 10 motifs de `audit/criteres.js`.
   - `gipasp-donnees` : texte de l'article R. 236-23 CSI + les délibérations CNIL n° 2010-456 et n° 2020-065.
   - `gipasp-redaction` : extraits du rapport public du référent national (défauts constatés, § motif d'enregistrement et date d'événement) + articles R. 236-25 et R. 236-30.
3. **Le prompt de chaque sous-agent**, construit sur ce gabarit — n'y changer que la famille, les codes et le corpus :

```
Tu contrôles la conformité de fiches de renseignement simplifiées (FRS) au décret GIPASP.

Tu reçois un objet JSON { "fragment": n, "fiches": [ { id, date_redaction, date_evenement,
titre, motif, origine_info, unite, code_ggd, commune, texte, porte_pii } ] }.

Tu examines CHAQUE fiche, une par une, sans exception. Tu ne contrôles QUE ces critères :
- A1 : la fiche porte des données personnelles sans que les faits établissent une atteinte,
  potentielle ou avérée, à la sécurité publique.
- A3 : le motif déclaré ne correspond pas aux faits narrés, ou le seuil d'atteinte n'est pas atteint.
- A4 : une personne est citée sans être la personne à risque, une relation directe et non
  fortuite, ou une victime.

RÈGLE ABSOLUE : tu ne signales un écart que si tu peux citer l'article du Code de la sécurité
intérieure qui le fonde, dans le champ "fondement". Sans article citable, pas de signalement.
Tu ne juges pas le style : tu appliques le décret.

Ta réponse est EXCLUSIVEMENT un tableau JSON, commençant par « [ » et finissant par « ] ».
Aucun texte avant, aucun texte après, aucune balise markdown, aucun raisonnement.
Un fragment sain rend [] — c'est un résultat valide.

Chaque entrée : { "frs_id": <l'id EXACT de la fiche>, "critere": "<A1|A3|A4>",
"fondement": "<article, ex. CSI R. 236-22, 4°>", "extrait": "<passage EXACT et VERBATIM du
champ texte>", "explication": "<une phrase>", "confiance": "haute" | "moyenne" }

N'invente jamais un frs_id : il doit figurer dans le fragment reçu. Utilise "moyenne" dès que
l'appréciation est discutable.
```

   - Sous-agent DONNÉES : critères `B5`, `B6`, `B7`, corpus `gipasp-donnees`.
   - Sous-agent RÉDACTION : critères `C9`, `D11`, `D12`, corpus `gipasp-redaction`.
4. **Le prompt du nœud de jointure** :

```
Tu reçois les sorties de trois sous-agents, chacune étant un tableau JSON d'écarts.
Tu produis UN SEUL tableau JSON qui est la CONCATÉNATION des trois, dans l'ordre reçu.
Tu ne modifies aucune entrée, tu n'en supprimes aucune, tu n'en ajoutes aucune.
Ta réponse commence par « [ » et finit par « ] ». Aucun autre texte.
Si les trois tableaux sont vides, réponds [].
```

5. **La note sur `gravite`** : les agents ne la produisent pas, elle est dérivée du code côté serveur.
6. **La procédure de calibration** de `AUDIT_TAILLE_FRAGMENT` : lancer `AUDIT_DRY=1` à 20, 40 et 60, comparer le nombre d'écarts portant un `defaut:` retrouvé, retenir la plus grande valeur avant décrochage.

- [ ] **Step 2: Extend `.env.example`**

```bash
# Contrôle qualité GIPASP (job d'audit nocturne, exécuté dans le conteneur rens-api)
IAKA_QUALITE_APP_ID=
AUDIT_TAILLE_FRAGMENT=40
AUDIT_CONCURRENCE=6
AUDIT_DEFAUTS=40
```

- [ ] **Step 3: Document the cron**

Ajouter au `README.md`, sous les commandes :

```bash
# Audit qualité de la veille (à enchaîner après le cron d'alimentation, 3 h UTC)
docker compose exec -T rens-api node audit/nightly.mjs

# Rejouer un jour précis, sans rien écrire
AUDIT_JOUR=2026-08-04 AUDIT_DRY=1 docker compose exec -T rens-api node audit/nightly.mjs
```

Le conteneur `rens-api` doit recevoir `IAKA_BASE_URL`, `IAKA_JWT`, `IAKA_TENANT_ID` et `IAKA_QUALITE_APP_ID` dans son environnement compose — il ne les avait pas jusqu'ici.

- [ ] **Step 4: Run the full suite**

Run: `node --test server/ && node --test server/rens-api/ && npm test && npx tsc -b`
Expected: PASS partout.

- [ ] **Step 5: Commit**

```bash
git add docs/iaka-qualite-workflow.md .env.example README.md
git commit -m "docs(qualite): runbook du workflow IAka, corpus normatifs et cron d'audit"
```

---

## Ordre d'exécution et dépendances

```
T1 (migration) ─┬─► T2 (critères) ─┬─► T3 (structurel) ──┐
                │                  ├─► T5 (parse) ───────┤
                │                  └─► T7 (store) ───────┼─► T8 (orchestrateur)
                ├─► T4 (fragments) ──────────────────────┤
                └─► T6 (client IAka) ────────────────────┘
T2 ─► T9 (rapport + routes) ─► T10 (BFF) ─► T12 (client front) ─► T13 (en-tête) ─► T14 (page) ─► T15 (sélecteur, unités, méthode)
T1 ─► T11 (défauts plantés)
T4, T5 ─► T16 (runbook)
```

T11 et T16 peuvent être menées en parallèle du front. **T16 conditionne la recette** : sans les trois corpus construits dans le builder IAka, aucun agent ne peut rendre de `fondement`, et tous les écarts LLM seront rejetés par T5. **T11 conditionne T15** : sans défauts plantés, l'encart méthode n'a rien à mesurer.

## Recette finale (après T16)

- [ ] Appliquer `006_audit.sql` sur la base `rens` d'OVH.
- [ ] Construire le workflow dans le builder IAka, poser `IAKA_QUALITE_APP_ID`.
- [ ] Lancer une nuit d'alimentation avec défauts plantés, puis `AUDIT_DRY=1` pour vérifier le décompte sans persister.
- [ ] Calibrer `AUDIT_TAILLE_FRAGMENT` (20 / 40 / 60) sur le taux de détection.
- [ ] Vérifier le seuil d'acceptation : **détection ≥ 70 %** des défauts plantés, **zéro faux positif « bloquant »** sur un lot réputé sain.
- [ ] Vérifier qu'aucun `defaut:` n'apparaît dans les logs d'exécution IAka.
