# Rédaction d'une FRS avec contrôle *a priori* — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de rédiger une FRS dans l'application, de la soumettre à la même grille GIPASP que l'audit nocturne avant tout enregistrement, puis de la corriger ou de l'enregistrer malgré les remarques.

**Architecture:** Le brouillon vit dans le front ; le BFF analyse un **texte volant** (nouvelle route `POST /api/rens/audit/analyse-texte`) en réutilisant sans modification le workflow IAka, `parseSortieAgents` et `construireRapportAnalyse` ; l'enregistrement passe par une route `POST /frs` de rens-api adossée à un **second pool Postgres** au rôle `rens_redaction`, qui ne sait qu'insérer. Au passage, la détection `porte_pii` quitte le SQL pour le JS afin d'avoir une définition unique, utilisable sur un texte qui n'est pas en base.

**Tech Stack:** Node natif (BFF `server/proxy.mjs`, microservice `server/rens-api/server.js`, `pg`), React 19 + TypeScript + Vite, Cunningham, tests `node --test` (serveur) et Vitest + Testing Library (front), Postgres.

## Global Constraints

- **Spec de référence :** `docs/superpowers/specs/2026-08-07-redaction-frs-controle-a-priori-design.md`.
- **Une seule grille :** l'analyse du texte saisi utilise le workflow qualité existant (`IAKA_QUALITE_APP_ID`), ses trois agents, `parseSortieAgents` et `construireRapportAnalyse` **sans les modifier**.
- **Aucun emoji dans le front** (règle projet). Icônes Material via `<Icone nom="…" />` de `src/features/qualite/ui.tsx`.
- **Le contrôle ne bloque jamais** : aucun verdict, aucune panne d'analyse n'empêche l'enregistrement.
- **Le texte saisi ne disparaît sous aucun scénario d'erreur.**
- **Bornes serveur :** `titre` 1–200 caractères, `texte` 1–8000, `mots_cles` 0–10 de 40 caractères au plus, mot-clé commençant par `defaut:` rejeté, `date_redaction` imposée par le serveur (`CURRENT_DATE`).
- **Droits Postgres :** `rens_api` et `rens_ro` restent en lecture seule (doctrine posée par `007_audit_grants.sql`). Toute écriture de cette feature passe par le nouveau rôle `rens_redaction`.
- **Commits :** français, `type(scope): sujet`, corps expliquant le *pourquoi*. Terminer par `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Tests serveur** : `cd server/rens-api && node --test 'audit/*.test.mjs' 'audit/*.test.js' 'migrations/*.test.mjs' '*.test.js'` et, à la racine, `node --test 'server/*.test.mjs'`. **Tests front** : `npm test`.

---

## Structure des fichiers

**Créés**

| Fichier | Responsabilité |
|---|---|
| `server/rens-api/audit/regles.test.mjs` | Tests de `regles.mjs`, à commencer par `portePii` |
| `server/rens-api/redaction.js` | Validation **pure** d'une FRS soumise + requête d'insertion (CJS, aucun accès réseau) |
| `server/rens-api/redaction.test.js` | Tests de la validation, champ par champ |
| `server/rens-api/migrations/009_redaction.sql` | Rôle `rens_redaction` et ses droits |
| `server/rens-api/migrations/009_redaction.test.mjs` | Vérifie les droits **présents et absents** |
| `src/features/qualite/FicheRapport.tsx` | Rendu du verdict d'UNE fiche (extrait de `AnalyseDemande.tsx`) |
| `src/features/qualite/redactionApi.ts` | Appels front : analyser un texte, enregistrer une fiche, lire le référentiel |
| `src/features/qualite/redactionApi.test.ts` | Tests de ces appels |
| `src/features/qualite/RedactionFrs.tsx` | L'écran de rédaction (formulaire, deux colonnes, états) |
| `src/features/qualite/RedactionFrs.test.tsx` | Tests du cycle analyser → corriger → réanalyser → enregistrer |

**Modifiés**

| Fichier | Changement |
|---|---|
| `server/rens-api/audit/regles.mjs` | Ajout de `portePii(texte)` |
| `server/rens-api/audit/rapport.js` | Retrait de `PORTE_PII_SQL` et de la colonne `porte_pii` ; ajout de `buildReferentielQuery` |
| `server/rens-api/audit/rapport.test.js` | Retrait du test de traduction POSIX → JS ; test du référentiel |
| `server/rens-api/audit/nightly.mjs` | Retrait du SQL `porte_pii`, calcul en JS après chargement |
| `server/rens-api/server.js` | Second pool, routes `GET /referentiel` et `POST /frs`, lecture du corps de requête |
| `server/proxy.mjs` | Routes `/api/rens/referentiel`, `/api/rens/frs`, `/api/rens/audit/analyse-texte` |
| `server/proxy.analyse.test.mjs` | Tests de la route d'analyse d'un texte volant |
| `src/features/qualite/AnalyseDemande.tsx` | Importe `FicheRapport` au lieu de le définir |
| `src/features/qualite/QualiteApp.tsx` | Quatrième onglet « Rédiger » |
| `src/features/qualite/QualiteApp.test.tsx` | Test de l'onglet |
| `.env.example`, `server/rens-api/README` ou compose | Variables `PGUSER_REDACTION` / `PGPASSWORD_REDACTION` |

**Ordre imposé :** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. La tâche 7 (extraction de `FicheRapport`) précède la 8 (l'écran s'en sert). La tâche 1 précède la 5 (l'analyse d'un texte volant a besoin de `portePii`).

---

### Task 1: `portePii` quitte le SQL pour le JS

Un texte volant n'a pas de ligne en base : la détection doit être appelable sur une chaîne. Les deux requêtes ramènent **déjà `f.texte`**, donc le calcul SQL est superflu — et une règle qui vit à deux endroits finit par dire deux choses.

**Files:**
- Modify: `server/rens-api/audit/regles.mjs`
- Modify: `server/rens-api/audit/rapport.js:99-121` (bloc `PORTE_PII_SQL` + `buildLotQuery`)
- Modify: `server/rens-api/audit/nightly.mjs:17-32` (import et `SELECT_JOUR`), `:40-57` (`traiterFragment`)
- Modify: `server/rens-api/audit/rapport.test.js` (retirer le test de traduction POSIX)
- Create: `server/rens-api/audit/regles.test.mjs`

**Interfaces:**
- Produces: `portePii(texte: string): boolean` — exporté par `regles.mjs`. Vrai si le texte porte une donnée à caractère personnel détectable mécaniquement.
- Consumes: rien.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `server/rens-api/audit/regles.test.mjs` :

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { portePii } from './regles.mjs';

test('portePii : un nom de personne est reconnu, un sigle de service ne l\'est pas', () => {
  // La détection décide du périmètre du décret : une fiche sans DCP perd tous ses griefs.
  // Trop large, elle rendait cette sortie inatteignable — « [A-Z]{3,} » s'allumait sur GGD.
  for (const texte of [
    'Contrôle de M. Karim BENNANI le 3 août.',
    'Karim BENNANI a été aperçu sur les lieux.',
    'Véhicule immatriculé AB-123-CD.',
    'Individu né(e) le 01/01/1990.',
    'Compte suivi sur https://t.me/canal49.',
  ]) assert.strictEqual(portePii(texte), true, `donnée personnelle manquée : « ${texte} »`);

  for (const texte of [
    'Patrouille GGD 49 sur la RN 162, secteur ZAC des Landes.',
    'Des dégradations ont été constatées sur du mobilier urbain du centre-bourg.',
    "Rassemblement d'une vingtaine de personnes non identifiées, aucune infraction relevée.",
  ]) assert.strictEqual(portePii(texte), false, `faux positif sur « ${texte} »`);
});

test('portePii : une entrée absente ou non textuelle ne fait pas planter le contrôle', () => {
  // Appelée sur un texte volant venu du réseau : une valeur manquante doit répondre
  // « je n'ai rien détecté », jamais jeter — le verdict des agents reste, lui, souverain.
  for (const entree of [null, undefined, 42, {}]) assert.strictEqual(portePii(entree), false);
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

```bash
cd server/rens-api && node --test 'audit/regles.test.mjs'
```

Attendu : ÉCHEC — `portePii is not a function` (l'export n'existe pas).

- [ ] **Step 3: Écrire `portePii` dans `regles.mjs`**

Ajouter avant `consensusDcp` :

```js
// Détection de donnée personnelle faite sur le TEXTE. Elle vivait en SQL, calculée par les
// deux requêtes de chargement ; un texte saisi et non encore enregistré n'a pas de ligne à
// interroger. Comme les deux requêtes ramènent déjà `f.texte`, le calcul SQL était superflu :
// la règle vit ici, en un seul endroit, et sert les trois chemins (batch, analyse d'une
// sélection, analyse d'un texte volant).
//
// Un nom de famille se reconnaît à son contexte — une civilité, ou un prénom capitalisé qui
// le précède — et à sa forme : au moins deux voyelles, ce qu'un sigle de service (GGD, SNCF,
// CRS, RN) n'a pas.
const PII = [
  /(M\.|Mme|Mlle|nommé)\s/,
  /[A-ZÀÂÇÉÈÊËÎÏÔÙÛ][a-zàâçéèêëîïôùû]+\s+[A-ZÀÂÇÉÈÊËÎÏÔÙÛ]*[AEIOUYÀÂÉÈÊËÎÏÔÙÛ][A-ZÀÂÇÉÈÊËÎÏÔÙÛ]*[AEIOUYÀÂÉÈÊËÎÏÔÙÛ][A-ZÀÂÇÉÈÊËÎÏÔÙÛ]*/,
  /[A-Z]{2}-[0-9]{3}-[A-Z]{2}/,
  /t\.me\/|x\.com\/|facebook|instagram|tiktok|discord/i,
  /né\(e\) le/,
];

export function portePii(texte) {
  if (typeof texte !== 'string') return false;
  return PII.some((r) => r.test(texte));
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

```bash
cd server/rens-api && node --test 'audit/regles.test.mjs'
```

Attendu : SUCCÈS, 2 tests.

- [ ] **Step 5: Retirer le SQL de `rapport.js`**

Dans `server/rens-api/audit/rapport.js` : supprimer le bloc de commentaire `// Détection de donnée personnelle faite sur le texte, en SQL…`, les constantes `MAJ`, `MIN`, `VOY`, `PORTE_PII_SQL`, et retirer `PORTE_PII_SQL` de `module.exports`. Dans `buildLotQuery`, remplacer la ligne `${PORTE_PII_SQL}` par la simple fin de liste de colonnes :

```js
function buildLotQuery(ids) {
  const text = `
    SELECT f.id, to_char(f.date_redaction, 'YYYY-MM-DD') AS date_redaction,
           f.titre, f.unite, f.code_ggd, f.commune, f.texte
      FROM frs f
     WHERE f.id = ANY($1::int[])
     ORDER BY f.id`;
  return { text, values: [ids] };
}
```

- [ ] **Step 6: Retirer le test devenu sans objet**

Dans `server/rens-api/audit/rapport.test.js`, supprimer le helper `portePii` (qui traduisait les motifs POSIX en JS) et le test `détection PII : un nom de personne est reconnu, un sigle de service ne l'est pas` — ils sont remplacés par `regles.test.mjs`. Supprimer aussi l'assertion `assert.match(q.text, /porte_pii/);` du test `lot : les fiches sélectionnées sont chargées par identifiants, paramétrées`.

- [ ] **Step 7: Faire calculer `porte_pii` au batch nocturne**

Dans `server/rens-api/audit/nightly.mjs` :

```js
import { filtrerEcarts, portePii } from './regles.mjs';
```

Supprimer les deux lignes `const { PORTE_PII_SQL } = require_('./rapport.js');` et son commentaire, puis ramener `SELECT_JOUR` à ses colonnes :

```js
const SELECT_JOUR = `
  SELECT f.id, to_char(f.date_redaction, 'YYYY-MM-DD') AS date_redaction,
         f.titre, f.unite, f.code_ggd, f.commune, f.texte
    FROM frs f
   WHERE f.date_redaction = $1::date
   ORDER BY f.id`;
```

Puis, dans `traiterFragment`, calculer le booléen sur le lot avant toute utilisation. Remplacer la première ligne du corps :

```js
async function traiterFragment({ avecClient, runId, rang, lot: lotBrut, cfg, execWorkflow }) {
  // La détection vit en JS (regles.mjs) et non plus en SQL : le texte est déjà chargé, et
  // l'analyse d'un texte non enregistré doit passer par la MÊME règle.
  const lot = lotBrut.map((f) => ({ ...f, porte_pii: portePii(f.texte) }));
  const ids = lot.map((f) => f.id);
```

- [ ] **Step 8: Lancer toute la suite serveur**

```bash
cd server/rens-api && node --test 'audit/*.test.mjs' 'audit/*.test.js'
cd ../.. && node --test 'server/*.test.mjs'
```

Attendu : SUCCÈS des deux suites. Si un test de `nightly.test.mjs` fournit des fiches sans `texte`, `portePii` renvoie `false` (couvert au Step 1) et le comportement est inchangé.

- [ ] **Step 9: Commit**

```bash
git add server/rens-api/audit
git commit -m "$(cat <<'EOF'
refactor(qualite): la détection de donnée personnelle quitte le SQL

Le contrôle a priori doit analyser un texte qui n'est pas encore en base : il
n'y a pas de ligne à interroger. Réimplémenter la détection en JS pour ce seul
chemin aurait donné deux définitions de « porte une donnée personnelle » — la
faute corrigée deux fois cette semaine.

Les deux requêtes ramenaient déjà `f.texte` : le calcul SQL était superflu.
`portePii(texte)` vit désormais dans regles.mjs, à côté des règles du décret
qu'elle sert, et les trois chemins l'appellent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Référentiel des valeurs de rattachement

Le formulaire doit proposer des unités, GGD, départements et communes qui existent, et la validation serveur doit refuser le reste. Une seule source pour les deux.

**Files:**
- Modify: `server/rens-api/audit/rapport.js` (ajout de `buildReferentielQuery`)
- Modify: `server/rens-api/audit/rapport.test.js`
- Modify: `server/rens-api/server.js` (route `GET /referentiel`)
- Modify: `server/proxy.mjs` (proxy `/api/rens/referentiel`)

**Interfaces:**
- Produces: `buildReferentielQuery(): { text: string, values: [] }` (CJS, `audit/rapport.js`). La requête rend une ligne par combinaison distincte : `{ unite, code_ggd, departement, commune }`.
- Produces: `GET /referentiel` (rens-api) → `{ data: [{ unite, code_ggd, departement, commune }] }`, et son proxy BFF `GET /api/rens/referentiel`.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `server/rens-api/audit/rapport.test.js`, ajouter :

```js
test('référentiel : les combinaisons de rattachement existantes, sans doublon', () => {
  // Le formulaire de rédaction propose ces valeurs, et la validation serveur refuse tout
  // ce qui n'y figure pas : une seule source, sinon on peut saisir une unité inexistante.
  const { buildReferentielQuery } = require('./rapport');
  const q = buildReferentielQuery();
  assert.match(q.text, /SELECT DISTINCT/);
  for (const col of ['unite', 'code_ggd', 'departement', 'commune']) {
    assert.match(q.text, new RegExp(`f\\.${col}`), `colonne ${col} absente`);
  }
  assert.match(q.text, /ORDER BY/);
  assert.deepStrictEqual(q.values, []);
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

```bash
cd server/rens-api && node --test 'audit/rapport.test.js'
```

Attendu : ÉCHEC — `buildReferentielQuery is not a function`.

- [ ] **Step 3: Écrire la requête**

Dans `server/rens-api/audit/rapport.js`, avant `module.exports` :

```js
// Valeurs de rattachement réellement présentes en base. Sert DEUX consommateurs : les listes
// du formulaire de rédaction, et la validation serveur qui refuse une combinaison absente.
// Une seule requête pour les deux, sinon le formulaire propose ce que la validation rejette.
function buildReferentielQuery() {
  const text = `
    SELECT DISTINCT f.unite, f.code_ggd, f.departement, f.commune
      FROM frs f
     WHERE f.commune IS NOT NULL
     ORDER BY f.code_ggd, f.unite, f.commune`;
  return { text, values: [] };
}
```

Et l'ajouter à `module.exports`.

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

```bash
cd server/rens-api && node --test 'audit/rapport.test.js'
```

Attendu : SUCCÈS.

- [ ] **Step 5: Exposer la route dans rens-api**

Dans `server/rens-api/server.js` : ajouter `buildReferentielQuery` à l'import depuis `./audit/rapport`, puis la route, juste avant `/audit/rapport` :

```js
  // Référentiel de rattachement : alimente les listes du formulaire de rédaction ET la
  // validation de POST /frs. Lecture seule, donc pool de lecture.
  if (u.pathname === '/referentiel' && req.method === 'GET') {
    try {
      const q = buildReferentielQuery();
      const r = await pool.query(q.text, q.values);
      return json(res, 200, { data: r.rows });
    } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
  }
```

- [ ] **Step 6: Proxifier depuis le BFF**

Dans `server/proxy.mjs`, à côté des autres `forwardRens` (vers la ligne 169) :

```js
    if (url.pathname === "/api/rens/referentiel" && req.method === "GET") {
      return forwardRens(req, res, cfg, fetchImpl, "/referentiel", "");
    }
```

- [ ] **Step 7: Lancer les suites**

```bash
cd server/rens-api && node --test 'audit/*.test.mjs' 'audit/*.test.js'
cd ../.. && node --test 'server/*.test.mjs'
```

Attendu : SUCCÈS.

- [ ] **Step 8: Commit**

```bash
git add server/rens-api server/proxy.mjs
git commit -m "$(cat <<'EOF'
feat(qualite): référentiel des valeurs de rattachement

Le formulaire de rédaction doit proposer des unités, GGD et communes qui
existent, et la validation serveur doit refuser le reste. Deux listes séparées
finiraient par diverger : le formulaire proposerait ce que la validation
rejette. Une seule requête sert les deux.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migration `009` — le rôle qui ne sait qu'insérer

**Files:**
- Create: `server/rens-api/migrations/009_redaction.sql`
- Create: `server/rens-api/migrations/009_redaction.test.mjs`

**Interfaces:**
- Produces: rôle Postgres `rens_redaction` (LOGIN), `INSERT` sur `frs` et `frs_mot_cle`, `USAGE, SELECT` sur `frs_id_seq` et `frs_mot_cle_id_seq`. Aucun `SELECT`, `UPDATE` ni `DELETE` sur les tables.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `server/rens-api/migrations/009_redaction.test.mjs` :

```js
// server/rens-api/migrations/009_redaction.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./009_redaction.sql', import.meta.url), 'utf8');

test('009 : le rôle de rédaction peut insérer une fiche et ses mots-clés', () => {
  assert.match(sql, /CREATE ROLE rens_redaction LOGIN/);
  assert.match(sql, /GRANT INSERT ON frs, frs_mot_cle TO rens_redaction/);
});

test('009 : les séquences serial sont ouvertes, sinon l\'INSERT échoue', () => {
  // Un INSERT sur une colonne serial consomme nextval : le GRANT sur la table ne suffit pas.
  for (const s of ['frs_id_seq', 'frs_mot_cle_id_seq']) {
    assert.match(sql, new RegExp(`USAGE, SELECT ON SEQUENCE[^;]*${s}`, 's'), `${s} manquante`);
  }
});

test('009 : le rôle de rédaction ne peut ni lire, ni modifier, ni supprimer', () => {
  // C'est tout l'intérêt d'un rôle séparé : compromis, il ajoute des lignes — il ne peut
  // pas réécrire une fiche existante, ni en exfiltrer une.
  assert.doesNotMatch(sql, /GRANT[^;]*\bSELECT\b[^;]*ON (frs|frs_mot_cle)[^;]*TO rens_redaction/s);
  assert.doesNotMatch(sql, /GRANT[^;]*\b(UPDATE|DELETE)\b[^;]*TO rens_redaction/s);
});

test('009 : les rôles de lecture ne gagnent aucun droit d\'écriture', () => {
  assert.doesNotMatch(sql, /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO rens_api/s);
  assert.doesNotMatch(sql, /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO rens_ro/s);
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

```bash
cd server/rens-api && node --test 'migrations/009_redaction.test.mjs'
```

Attendu : ÉCHEC — `ENOENT`, le fichier SQL n'existe pas.

- [ ] **Step 3: Écrire la migration**

Créer `server/rens-api/migrations/009_redaction.sql` :

```sql
-- server/rens-api/migrations/009_redaction.sql
-- Rédaction d'une FRS depuis l'application : la seule écriture de la feature.
--
-- 007 pose la doctrine : « rens_api et rens_ro restent en LECTURE SEULE, toute écriture passe
-- par un rôle dédié, table par table. » On la suit plutôt que d'ouvrir l'INSERT au rôle qui
-- sert toutes les lectures publiques : ce rôle-là voyage dans une API joignable depuis
-- Internet, et le moindre privilège est ce qui limite les dégâts d'un jeton qui fuite.
--
-- Le mot de passe est posé au déploiement (ALTER ROLE ... PASSWORD), jamais commité.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rens_redaction') THEN
    CREATE ROLE rens_redaction LOGIN;
  END IF;
END$$;

GRANT CONNECT ON DATABASE rens TO rens_redaction;
GRANT USAGE ON SCHEMA public TO rens_redaction;

-- INSERT et rien d'autre : ce rôle ajoute des fiches, il ne peut ni en lire, ni en réécrire,
-- ni en supprimer. La lecture nécessaire à la validation se fait avec le pool rens_api.
GRANT INSERT ON frs, frs_mot_cle TO rens_redaction;

-- nextval sur les colonnes serial : sans USAGE sur la séquence, le GRANT sur la table ne
-- suffit pas et l'INSERT échoue en « permission denied for sequence ».
GRANT USAGE, SELECT ON SEQUENCE frs_id_seq, frs_mot_cle_id_seq TO rens_redaction;

COMMIT;
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

```bash
cd server/rens-api && node --test 'migrations/*.test.mjs'
```

Attendu : SUCCÈS, migrations 006/007/008/009.

- [ ] **Step 5: Documenter les variables d'environnement**

Ajouter à `.env.example` (à la section rens-api), avec le commentaire :

```
# Rédaction d'une FRS depuis l'app : rôle Postgres dédié, INSERT seul (migration 009).
# Distinct de PGUSER/PGPASSWORD, qui restent en lecture seule.
PGUSER_REDACTION=rens_redaction
PGPASSWORD_REDACTION=
```

- [ ] **Step 6: Commit**

```bash
git add server/rens-api/migrations .env.example
git commit -m "$(cat <<'EOF'
feat(qualite): rôle Postgres qui ne sait qu'insérer une FRS

007 pose la doctrine : rens_api et rens_ro restent en lecture seule. La
rédaction depuis l'app est la première écriture demandée à l'API — elle passe
donc par rens_redaction, qui a l'INSERT sur frs et frs_mot_cle, l'USAGE sur
leurs séquences, et rien d'autre. Ni SELECT, ni UPDATE, ni DELETE : compromis,
ce rôle ajoute des lignes, il ne peut pas réécrire une fiche ni en exfiltrer.

Le test vérifie les droits ABSENTS autant que les présents — c'est le seul
moyen qu'un GRANT ajouté plus tard par confort ne passe pas inaperçu.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Validation et insertion d'une FRS (rens-api)

**Files:**
- Create: `server/rens-api/redaction.js`
- Create: `server/rens-api/redaction.test.js`
- Modify: `server/rens-api/server.js`

**Interfaces:**
- Consumes: `buildReferentielQuery()` (Task 2).
- Produces (CJS, `redaction.js`) :
  - `MAX = { titre: 200, texte: 8000, motsCles: 10, motCle: 40 }`
  - `validerFrs(corps, referentiel): { ok: true, valeur } | { ok: false, code, message }` — `referentiel` est le tableau de lignes `{ unite, code_ggd, departement, commune }`. `valeur` porte `{ titre, unite, code_ggd, departement, commune, texte, mots_cles }` (nettoyés), **sans date** : le serveur l'impose.
  - `buildInsertFrsQuery(valeur): { text, values }` — insère la fiche avec `CURRENT_DATE` et rend `id`.
  - `buildInsertMotsClesQuery(frsId, mots): { text, values } | null`
- Produces: `POST /frs` (rens-api) → `201 { data: { id } }`.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `server/rens-api/redaction.test.js` :

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { validerFrs, buildInsertFrsQuery, buildInsertMotsClesQuery, MAX } = require('./redaction');

const REF = [{ unite: 'COB Segré', code_ggd: 'GGD 49', departement: 'Maine-et-Loire', commune: 'Segré' }];
const bon = (extra = {}) => ({
  titre: 'Rassemblement', unite: 'COB Segré', code_ggd: 'GGD 49',
  departement: 'Maine-et-Loire', commune: 'Segré', texte: 'Des faits constatés.',
  mots_cles: ['rassemblement'], ...extra,
});

test('une fiche complète et rattachée à des valeurs connues est acceptée', () => {
  const r = validerFrs(bon(), REF);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.valeur.titre, 'Rassemblement');
  assert.deepStrictEqual(r.valeur.mots_cles, ['rassemblement']);
});

test('un champ obligatoire absent est refusé en nommant le champ', () => {
  for (const champ of ['titre', 'unite', 'code_ggd', 'departement', 'commune', 'texte']) {
    const corps = bon(); delete corps[champ];
    const r = validerFrs(corps, REF);
    assert.strictEqual(r.ok, false, `${champ} absent devrait être refusé`);
    assert.match(r.message, new RegExp(champ), `le message doit nommer ${champ}`);
  }
});

test('les bornes de longueur sont tenues', () => {
  assert.strictEqual(validerFrs(bon({ titre: 'x'.repeat(MAX.titre + 1) }), REF).ok, false);
  assert.strictEqual(validerFrs(bon({ texte: 'x'.repeat(MAX.texte + 1) }), REF).ok, false);
  assert.strictEqual(validerFrs(bon({ texte: 'x'.repeat(MAX.texte) }), REF).ok, true);
});

test('une combinaison de rattachement absente du référentiel est refusée', () => {
  // Sinon on saisit « COB Inexistante », la fiche entre en base, et les agrégats par unité
  // se mettent à compter une unité qui n'existe pas.
  assert.strictEqual(validerFrs(bon({ unite: 'COB Inexistante' }), REF).ok, false);
  assert.strictEqual(validerFrs(bon({ commune: 'Nulle-Part' }), REF).ok, false);
});

test('un mot-clé « defaut: » est rejeté — c\'est le marqueur de vérité terrain', () => {
  // Les fiches mutées la nuit le portent, et le taux de détection de l'audit se mesure
  // dessus. Laissé libre, il permettrait de fabriquer des faux positifs.
  const r = validerFrs(bon({ mots_cles: ['rassemblement', 'defaut:B5'] }), REF);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /defaut:/);
});

test('les mots-clés sont bornés en nombre et en longueur', () => {
  assert.strictEqual(validerFrs(bon({ mots_cles: Array(MAX.motsCles + 1).fill('a') }), REF).ok, false);
  assert.strictEqual(validerFrs(bon({ mots_cles: ['x'.repeat(MAX.motCle + 1)] }), REF).ok, false);
});

test('la date fournie par le client est ignorée : le serveur impose la sienne', () => {
  // Une date choisie écrit dans le passé, donc dans une fenêtre d'audit déjà close ou dans
  // un agrégat déjà calculé.
  const r = validerFrs(bon({ date_redaction: '2019-01-01' }), REF);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.valeur.date_redaction, undefined);
  const q = buildInsertFrsQuery(r.valeur);
  assert.match(q.text, /CURRENT_DATE/);
  assert.ok(!q.values.includes('2019-01-01'));
});

test('l\'insertion est paramétrée et rend l\'identifiant créé', () => {
  const q = buildInsertFrsQuery(validerFrs(bon(), REF).valeur);
  assert.match(q.text, /INSERT INTO frs/);
  assert.match(q.text, /RETURNING id/);
  assert.ok(q.text.includes('$1'));
  assert.ok(!q.text.includes('Rassemblement'), 'aucune valeur interpolée dans le SQL');
});

test('sans mot-clé, aucune requête de mots-clés n\'est produite', () => {
  assert.strictEqual(buildInsertMotsClesQuery(12, []), null);
  const q = buildInsertMotsClesQuery(12, ['a', 'b']);
  assert.match(q.text, /INSERT INTO frs_mot_cle/);
  assert.deepStrictEqual(q.values, [12, ['a', 'b']]);
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

```bash
cd server/rens-api && node --test 'redaction.test.js'
```

Attendu : ÉCHEC — `Cannot find module './redaction'`.

- [ ] **Step 3: Écrire `redaction.js`**

```js
// Validation d'une FRS saisie dans l'application, et requêtes de son insertion.
//
// FRONTIÈRE DE CONFIANCE : ce corps vient d'un navigateur, par une API joignable depuis
// Internet. Rien n'est écrit sans être passé par ici — et les refus sont NOMMÉS, pour que le
// rédacteur sache quel champ reprendre plutôt que de perdre son texte sur un 500 muet.

const MAX = { titre: 200, texte: 8000, motsCles: 10, motCle: 40 };

const OBLIGATOIRES = ['titre', 'unite', 'code_ggd', 'departement', 'commune', 'texte'];
const BORNES = { titre: MAX.titre, texte: MAX.texte };

const refuse = (message) => ({ ok: false, code: 'bad_request', message });

function validerFrs(corps, referentiel) {
  if (!corps || typeof corps !== 'object') return refuse('Corps de requête absent ou illisible');

  const valeur = {};
  for (const champ of OBLIGATOIRES) {
    const v = typeof corps[champ] === 'string' ? corps[champ].trim() : '';
    if (!v) return refuse(`Champ « ${champ} » obligatoire`);
    if (BORNES[champ] && v.length > BORNES[champ]) {
      return refuse(`Champ « ${champ} » trop long (${BORNES[champ]} caractères au plus)`);
    }
    valeur[champ] = v;
  }

  // Rattachement : la combinaison doit exister. Saisir une unité inexistante ferait compter
  // aux agrégats par unité une unité qui n'est pas dans l'ordre de bataille.
  const connu = (referentiel || []).some((r) =>
    r.unite === valeur.unite && r.code_ggd === valeur.code_ggd
    && r.departement === valeur.departement && r.commune === valeur.commune);
  if (!connu) return refuse('Rattachement inconnu : unité, GGD, département et commune doivent exister');

  const mots = corps.mots_cles === undefined ? [] : corps.mots_cles;
  if (!Array.isArray(mots)) return refuse('Champ « mots_cles » : liste attendue');
  if (mots.length > MAX.motsCles) return refuse(`Mots-clés : ${MAX.motsCles} au plus`);
  const propres = [];
  for (const m of mots) {
    const v = typeof m === 'string' ? m.trim() : '';
    if (!v) continue;
    if (v.length > MAX.motCle) return refuse(`Mot-clé trop long (${MAX.motCle} caractères au plus)`);
    // `defaut:` est le marqueur de vérité terrain sur lequel se mesure le taux de détection
    // de l'audit. Laissé libre, il permettrait de fabriquer des faux positifs et de fausser
    // la seule mesure de qualité de l'outil. Même raison pour `signal-faible:`, qui pilote
    // la fenêtre des signaux faibles.
    if (/^(defaut|signal-faible):/i.test(v)) return refuse(`Mot-clé réservé : « ${v} »`);
    propres.push(v);
  }
  valeur.mots_cles = propres;

  // La date n'est PAS lue du corps : le serveur impose la sienne (cf. buildInsertFrsQuery).
  return { ok: true, valeur };
}

function buildInsertFrsQuery(valeur) {
  const text = `
    INSERT INTO frs (date_redaction, titre, unite, code_ggd, departement, commune, texte)
    VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6)
    RETURNING id`;
  return {
    text,
    values: [valeur.titre, valeur.unite, valeur.code_ggd, valeur.departement, valeur.commune, valeur.texte],
  };
}

function buildInsertMotsClesQuery(frsId, mots) {
  if (!mots || !mots.length) return null;
  const text = `
    INSERT INTO frs_mot_cle (frs_id, mot, ordre)
    SELECT $1, mot, (ordinalite - 1)::int
      FROM unnest($2::text[]) WITH ORDINALITY AS t(mot, ordinalite)`;
  return { text, values: [frsId, mots] };
}

module.exports = { validerFrs, buildInsertFrsQuery, buildInsertMotsClesQuery, MAX };
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

```bash
cd server/rens-api && node --test 'redaction.test.js'
```

Attendu : SUCCÈS, 9 tests.

- [ ] **Step 5: Brancher la route dans `server.js`**

En tête de fichier, après le pool existant :

```js
const { validerFrs, buildInsertFrsQuery, buildInsertMotsClesQuery } = require('./redaction');
const { buildReferentielQuery } = require('./audit/rapport');

// Pool d'ÉCRITURE, séparé. Le rôle rens_redaction (migration 009) ne sait qu'insérer : il ne
// peut ni lire ni modifier une fiche. Deux connexions suffisent — une rédaction est un geste
// humain, pas un flux. Sans PGUSER_REDACTION, le pool n'est pas créé et POST /frs répond 503
// plutôt que d'écrire avec le rôle de lecture.
const poolEcriture = process.env.PGUSER_REDACTION
  ? new Pool({
      host: process.env.PGHOST || 'postgres', port: 5432,
      user: process.env.PGUSER_REDACTION, password: process.env.PGPASSWORD_REDACTION,
      database: process.env.PGDATABASE || 'rens', max: 2,
    })
  : null;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; let trop = false;
    req.on('data', (c) => {
      d += c;
      // Borne dure AVANT le parse : un corps sans fin ne doit pas remplir la mémoire du
      // conteneur. 64 Ko couvre largement 8000 caractères de texte et ses métadonnées.
      if (d.length > 65536 && !trop) { trop = true; reject(new Error('body_trop_grand')); req.destroy(); }
    });
    req.on('end', () => !trop && resolve(d));
    req.on('error', reject);
  });
}
```

Puis la route, avant le `404` final :

```js
  // Rédaction d'une FRS depuis l'application. SEULE écriture de cette API, et la seule à
  // emprunter le pool d'écriture. La lecture nécessaire à la validation (le référentiel) se
  // fait avec le pool de lecture : rens_redaction n'a pas le droit de SELECT.
  if (u.pathname === '/frs' && req.method === 'POST') {
    if (!poolEcriture) return err(res, 503, 'ecriture_indisponible', "L'écriture n'est pas configurée sur ce service");
    let corps;
    try {
      corps = JSON.parse((await readBody(req)) || '{}');
    } catch { return err(res, 400, 'bad_request', 'Corps JSON illisible'); }

    let referentiel;
    try {
      const q = buildReferentielQuery();
      referentiel = (await pool.query(q.text, q.values)).rows;
    } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }

    const v = validerFrs(corps, referentiel);
    if (!v.ok) return err(res, 400, v.code, v.message);

    // Fiche et mots-clés dans UNE transaction : une fiche dont les mots-clés manqueraient
    // sortirait des regroupements sans que rien ne le signale.
    const client = await poolEcriture.connect();
    try {
      await client.query('BEGIN');
      const qf = buildInsertFrsQuery(v.valeur);
      const id = (await client.query(qf.text, qf.values)).rows[0].id;
      const qm = buildInsertMotsClesQuery(id, v.valeur.mots_cles);
      if (qm) await client.query(qm.text, qm.values);
      await client.query('COMMIT');
      return json(res, 201, { data: { id } });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('db_error', e.message);
      return err(res, 500, 'db_error', "La fiche n'a pas pu être enregistrée");
    } finally {
      client.release();
    }
  }
```

- [ ] **Step 6: Lancer la suite serveur**

```bash
cd server/rens-api && node --test 'redaction.test.js' 'audit/*.test.mjs' 'audit/*.test.js' 'migrations/*.test.mjs' 'fiches.test.js'
```

Attendu : SUCCÈS.

- [ ] **Step 7: Vérifier que le Dockerfile emporte le nouveau fichier**

```bash
grep -n "COPY" server/rens-api/Dockerfile
```

Si la copie est faite fichier par fichier (piège déjà rencontré : le conteneur ne démarrait plus faute de `audit/`), ajouter `redaction.js`. Si c'est un `COPY . .`, ne rien changer.

- [ ] **Step 8: Commit**

```bash
git add server/rens-api
git commit -m "$(cat <<'EOF'
feat(qualite): enregistrer une FRS rédigée dans l'application

Première route d'écriture de rens-api. Elle emprunte un pool séparé au rôle
rens_redaction (009), qui ne sait qu'insérer ; la lecture nécessaire à la
validation passe, elle, par le pool de lecture.

Deux bornes ne sont pas cosmétiques. La date est imposée par le serveur : une
date choisie écrit dans le passé, donc dans une fenêtre d'audit déjà close ou
un agrégat déjà calculé. Et un mot-clé `defaut:` ou `signal-faible:` est
rejeté : le premier porte la vérité terrain sur laquelle se mesure le taux de
détection, le second pilote la fenêtre des signaux faibles — libres à la
saisie, ils permettraient de fausser les deux.

Fiche et mots-clés dans une transaction : une fiche dont les mots-clés
manqueraient sortirait des regroupements sans que rien ne le signale.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Analyser un texte volant (BFF)

**Files:**
- Modify: `server/proxy.mjs` (routes `/api/rens/audit/analyse-texte` et `/api/rens/frs`)
- Modify: `server/proxy.analyse.test.mjs`

**Interfaces:**
- Consumes: `portePii` (Task 1), `composerFragment`, `parseSortieAgents`, `construireRapportAnalyse`.
- Produces: `POST /api/rens/audit/analyse-texte` → `202 { jobId }`, résultat `RapportAnalyse` à une fiche (`frs_id: 0`). `POST /api/rens/frs` → proxy de `POST /frs`.
- Produces: constante `ID_BROUILLON = 0` (dans `proxy.mjs`), identifiant sentinelle du brouillon.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `server/proxy.analyse.test.mjs`, ajouter à la fin du fichier. Les helpers `cfg`, `faireReq`, `faireRes` et `attendre` sont **déjà définis en tête de ce fichier** (lignes 5 à 50) — les réutiliser tels quels.

```js
// --- Contrôle a priori : analyse d'un brouillon qui n'est pas en base --------------------

const BROUILLON = {
  titre: 'Rassemblement', unite: 'COB Segré', code_ggd: 'GGD 49',
  departement: 'Maine-et-Loire', commune: 'Segré',
  texte: 'Contrôle de M. Karim BENNANI, de confession musulmane.',
};

test("analyse-texte : un brouillon est analysé sans que rens-api soit appelé", async () => {
  // Le brouillon n'a pas de ligne en base : il n'y a rien à charger, et surtout rien à
  // écrire tant que le rédacteur n'a pas tranché.
  let appelsRens = 0;
  const h = createHandler({
    cfg,
    fetchImpl: async () => { appelsRens++; throw new Error('rens-api ne doit pas être appelé'); },
    rensWorkflow: async () => JSON.stringify([
      { type: 'dcp', frs_id: 0, porte_dcp: true, explication: 'Identité citée.' },
      { frs_id: 0, critere: 'B5', fondement: 'CSI R. 236-23',
        extrait: 'de confession musulmane', explication: 'Croyance.', confiance: 'haute' },
    ]),
  });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/analyse-texte', BROUILLON), res);
  assert.strictEqual(res.code, 202);
  const v = await attendre(h, JSON.parse(res.corps).jobId);
  assert.strictEqual(v.status, 'done', v.error);
  assert.strictEqual(appelsRens, 0);
  assert.strictEqual(v.result.fiches.length, 1);
  assert.strictEqual(v.result.fiches[0].frs_id, 0);
  assert.deepStrictEqual(v.result.fiches[0].ecarts.map((e) => e.critere), ['B5']);
});

test('analyse-texte : un brouillon vide ou hors bornes est refusé avant tout appel', async () => {
  for (const corps of [{}, { titre: 'T' }, { texte: 'x' }, { titre: 'T', texte: 'x'.repeat(8001) }]) {
    const h = createHandler({ cfg, fetchImpl: async () => { throw new Error('pas d\'appel attendu'); },
      rensWorkflow: async () => { throw new Error('pas de workflow attendu'); } });
    const res = faireRes();
    await h(faireReq('/api/rens/audit/analyse-texte', corps), res);
    assert.strictEqual(res.code, 400, `corps invalide accepté : ${JSON.stringify(corps).slice(0, 40)}`);
    assert.strictEqual(JSON.parse(res.corps).error, 'BROUILLON_INVALIDE');
  }
});

test("analyse-texte : porte_pii est calculé sur le texte saisi, pas lu d'une base", async () => {
  // Ce booléen décide de la sortie du champ du décret. Sur un texte volant il ne peut venir
  // que de portePii : absent, une fiche sans personne garderait tous ses griefs.
  let promptVu = null;
  const h = createHandler({
    cfg,
    fetchImpl: async () => { throw new Error('pas d\'appel attendu'); },
    rensWorkflow: async ({ prompt }) => { promptVu = JSON.parse(prompt); return '[]'; },
  });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/analyse-texte', {
    ...BROUILLON, texte: 'Des dégradations ont été constatées sur du mobilier urbain.',
  }), res);
  await attendre(h, JSON.parse(res.corps).jobId);
  assert.strictEqual(promptVu.fiches.length, 1);
  assert.strictEqual(promptVu.fiches[0].id, 0);
  assert.strictEqual(promptVu.fiches[0].porte_pii, false);
});

test('analyse-texte : un écart visant un autre identifiant est rejeté, pas rattaché au brouillon', async () => {
  // La frontière anti-hallucination ne s'assouplit pas parce que le brouillon a un
  // identifiant de convention.
  const h = createHandler({
    cfg,
    fetchImpl: async () => { throw new Error('pas d\'appel attendu'); },
    rensWorkflow: async () => JSON.stringify([
      { frs_id: 4213, critere: 'B5', fondement: 'CSI R. 236-23', extrait: 'x', explication: 'y', confiance: 'haute' },
    ]),
  });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/analyse-texte', BROUILLON), res);
  const v = await attendre(h, JSON.parse(res.corps).jobId);
  assert.strictEqual(v.result.fiches[0].ecarts.length, 0);
  assert.strictEqual(v.result.resume.rejets, 1);
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

```bash
node --test 'server/proxy.analyse.test.mjs'
```

Attendu : ÉCHEC — la route `/api/rens/audit/analyse-texte` répond 404.

- [ ] **Step 3: Écrire la route d'analyse**

Dans `server/proxy.mjs`, importer `portePii` :

```js
import { portePii } from "./rens-api/audit/regles.mjs";
```

Puis, juste après la route `/api/rens/audit/analyse` :

```js
// Identifiant sentinelle du brouillon. `parseSortieAgents` n'accepte que les identifiants
// qu'on lui déclare : c'est la frontière anti-hallucination, et un brouillon n'ayant pas
// d'identité en base, il lui en faut une pour le temps de l'analyse.
const ID_BROUILLON = 0;
const MAX_TEXTE = 8000;

// Contrôle A PRIORI : analyse d'une FRS en cours de rédaction, qui n'est PAS en base. Même
// workflow, mêmes trois agents, même assemblage de rapport que l'analyse d'une sélection —
// une aide à la rédaction qui dirait vert là où l'audit dit rouge ne servirait à rien.
if (url.pathname === "/api/rens/audit/analyse-texte" && req.method === "POST") {
  try {
    const c = JSON.parse((await readBody(req)) || "{}");
    const lire = (k) => (typeof c[k] === "string" ? c[k].trim() : "");
    const texte = lire("texte");
    const titre = lire("titre");
    if (!texte || !titre || texte.length > MAX_TEXTE) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "BROUILLON_INVALIDE" }));
      return;
    }
    // La fiche volante porte exactement les champs d'une FRS chargée en base, `porte_pii`
    // compris — calculé ici par la MÊME fonction que les deux autres chemins.
    const fiche = {
      id: ID_BROUILLON,
      date_redaction: new Date().toISOString().slice(0, 10),
      titre, unite: lire("unite"), code_ggd: lire("code_ggd"),
      commune: lire("commune"), texte, porte_pii: portePii(texte),
    };
    const jobId = createGenericJob();
    runJob(jobId, async () => {
      const brut = await rensWorkflow({
        prompt: JSON.stringify(composerFragment(0, [fiche])), appId: cfg.qualiteAppId, cfg, fetchImpl,
      });
      const { ecarts, dcp, rejets } = parseSortieAgents(brut, [ID_BROUILLON]);
      // `structurels` est vide : C10 (ancienneté) est le seul contrôle SQL, et une fiche du
      // jour n'a pas dix ans. L'écran marque ce critère « sans objet à la rédaction ».
      return construireRapportAnalyse({ fiches: [fiche], structurels: [], ecarts, dcp, rejets });
    });
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jobId }));
  } catch (e) {
    console.error("analyse_texte_error", e?.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
  }
  return;
}

// Enregistrement : proxy vers rens-api, qui valide et écrit. Le front ne parle jamais
// directement au microservice.
if (url.pathname === "/api/rens/frs" && req.method === "POST") {
  return forwardRens(req, res, cfg, fetchImpl, "/frs", "");
}
```

Vérifier que `forwardRens` transmet bien le corps sur un `POST` (ligne ~75 : `if (req.method === "POST") init.body = await readBody(req);`). Si `forwardRens` ne pose pas `Content-Type: application/json`, l'ajouter.

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

```bash
node --test 'server/proxy.analyse.test.mjs'
```

Attendu : SUCCÈS.

- [ ] **Step 5: Lancer toute la suite BFF**

```bash
node --test 'server/*.test.mjs'
```

Attendu : SUCCÈS (305 tests + les nouveaux).

- [ ] **Step 6: Commit**

```bash
git add server/proxy.mjs server/proxy.analyse.test.mjs
git commit -m "$(cat <<'EOF'
feat(qualite): analyser une FRS avant qu'elle existe en base

L'analyse à la demande partait d'identifiants et chargeait les fiches. Un
brouillon n'a pas de ligne : le BFF compose donc le fragment depuis l'objet
reçu et appelle le MÊME workflow, avec parseSortieAgents et
construireRapportAnalyse inchangés — c'est ce qui garantit que l'aide à la
rédaction et l'audit disent la même chose.

Le brouillon reçoit un identifiant sentinelle : parseSortieAgents n'accepte que
les identifiants déclarés, et cette frontière anti-hallucination ne s'assouplit
pas pour l'occasion. `porte_pii` est calculé par portePii, la même fonction que
les deux autres chemins.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Appels front (`redactionApi.ts`)

**Files:**
- Create: `src/features/qualite/redactionApi.ts`
- Create: `src/features/qualite/redactionApi.test.ts`

**Interfaces:**
- Consumes: `runJobAsync` (`src/lib/runJobAsync.ts`), types `RapportAnalyse` / `FicheAnalysee` (`./analyseApi`).
- Produces :
  - `type Brouillon = { titre, unite, code_ggd, departement, commune, texte, mots_cles: string[] }`
  - `MAX_TEXTE = 8000`, `MAX_TITRE = 200`
  - `analyserTexte(b: Brouillon, opts?): Promise<RapportAnalyse>`
  - `enregistrerFiche(b: Brouillon, opts?): Promise<number>` (rend l'identifiant créé)
  - `fetchReferentiel(opts?): Promise<Rattachement[]>` avec `type Rattachement = { unite, code_ggd, departement, commune }`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `src/features/qualite/redactionApi.test.ts` :

```ts
import { describe, it, expect, vi } from "vitest";
import { analyserTexte, enregistrerFiche, fetchReferentiel, type Brouillon } from "./redactionApi";

const brouillon: Brouillon = {
  titre: "Rassemblement", unite: "COB Segré", code_ggd: "GGD 49",
  departement: "Maine-et-Loire", commune: "Segré", texte: "Des faits.", mots_cles: [],
};

describe("redactionApi", () => {
  it("analyserTexte poste le brouillon puis attend le job", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "j1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "done", result: { fiches: [], resume: {} } }) });
    const r = await analyserTexte(brouillon, { fetchImpl: fetchImpl as unknown as typeof fetch, intervalMs: 0 });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/rens/audit/analyse-texte");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).texte).toBe("Des faits.");
    expect(r).toEqual({ fiches: [], resume: {} });
  });

  it("enregistrerFiche rend l'identifiant créé", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ data: { id: 4213 } }) });
    const id = await enregistrerFiche(brouillon, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/rens/frs");
    expect(id).toBe(4213);
  });

  it("enregistrerFiche remonte le message du serveur, pas un code opaque", async () => {
    // Le rédacteur doit savoir QUEL champ reprendre : un « erreur 400 » lui ferait
    // recommencer sa fiche à l'aveugle.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: "bad_request", message: "Champ « commune » obligatoire" } }),
    });
    await expect(enregistrerFiche(brouillon, { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow("Champ « commune » obligatoire");
  });

  it("fetchReferentiel rend la liste des rattachements", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: [{ unite: "COB Segré", code_ggd: "GGD 49", departement: "Maine-et-Loire", commune: "Segré" }] }),
    });
    const r = await fetchReferentiel({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toHaveLength(1);
    expect(r[0].unite).toBe("COB Segré");
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

```bash
npm test -- redactionApi
```

Attendu : ÉCHEC — module `./redactionApi` introuvable.

- [ ] **Step 3: Écrire `redactionApi.ts`**

```ts
import { runJobAsync } from "../../lib/runJobAsync";
import type { RapportAnalyse } from "./analyseApi";

export type Rattachement = {
  unite: string;
  code_ggd: string;
  departement: string;
  commune: string;
};

export type Brouillon = Rattachement & {
  titre: string;
  texte: string;
  mots_cles: string[];
};

// Mêmes bornes que le serveur (server/rens-api/redaction.js). Le front les applique pour
// prévenir AVANT l'envoi ; le serveur reste seul juge — un contrôle de saisie n'est pas
// une frontière de confiance.
export const MAX_TEXTE = 8000;
export const MAX_TITRE = 200;

// Une seule fiche, mais le même workflow qu'une sélection de vingt : la file d'attente côté
// IAka domine la durée, pas le nombre de fiches.
const ANALYSE_TIMEOUT_MS = 660000;

type Opts = { signal?: AbortSignal; fetchImpl?: typeof fetch; intervalMs?: number };

export function analyserTexte(b: Brouillon, opts: Opts = {}): Promise<RapportAnalyse> {
  return runJobAsync<RapportAnalyse>("/api/rens/audit/analyse-texte", b, {
    timeoutMs: ANALYSE_TIMEOUT_MS, signal: opts.signal, fetchImpl: opts.fetchImpl,
    intervalMs: opts.intervalMs,
  });
}

export async function enregistrerFiche(b: Brouillon, opts: Opts = {}): Promise<number> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f("/api/rens/frs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
    signal: opts.signal,
  });
  let corps: any;
  try {
    corps = await res.json();
  } catch {
    throw new Error("La réponse du serveur est illisible.");
  }
  // Le message du serveur nomme le champ fautif : le remplacer par un code priverait le
  // rédacteur de la seule information utile.
  if (!res.ok) throw new Error(corps?.error?.message || "La fiche n'a pas pu être enregistrée.");
  return corps.data.id as number;
}

export async function fetchReferentiel(opts: Opts = {}): Promise<Rattachement[]> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f("/api/rens/referentiel", { signal: opts.signal });
  if (!res.ok) throw new Error("REFERENTIEL_INDISPONIBLE");
  const corps = await res.json();
  return (corps.data ?? []) as Rattachement[];
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

```bash
npm test -- redactionApi
```

Attendu : SUCCÈS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/qualite/redactionApi.ts src/features/qualite/redactionApi.test.ts
git commit -m "$(cat <<'EOF'
feat(qualite): appels front de la rédaction d'une FRS

Analyse d'un brouillon (job asynchrone, comme l'analyse d'une sélection),
enregistrement, et lecture du référentiel de rattachement.

L'enregistrement remonte le MESSAGE du serveur et non son code : c'est lui qui
nomme le champ fautif, et un « erreur 400 » ferait reprendre la fiche à
l'aveugle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Extraire `FicheRapport` pour le réemployer

Le verdict rendu au rédacteur est le même objet que celui rendu au contrôleur. On extrait le composant plutôt que de le dupliquer.

**Files:**
- Create: `src/features/qualite/FicheRapport.tsx`
- Modify: `src/features/qualite/AnalyseDemande.tsx:17-98` (retrait de la définition locale, ajout de l'import)
- Create: `src/features/qualite/FicheRapport.test.tsx`

**Interfaces:**
- Produces: `FicheRapport({ fiche, montrerIdentite = true }: { fiche: FicheAnalysee; montrerIdentite?: boolean })`. Quand `montrerIdentite` est faux, la ligne « Fiche {id} · unité · … » n'est pas rendue — un brouillon n'a pas d'identifiant et « Fiche 0 » serait un mensonge.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/features/qualite/FicheRapport.test.tsx` :

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FicheRapport } from "./FicheRapport";
import type { FicheAnalysee } from "./analyseApi";

const fiche: FicheAnalysee = {
  frs_id: 0, titre: "Rassemblement", unite: "COB Segré", code_ggd: "GGD 49",
  commune: "Segré", date_redaction: "2026-08-07", texte: "Des faits constatés.",
  porte_dcp: true, hors_perimetre: false, conforme: false, gravite_max: "bloquant",
  ecarts: [{
    critere: "B5", libelle: "Donnée sensible", gravite: "bloquant",
    fondement: "CSI R. 236-23", source: "llm", extrait: "de confession musulmane",
    explication: "Croyance.", confiance: "haute",
  }],
  controles: [],
};

describe("FicheRapport", () => {
  it("rend le verdict et ses écarts", () => {
    render(<FicheRapport fiche={fiche} />);
    expect(screen.getByText(/Non conforme/)).toBeInTheDocument();
    expect(screen.getByText("B5")).toBeInTheDocument();
    expect(screen.getByText(/R. 236-23/)).toBeInTheDocument();
  });

  it("tait l'identité de la fiche quand on le lui demande", () => {
    // Un brouillon n'a pas d'identifiant : afficher « Fiche 0 » serait un mensonge, et
    // laisserait croire que la fiche est déjà en base.
    render(<FicheRapport fiche={fiche} montrerIdentite={false} />);
    expect(screen.queryByText(/Fiche 0/)).not.toBeInTheDocument();
    expect(screen.getByText("B5")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

```bash
npm test -- FicheRapport
```

Attendu : ÉCHEC — module `./FicheRapport` introuvable.

- [ ] **Step 3: Déplacer le composant**

Créer `src/features/qualite/FicheRapport.tsx` avec le corps **actuel** de `FicheRapport` (lignes 17 à 98 de `AnalyseDemande.tsx`), enrichi du drapeau :

```tsx
import type { FicheAnalysee } from "./analyseApi";
import { C, Icone, Puce, PuceGravite, TexteAvecExtraits, carte } from "./ui";

// Rendu du verdict d'UNE fiche. Partagé par l'analyse d'une sélection (le contrôleur) et par
// la rédaction (le rédacteur) : ils regardent le même objet, et deux rendus finiraient par
// montrer deux choses.
//
// `montrerIdentite` est faux pour un brouillon : il n'a pas encore d'identifiant, et
// « Fiche 0 » laisserait croire qu'il est déjà en base.
export function FicheRapport({ fiche, montrerIdentite = true }: { fiche: FicheAnalysee; montrerIdentite?: boolean }) {
  // … corps repris tel quel depuis AnalyseDemande.tsx …
  // La seule modification : envelopper le <p> des métadonnées.
  //   {montrerIdentite && (
  //     <p style={{ fontSize: 12, color: C.gris, margin: "6px 0 0" }}>
  //       Fiche {fiche.frs_id} · {fiche.unite} · {fiche.code_ggd} · {fiche.commune} · rédigée le {fiche.date_redaction}
  //     </p>
  //   )}
}
```

Dans `AnalyseDemande.tsx` : supprimer la définition locale et ajouter `import { FicheRapport } from "./FicheRapport";`. Retirer de son import depuis `./ui` les symboles devenus inutilisés (`carte`, `PuceGravite`, `TexteAvecExtraits`… — se fier au typecheck).

- [ ] **Step 4: Lancer les tests et le typecheck**

```bash
npm test -- FicheRapport AnalyseDemande
npx tsc -b
```

Attendu : SUCCÈS des tests, aucune erreur de typage. `AnalyseDemande.test.tsx` doit passer **sans modification** — c'est la preuve que l'extraction n'a rien changé.

- [ ] **Step 5: Commit**

```bash
git add src/features/qualite
git commit -m "$(cat <<'EOF'
refactor(qualite): extraire le rendu du verdict d'une fiche

Le rédacteur et le contrôleur regardent le même objet. Dupliquer le rendu
aurait suffi à les faire diverger à la première retouche. Le composant prend un
drapeau pour taire l'identité de la fiche : un brouillon n'en a pas, et
« Fiche 0 » laisserait croire qu'il est déjà en base.

Les tests d'AnalyseDemande passent sans modification — c'est ce qui atteste que
l'extraction n'a rien changé.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: L'écran de rédaction

**Files:**
- Create: `src/features/qualite/RedactionFrs.tsx`
- Create: `src/features/qualite/RedactionFrs.test.tsx`

**Interfaces:**
- Consumes: `analyserTexte`, `enregistrerFiche`, `fetchReferentiel`, `MAX_TEXTE`, `MAX_TITRE`, `type Brouillon`, `type Rattachement` (Task 6) ; `FicheRapport` (Task 7) ; `C`, `Encart`, `Icone`, `TitreSection`, `champ`, `carte` (`./ui`).
- Produces: `RedactionFrs({ analyser?, enregistrer?, referentiel? })` — les trois dépendances sont injectables pour les tests, exactement comme `AnalyseDemande` injecte `lancer`.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `src/features/qualite/RedactionFrs.test.tsx` :

**Le projet n'a pas `@testing-library/user-event`** : les tests existants pilotent l'interface avec `fireEvent`. On fait pareil — pas de dépendance ajoutée pour ce qu'un `fireEvent.change` fait déjà.

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RedactionFrs } from "./RedactionFrs";
import type { RapportAnalyse } from "./analyseApi";

const REF = [{ unite: "COB Segré", code_ggd: "GGD 49", departement: "Maine-et-Loire", commune: "Segré" }];

const rapport = (ecarts: string[]): RapportAnalyse => ({
  fiches: [{
    frs_id: 0, titre: "T", unite: "COB Segré", code_ggd: "GGD 49", commune: "Segré",
    date_redaction: "2026-08-07", texte: "Des faits.", porte_dcp: true, hors_perimetre: false,
    conforme: ecarts.length === 0, gravite_max: ecarts.length ? "bloquant" : null,
    ecarts: ecarts.map((critere) => ({
      critere, libelle: "Donnée sensible", gravite: "bloquant" as const,
      fondement: "CSI R. 236-23", source: "llm" as const, extrait: "extrait",
      explication: "…", confiance: "haute" as const,
    })),
    controles: [],
  }],
  resume: { total: 1, conformes: ecarts.length ? 0 : 1, non_conformes: ecarts.length ? 1 : 0, ecarts: ecarts.length, par_gravite: {}, rejets: 0 },
});

// Le rattachement est un <select> dont la valeur est l'index dans le référentiel : un seul
// choix pose unité, GGD, département et commune.
async function remplir() {
  fireEvent.change(await screen.findByLabelText(/Titre/), { target: { value: "Rassemblement" } });
  fireEvent.change(screen.getByLabelText(/Rattachement/), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText(/Texte/), { target: { value: "Des faits constatés." } });
}

describe("RedactionFrs", () => {
  it("n'offre pas d'enregistrer avant la première analyse", async () => {
    // Deux boutons dès la saisie rendraient l'analyse facultative, et le geste que la
    // feature veut montrer disparaîtrait au premier clic pressé.
    render(<RedactionFrs analyser={vi.fn()} enregistrer={vi.fn()} referentiel={async () => REF} />);
    await screen.findByLabelText(/Titre/);
    expect(screen.queryByRole("button", { name: /Enregistrer/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyser/ })).toBeInTheDocument();
  });

  it("analyse, montre le verdict, puis enregistre sur confirmation", async () => {
    const analyser = vi.fn().mockResolvedValue(rapport(["B5"]));
    const enregistrer = vi.fn().mockResolvedValue(4213);
    render(<RedactionFrs analyser={analyser} enregistrer={enregistrer} referentiel={async () => REF} />);
    await remplir();
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    expect(await screen.findByText("B5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(enregistrer).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/4213/)).toBeInTheDocument();
  });

  it("marque le verdict périmé dès que le texte change", async () => {
    // Sans ça, on enregistre avec la bénédiction d'une analyse qui portait sur un autre
    // texte — le pire des deux mondes : un contrôle qui rassure à tort.
    render(<RedactionFrs analyser={vi.fn().mockResolvedValue(rapport(["B5"]))} enregistrer={vi.fn()} referentiel={async () => REF} />);
    await remplir();
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    await screen.findByText("B5");
    fireEvent.change(screen.getByLabelText(/Texte/), { target: { value: "Des faits constatés. Complément." } });
    expect(screen.getByText(/version antérieure/i)).toBeInTheDocument();
    // Le verdict reste LISIBLE pendant la correction : c'est tout l'intérêt des deux colonnes.
    expect(screen.getByText("B5")).toBeInTheDocument();
  });

  it("laisse enregistrer quand l'analyse est en panne", async () => {
    // Un contrôle qui tombe ne doit pas empêcher un militaire de rendre sa fiche.
    const enregistrer = vi.fn().mockResolvedValue(7);
    render(<RedactionFrs analyser={vi.fn().mockRejectedValue(new Error("IAKA_TIMEOUT"))} enregistrer={enregistrer} referentiel={async () => REF} />);
    await remplir();
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    expect(await screen.findByText(/n'a pas abouti/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(enregistrer).toHaveBeenCalledTimes(1));
  });

  it("conserve le texte quand l'enregistrement échoue", async () => {
    render(<RedactionFrs
      analyser={vi.fn().mockResolvedValue(rapport([]))}
      enregistrer={vi.fn().mockRejectedValue(new Error("Champ « commune » obligatoire"))}
      referentiel={async () => REF} />);
    await remplir();
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Enregistrer/ }));
    expect(await screen.findByText(/commune/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Texte/)).toHaveValue("Des faits constatés.");
  });

  it("confirme même une fiche conforme", async () => {
    const enregistrer = vi.fn().mockResolvedValue(1);
    render(<RedactionFrs analyser={vi.fn().mockResolvedValue(rapport([]))} enregistrer={enregistrer} referentiel={async () => REF} />);
    await remplir();
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    expect(await screen.findByText(/Conforme/)).toBeInTheDocument();
    expect(enregistrer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(enregistrer).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

```bash
npm test -- RedactionFrs
```

Attendu : ÉCHEC — module `./RedactionFrs` introuvable.

- [ ] **Step 3: Écrire l'écran**

Créer `src/features/qualite/RedactionFrs.tsx` :

```tsx
import { useEffect, useState } from "react";
import { Button } from "@gouvfr-lasuite/cunningham-react";
import type { RapportAnalyse } from "./analyseApi";
import {
  analyserTexte, enregistrerFiche, fetchReferentiel,
  MAX_TEXTE, MAX_TITRE, type Brouillon, type Rattachement,
} from "./redactionApi";
import { FicheRapport } from "./FicheRapport";
import { C, Encart, Icone, TitreSection, carte, champ } from "./ui";

const MESSAGES: Record<string, string> = {
  SORTIE_ILLISIBLE: "Les agents n'ont pas rendu de résultat exploitable. Relancer l'analyse.",
  IAKA_TIMEOUT: "Le contrôle n'a pas abouti dans le temps imparti. Réessayer.",
  IAKA_UPSTREAM: "La plateforme d'analyse n'a pas répondu.",
  BROUILLON_INVALIDE: `Un titre et un texte d'au plus ${MAX_TEXTE} caractères sont requis.`,
  JOB_INCONNU: "Le contrôle a été interrompu côté serveur. Relancer l'analyse.",
};

const VIDE: Brouillon = {
  titre: "", unite: "", code_ggd: "", departement: "", commune: "", texte: "", mots_cles: [],
};

// Les trois appels sont injectables : les tests de ce composant n'ont pas à repasser par le
// job asynchrone réel (poll toutes les 3 s), déjà couvert par redactionApi.test.ts.
export function RedactionFrs({
  analyser = analyserTexte,
  enregistrer = enregistrerFiche,
  referentiel = fetchReferentiel,
}: {
  analyser?: (b: Brouillon) => Promise<RapportAnalyse>;
  enregistrer?: (b: Brouillon) => Promise<number>;
  referentiel?: () => Promise<Rattachement[]>;
} = {}) {
  const [rattachements, setRattachements] = useState<Rattachement[]>([]);
  const [brouillon, setBrouillon] = useState<Brouillon>(VIDE);
  const [rapport, setRapport] = useState<RapportAnalyse | null>(null);
  // Un verdict n'est vrai que du texte sur lequel il a porté. Modifier le texte sans le dire
  // laisserait enregistrer avec la bénédiction d'une analyse périmée.
  const [perime, setPerime] = useState(false);
  const [encours, setEncours] = useState(false);
  const [erreurAnalyse, setErreurAnalyse] = useState<string | null>(null);
  const [erreurEnregistrement, setErreurEnregistrement] = useState<string | null>(null);
  const [idCree, setIdCree] = useState<number | null>(null);

  useEffect(() => {
    let vivant = true;
    referentiel().then((r) => vivant && setRattachements(r)).catch(() => vivant && setRattachements([]));
    return () => { vivant = false; };
  }, [referentiel]);

  // Toute retouche périme le verdict en cours — jamais elle ne l'efface : les remarques
  // restent lisibles pendant qu'on corrige, c'est tout l'intérêt des deux colonnes.
  function modifier(champs: Partial<Brouillon>) {
    setBrouillon((b) => ({ ...b, ...champs }));
    if (rapport) setPerime(true);
    setIdCree(null);
  }

  const complet = brouillon.titre.trim() !== "" && brouillon.texte.trim() !== "";

  async function lancerAnalyse() {
    setEncours(true);
    setErreurAnalyse(null);
    setErreurEnregistrement(null);
    setRapport(null);
    setPerime(false);
    try {
      setRapport(await analyser(brouillon));
    } catch (e) {
      setErreurAnalyse((e as Error).message);
    } finally {
      setEncours(false);
    }
  }

  async function lancerEnregistrement() {
    setErreurEnregistrement(null);
    try {
      const id = await enregistrer(brouillon);
      setIdCree(id);
      // Remise à zéro APRÈS que le numéro est connu : le rédacteur doit repartir avec.
      setBrouillon(VIDE);
      setRapport(null);
      setPerime(false);
    } catch (e) {
      // Le texte n'est pas touché : perdre une demi-heure de rédaction est le seul défaut
      // qu'un rédacteur ne pardonne pas.
      setErreurEnregistrement((e as Error).message);
    }
  }

  // L'enregistrement n'est offert qu'APRÈS un contrôle — ou après sa panne. Deux boutons dès
  // la saisie rendraient l'analyse facultative.
  const peutEnregistrer = rapport !== null || erreurAnalyse !== null;
  const fiche = rapport?.fiches[0] ?? null;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Encart>
        La fiche est contrôlée avant d'être enregistrée, sur la même grille que l'audit de la
        nuit. Le contrôle conseille : il n'empêche jamais d'enregistrer.
      </Encart>

      {idCree !== null && (
        <Encart>
          <Icone nom="check_circle" taille={16} couleur={C.succes} />{" "}
          Fiche enregistrée sous le numéro {idCree}.
        </Encart>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input
          aria-label="Titre" placeholder="Titre" maxLength={MAX_TITRE} value={brouillon.titre}
          onChange={(e) => modifier({ titre: e.target.value })}
          style={{ ...champ, flex: 1, minWidth: 200 }}
        />
        {/* Un seul choix pose unité, GGD, département et commune : une combinaison
            inexistante devient impossible à composer, et le serveur la refuserait. */}
        <select
          aria-label="Rattachement"
          value={rattachements.findIndex((r) => r.unite === brouillon.unite && r.commune === brouillon.commune)}
          onChange={(e) => {
            const r = rattachements[Number(e.target.value)];
            if (r) modifier({ unite: r.unite, code_ggd: r.code_ggd, departement: r.departement, commune: r.commune });
          }}
          style={{ ...champ, minWidth: 260 }}
        >
          <option value={-1}>Choisir un rattachement…</option>
          {rattachements.map((r, i) => (
            <option key={`${r.unite}|${r.commune}`} value={i}>
              {r.unite} · {r.code_ggd} · {r.commune}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
        <div style={{ ...carte, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <TitreSection icone="edit_note">Texte de la fiche</TitreSection>
          <textarea
            aria-label="Texte" maxLength={MAX_TEXTE} rows={14} value={brouillon.texte}
            onChange={(e) => modifier({ texte: e.target.value })}
            style={{ ...champ, width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
          />
          <p style={{ fontSize: 12, color: C.gris, margin: 0 }}>
            {brouillon.texte.length} / {MAX_TEXTE} caractères
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button color={perime || !rapport ? "primary" : "secondary"} disabled={!complet || encours} onClick={lancerAnalyse}>
              {rapport ? "Réanalyser" : "Analyser"}
            </Button>
            {peutEnregistrer && (
              <Button color={perime ? "secondary" : "primary"} disabled={!complet} onClick={lancerEnregistrement}>
                Enregistrer
              </Button>
            )}
          </div>
          {erreurEnregistrement && <Encart ton="alerte">{erreurEnregistrement}</Encart>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          {encours && (
            <Encart>
              Analyse en cours : les trois agents examinent la fiche, comptez environ
              45 secondes.
            </Encart>
          )}
          {erreurAnalyse && (
            <Encart ton="alerte">
              {MESSAGES[erreurAnalyse] || "Le contrôle n'a pas abouti."} L'enregistrement
              reste possible : un contrôle en panne ne doit pas retenir une fiche.
            </Encart>
          )}
          {perime && (
            <Encart ton="alerte">
              Ce verdict porte sur une version antérieure du texte. Relancer l'analyse avant
              d'enregistrer.
            </Encart>
          )}
          {fiche && (
            <>
              <FicheRapport fiche={fiche} montrerIdentite={false} />
              <p style={{ fontSize: 12, color: C.gris, margin: 0 }}>
                C10 (ancienneté) : sans objet à la rédaction — ce contrôle porte sur la date de
                création, et cette fiche est du jour.
              </p>
            </>
          )}
          {!fiche && !encours && !erreurAnalyse && (
            <p style={{ fontSize: 13, color: C.gris, margin: 0 }}>
              Le verdict s'affichera ici après l'analyse.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
```

Notes d'implémentation :

- La grille `repeat(auto-fit, minmax(320px, 1fr))` bascule en une colonne sous ~700 px **sans media query ni JavaScript** — le navigateur fait le travail.
- **Aucun emoji** : les icônes passent par `<Icone nom="…" />` (Material). Vérifier les noms d'icônes utilisés ailleurs dans `ui.tsx` si `edit_note` ou `check_circle` ne rendent rien.
- Si `Button` de Cunningham n'accepte pas `color="secondary"` dans la version installée, se caler sur ce qu'utilise `AnalyseDemande.tsx`.

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

```bash
npm test -- RedactionFrs
npx tsc -b
```

Attendu : SUCCÈS des 6 tests, aucune erreur de typage.

- [ ] **Step 5: Commit**

```bash
git add src/features/qualite/RedactionFrs.tsx src/features/qualite/RedactionFrs.test.tsx
git commit -m "$(cat <<'EOF'
feat(qualite): écran de rédaction d'une FRS avec contrôle a priori

Saisie à gauche, verdict à droite : corriger sans perdre les remarques de vue.
Enregistrer n'apparaît qu'après une analyse — deux boutons dès la saisie
rendraient le contrôle facultatif. Sauf si l'analyse est tombée : un contrôle
en panne ne doit pas empêcher un militaire de rendre sa fiche.

Modifier le texte ne fait pas disparaître le verdict, il le marque périmé.
Sans ça, on enregistre avec la bénédiction d'une analyse qui portait sur un
autre texte — un contrôle qui rassure à tort est pire que pas de contrôle.

C10 est annoncé sans objet : une fiche du jour n'a pas dix ans, et « 9
contrôles passés » se lirait comme une garantie qui n'a pas été rendue.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: L'onglet « Rédiger »

**Files:**
- Modify: `src/features/qualite/QualiteApp.tsx:32` (type de `vue`), `:65-75` (items d'onglets), et les deux rendus (`if (erreur || !rapport)` et le rendu normal)
- Modify: `src/features/qualite/QualiteApp.test.tsx`

**Interfaces:**
- Consumes: `RedactionFrs` (Task 8).

- [ ] **Step 1: Écrire le test qui échoue**

Dans `src/features/qualite/QualiteApp.test.tsx`, ajouter :

```tsx
it("donne accès à la rédaction, même sans rapport nocturne", async () => {
  // Même raison que pour l'analyse à la demande : un jour sans batch ne doit pas rendre la
  // rédaction inatteignable — ce serait attendre la nuit pour écrire une fiche.
  render(<QualiteApp />); // le mock de fetchRapport de ce fichier rend une erreur
  fireEvent.click(await screen.findByRole("button", { name: /Rédiger/ }));
  expect(await screen.findByLabelText(/Titre/)).toBeInTheDocument();
});
```

Reprendre le harnais de montage et les mocks déjà en place en tête de `QualiteApp.test.tsx` ; ajouter `fireEvent` à l'import depuis `@testing-library/react` s'il n'y est pas. Si le mock global de `fetch` du fichier ne couvre pas `/api/rens/referentiel`, `RedactionFrs` rendra une liste de rattachements vide — le test n'en dépend pas.

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

```bash
npm test -- QualiteApp
```

Attendu : ÉCHEC — aucun bouton « Rédiger ».

- [ ] **Step 3: Ajouter l'onglet**

Dans `QualiteApp.tsx` :

```tsx
const [vue, setVue] = useState<"fiches" | "unites" | "analyse" | "rediger">("fiches");
```

```tsx
      items={[
        { cle: "fiches", libelle: "Fiches à traiter", icone: "assignment" },
        { cle: "unites", libelle: "Par unité", icone: "groups" },
        { cle: "analyse", libelle: "Analyse à la demande", icone: "playlist_add_check" },
        { cle: "rediger", libelle: "Rédiger", icone: "edit_note" },
      ]}
```

Dans la branche d'erreur, à côté de `{vue === "analyse" && <AnalyseDemande />}` :

```tsx
        {vue === "rediger" && <RedactionFrs />}
```

Et la même ligne dans le rendu normal, là où les autres vues sont rendues.

- [ ] **Step 4: Lancer les tests et le typecheck**

```bash
npm test -- QualiteApp
npx tsc -b
```

Attendu : SUCCÈS.

- [ ] **Step 5: Faire tourner toute la vérification**

```bash
npm test
npx tsc -b
node --test 'server/*.test.mjs'
cd server/rens-api && node --test 'audit/*.test.mjs' 'audit/*.test.js' 'migrations/*.test.mjs' 'redaction.test.js' 'fiches.test.js'
```

Attendu : tout au vert.

- [ ] **Step 6: Commit**

```bash
git add src/features/qualite/QualiteApp.tsx src/features/qualite/QualiteApp.test.tsx
git commit -m "$(cat <<'EOF'
feat(qualite): onglet Rédiger dans la page qualité

La rédaction vit dans la même page que l'audit : rédacteur et contrôleur
regardent la même grille. Les séparer en deux écrans donnerait deux produits,
et c'est par là que les deux vérités reviennent.

Accessible même sans rapport nocturne, comme l'analyse à la demande : un jour
sans batch ne doit pas rendre la rédaction inatteignable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Après le plan — à faire hors code

1. **Déploiement de la migration 009** puis `ALTER ROLE rens_redaction PASSWORD '…'` sur le VPS OVH, et pose de `PGUSER_REDACTION` / `PGPASSWORD_REDACTION` dans le compose du service `rens-api`. Sans ces variables, `POST /frs` répond `503 ecriture_indisponible` — un échec explicite, pas une écriture avec le mauvais rôle.
2. **Vérifier la sortie réelle du workflow sur un brouillon** : les agents doivent rendre leurs entrées avec `frs_id: 0`. Si l'un d'eux renvoie un autre identifiant, `parseSortieAgents` les rejettera **toutes** et le rapport sera vide — ce qui se lirait comme « conforme ». Contrôler le compteur `resume.rejets` au premier tir de recette.
3. **Rappel** : le prompt LÉGALITÉ mis à jour (atteinte potentielle) doit être collé dans la console IAka. Le fichier `docs/iaka-qualite-workflow.md` est une transcription et ne change rien à l'exécution.
