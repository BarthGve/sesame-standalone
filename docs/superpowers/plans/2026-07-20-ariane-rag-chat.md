# Ariane RAG + chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingérer les pièces d'une procédure dans un corpus RAG IAka en parallèle du MAP, et ajouter un onglet Questions qui interroge ce corpus en streaming.

**Architecture:** Un module isolé `server/ariane-rag.mjs` (purge / ingestion / chat), cousu au pipeline existant en un seul point (`runAriane` dans `server/ariane.mjs`). Deux routes BFF nouvelles, dont une en SSE. Côté front, un 6e onglet alimenté par un client SSE séparé du client d'analyse.

**Tech Stack:** Node 24 natif (pas de framework, `node --test`), React 19 + TS + Vitest, API IAka (REST `/rag/*` + endpoint OpenAI-compatible).

**Spec:** `docs/superpowers/specs/2026-07-20-ariane-rag-chat-design.md`

## Global Constraints

- **La purge est destructive et irréversible.** `purgeCorpus` supprime tous les documents du corpus `IAKA_RAG_CORPUS_ID`. Ce corpus doit être dédié à la démo Ariane.
- **Le RAG ne casse jamais l'analyse.** Aucune erreur RAG ne doit faire échouer un job : elles alimentent `job.rag.erreur`, jamais `job.error`.
- **Aucun emoji dans le front** (CLAUDE.md). Icônes Material (`<span className="material-icons">`) ou SVG.
- Serveur : ESM `.mjs`, tests `node --test`, `fetchImpl` injecté pour les tests.
- Front : tests Vitest (`npm test`), `fetchImpl` injecté de la même façon (cf. `arianeApi.ts`).
- Commentaires et libellés en français, comme le reste du code.

---

### Task 1: Prérequis — figer les formats réels de l'API RAG

Le plan code contre des formats de réponse que la doc fournie ne montre pas (`GET /rag/documents` notamment). Cette tâche les constate sur l'API réelle avant d'écrire du code contre des suppositions.

**Files:**
- Create: `scripts/probe-rag.mjs`
- Modify: `.env` (non versionné), `.env.example`
- Modify: `docs/superpowers/specs/2026-07-20-ariane-rag-chat-design.md` (§3, consigner les formats observés)

**Interfaces:**
- Consumes: rien
- Produits: les valeurs d'environnement `IAKA_RAG_BASE_URL`, `IAKA_RAG_CORPUS_ID`, `IAKA_RAG_IAK_ID` et la forme réelle de la liste de documents, consommées par la Task 2.

- [ ] **Step 1: Obtenir un corpus dédié**

Action humaine, à faire avant tout code : créer (ou désigner) dans IAka un corpus **dédié à la démo Ariane**, et un IAK orienté procédure judiciaire. Relever les trois valeurs.

**Ne pas continuer avec un corpus partagé avec un autre usage** — la Task 2 y videra tout.

- [ ] **Step 2: Renseigner .env et .env.example**

Dans `.env` (secrets, jamais commité) :

```
IAKA_RAG_BASE_URL=<base de l'API OpenAI-compatible>
IAKA_RAG_CORPUS_ID=<corpus DEDIE a la demo Ariane>
IAKA_RAG_IAK_ID=<iak procedure judiciaire>
```

Dans `.env.example` (commité, valeurs vides) :

```
# RAG Ariane — ATTENTION : le corpus est PURGE a chaque analyse, le dedier a la demo
IAKA_RAG_BASE_URL=
IAKA_RAG_CORPUS_ID=
IAKA_RAG_IAK_ID=
```

- [ ] **Step 3: Écrire la sonde**

Créer `scripts/probe-rag.mjs` :

```js
// Sonde de l'API RAG IAka : constate les formats de reponse avant de coder contre.
// Lecture seule — n'ingere pas, ne supprime pas.
const base = process.env.IAKA_BASE_URL;
const corpusId = process.env.IAKA_RAG_CORPUS_ID;
const headers = { Authorization: `Bearer ${process.env.IAKA_JWT}` };

if (!corpusId) throw new Error("IAKA_RAG_CORPUS_ID absent");

const res = await fetch(`${base}/rag/documents?corpus_id=${encodeURIComponent(corpusId)}`, { headers });
console.log("GET /rag/documents →", res.status);
const body = await res.text();
console.log(body.slice(0, 2000));

// L'endpoint de chat vit sur un AUTRE hote (IAKA_RAG_BASE_URL) et l'exemple OpenAI
// parle d'un « Mon Token » qui n'est pas forcement IAKA_JWT. On le sonde ici pour que
// cette hypothese casse maintenant, pas trois taches plus loin.
const ragBase = process.env.IAKA_RAG_BASE_URL;
const iakId = process.env.IAKA_RAG_IAK_ID;
const chatRes = await fetch(`${ragBase}/corpus/${corpusId}/iak/${iakId}/v1/chat/completions`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: process.env.IAKA_RAG_MODEL || "mistral-small",
    messages: [{ role: "user", content: "Reponds OK." }],
    max_tokens: 20,
    stream: false,
  }),
});
console.log("\nPOST chat/completions →", chatRes.status);
console.log((await chatRes.text()).slice(0, 1000));
```

- [ ] **Step 4: Lancer la sonde**

Run: `node --env-file=.env scripts/probe-rag.mjs`

Expected: deux statuts `200`. Relever trois choses :
1. la liste est-elle un tableau nu (`[...]`) ou enveloppée (`{"documents":[...]}`) ?
2. le champ du hash s'appelle-t-il `file_hash`, `hash`, ou autre ?
3. le chat répond-il avec le **même** `IAKA_JWT` que les workflows ?

Si l'un des deux appels n'est pas en 200, s'arrêter là. En particulier sur le chat : un `401`/`403` signifie que le « Mon Token » de l'exemple OpenAI est une autre clé que `IAKA_JWT` — il faut alors ajouter `IAKA_RAG_TOKEN` à la configuration (Task 5) et l'utiliser dans `chatStream` (Task 4) à la place de `cfg.jwt`. Un `404` pointe une erreur de `IAKA_RAG_BASE_URL` ou de `IAKA_RAG_IAK_ID`.

- [ ] **Step 5: Consigner dans la spec**

Ajouter en fin de §3 de la spec un bloc avec la réponse réelle observée, par exemple :

```markdown
Format constaté de `GET /rag/documents` (sonde du 2026-07-20) :

```jsonc
{ "documents": [ { "file_hash": "…", "filename": "…" } ] }
```
```

`hashesDepuisListe` (Task 2) accepte les deux formes, mais la forme réelle doit être écrite ici pour que le lecteur suivant n'ait pas à re-sonder.

- [ ] **Step 6: Commit**

```bash
git add scripts/probe-rag.mjs .env.example docs/superpowers/specs/2026-07-20-ariane-rag-chat-design.md
git commit -m "chore(ariane): sonde API RAG et variables d'environnement"
```

---

### Task 2: Module RAG — purge et ingestion

**Files:**
- Create: `server/ariane-rag.mjs`
- Test: `server/ariane-rag.test.mjs`

**Interfaces:**
- Consumes: `cfg` du proxy, étendu en Task 5 avec `ragBaseUrl`, `ragCorpusId`, `ragIakId`, `ragModel`, `ragMaxTokens`.
- Produces:
  - `ragActif(cfg) → boolean`
  - `hashesDepuisListe(body) → string[]`
  - `purgeCorpus({ cfg, fetchImpl }) → Promise<number>` (nombre de documents supprimés)
  - `ingestPiece({ file, cote, cfg, fetchImpl }) → Promise<true>`
  - Codes d'erreur levés : `ARIANE_RAG_INDISPONIBLE`, `ARIANE_RAG_PURGE`, `ARIANE_RAG_INGEST`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `server/ariane-rag.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ragActif, hashesDepuisListe, purgeCorpus, ingestPiece } from "./ariane-rag.mjs";

const cfg = {
  baseUrl: "https://iaka.test",
  jwt: "tok",
  ragBaseUrl: "https://iaka-api.test",
  ragCorpusId: "corpus-1",
  ragIakId: "iak-1",
};

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test("ragActif exige corpus, base et iak", () => {
  assert.equal(ragActif(cfg), true);
  assert.equal(ragActif({ ...cfg, ragCorpusId: undefined }), false);
  assert.equal(ragActif({ ...cfg, ragIakId: undefined }), false);
});

test("hashesDepuisListe accepte le tableau nu et la forme enveloppee", () => {
  assert.deepEqual(hashesDepuisListe([{ file_hash: "a" }]), ["a"]);
  assert.deepEqual(hashesDepuisListe({ documents: [{ file_hash: "a" }, { hash: "b" }] }), ["a", "b"]);
  assert.deepEqual(hashesDepuisListe({}), []);
});

test("purgeCorpus liste puis supprime chaque file_hash", async () => {
  const appels = [];
  const fetchImpl = async (url, init) => {
    appels.push(`${init.method} ${url}`);
    if (url.includes("/rag/documents")) return ok({ documents: [{ file_hash: "h1" }, { file_hash: "h2" }] });
    return ok({});
  };
  const n = await purgeCorpus({ cfg, fetchImpl });
  assert.equal(n, 2);
  assert.equal(appels[0], "GET https://iaka.test/rag/documents?corpus_id=corpus-1");
  assert.equal(appels[1], "DELETE https://iaka.test/rag/document?corpus_id=corpus-1&file_hash=h1");
  assert.equal(appels[2], "DELETE https://iaka.test/rag/document?corpus_id=corpus-1&file_hash=h2");
});

test("purgeCorpus sur corpus vide ne supprime rien", async () => {
  const appels = [];
  const fetchImpl = async (url, init) => { appels.push(init.method); return ok({ documents: [] }); };
  assert.equal(await purgeCorpus({ cfg, fetchImpl }), 0);
  assert.deepEqual(appels, ["GET"]);
});

test("purgeCorpus sans corpus configure leve SANS appel reseau", async () => {
  let appele = false;
  const fetchImpl = async () => { appele = true; return ok({}); };
  await assert.rejects(
    () => purgeCorpus({ cfg: { ...cfg, ragCorpusId: undefined }, fetchImpl }),
    /ARIANE_RAG_INDISPONIBLE/,
  );
  assert.equal(appele, false, "garde-fou : aucun appel ne doit partir");
});

test("purgeCorpus propage un echec de suppression", async () => {
  const fetchImpl = async (url) =>
    url.includes("/rag/documents") ? ok({ documents: [{ file_hash: "h1" }] }) : { ok: false, status: 500 };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
});

test("ingestPiece envoie file + corpus_id + metadata en multipart", async () => {
  let recu;
  const fetchImpl = async (url, init) => { recu = { url, init }; return ok({}); };
  const file = { base64: Buffer.from("%PDF-1.4").toString("base64"), mime: "application/pdf", filename: "D12.pdf" };
  assert.equal(await ingestPiece({ file, cote: "D12", cfg, fetchImpl }), true);
  assert.equal(recu.url, "https://iaka.test/rag/ingest");
  assert.equal(recu.init.method, "POST");
  assert.equal(recu.init.body.get("corpus_id"), "corpus-1");
  assert.deepEqual(JSON.parse(recu.init.body.get("metadata")), { cote: "D12" });
  assert.equal(recu.init.body.get("file").name, "D12.pdf");
});

test("ingestPiece en echec leve ARIANE_RAG_INGEST", async () => {
  const fetchImpl = async () => ({ ok: false, status: 502 });
  const file = { base64: "", mime: "application/pdf", filename: "D12.pdf" };
  await assert.rejects(() => ingestPiece({ file, cote: "D12", cfg, fetchImpl }), /ARIANE_RAG_INGEST/);
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `node --test server/ariane-rag.test.mjs`
Expected: FAIL — `Cannot find module './ariane-rag.mjs'`

- [ ] **Step 3: Écrire le module**

Créer `server/ariane-rag.mjs` :

```js
import { Buffer } from "node:buffer";

// Corpus RAG IAka : purge, ingestion des pieces, chat en streaming (chatStream en
// Task 4). Separe de ariane.mjs qui porte le map-reduce : deux sujets, deux modules.

const ragHeaders = (cfg) => ({ Authorization: `Bearer ${cfg.jwt}` });

// Garde-fou : sans corpus configure, aucune operation (a fortiori destructive) ne part.
function corpusRequis(cfg) {
  if (!cfg.ragCorpusId) throw new Error("ARIANE_RAG_INDISPONIBLE");
  return cfg.ragCorpusId;
}

export const ragActif = (cfg) => Boolean(cfg.ragCorpusId && cfg.ragBaseUrl && cfg.ragIakId);

// La liste peut arriver en tableau nu ou enveloppee : on accepte les deux formes.
export function hashesDepuisListe(body) {
  const docs = Array.isArray(body) ? body : (body?.documents ?? []);
  return docs.map((d) => d.file_hash ?? d.hash).filter(Boolean);
}

// DESTRUCTIF : supprime TOUS les documents du corpus, sans distinction d'origine.
// Le corpus doit etre dedie a la demo Ariane (cf. spec, avertissement en tete).
export async function purgeCorpus({ cfg, fetchImpl = globalThis.fetch }) {
  const corpusId = corpusRequis(cfg);
  const q = encodeURIComponent(corpusId);
  const listRes = await fetchImpl(`${cfg.baseUrl}/rag/documents?corpus_id=${q}`, { method: "GET", headers: ragHeaders(cfg) });
  if (!listRes.ok) throw new Error("ARIANE_RAG_PURGE");
  const hashes = hashesDepuisListe(await listRes.json());
  for (const hash of hashes) {
    const url = `${cfg.baseUrl}/rag/document?corpus_id=${q}&file_hash=${encodeURIComponent(hash)}`;
    const delRes = await fetchImpl(url, { method: "DELETE", headers: ragHeaders(cfg) });
    if (!delRes.ok) throw new Error("ARIANE_RAG_PURGE");
  }
  return hashes.length;
}

// Ingere une piece. Reutilise le buffer deja en memoire pour le MAP : cout quasi nul.
export async function ingestPiece({ file, cote, cfg, fetchImpl = globalThis.fetch }) {
  const corpusId = corpusRequis(cfg);
  const form = new FormData();
  const bytes = Buffer.from(file.base64, "base64");
  form.append("file", new Blob([bytes], { type: file.mime || "application/pdf" }), file.filename || `${cote}.pdf`);
  form.set("corpus_id", corpusId);
  form.set("url_source", `ariane://${cote}`);
  form.set("metadata", JSON.stringify({ cote }));
  const res = await fetchImpl(`${cfg.baseUrl}/rag/ingest`, { method: "POST", headers: ragHeaders(cfg), body: form });
  if (!res.ok) throw new Error("ARIANE_RAG_INGEST");
  return true;
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `node --test server/ariane-rag.test.mjs`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add server/ariane-rag.mjs server/ariane-rag.test.mjs
git commit -m "feat(ariane): module RAG — purge et ingestion des pieces"
```

---

### Task 3: Couture au pipeline — purge puis ingestion parallèle au MAP

**Files:**
- Modify: `server/ariane.mjs:214-235` (`runAriane`), `server/ariane.mjs:241-271` (`createJob`, `startJob`)
- Test: `server/ariane.test.mjs` (ajouts en fin de fichier)

**Interfaces:**
- Consumes: `purgeCorpus`, `ingestPiece`, `ragActif` de la Task 2.
- Produces: `runAriane` accepte `onRag` et `deps.purgeCorpus` / `deps.ingestPiece` ; le job expose `job.rag = { indexees, total, erreur }`, consommé par le front en Task 6.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `server/ariane.test.mjs` :

```js
// --- RAG : couture au pipeline (best-effort, jamais bloquant) ---

const cfgRag = {
  mapConcurrency: 2,
  ragBaseUrl: "https://iaka-api.test",
  ragCorpusId: "corpus-1",
  ragIakId: "iak-1",
};

const extractionOk = async ({ cote }) => ({ cote, acte: null, personnes: [], faits: [], relations_lues: [] });
const consolidationOk = async () => ({ affaire: {}, synthese: "s", parties: [], relations: [] });

test("runAriane purge le corpus AVANT toute ingestion", async () => {
  const ordre = [];
  await runAriane({
    files: [{ filename: "D1.pdf", base64: "" }],
    cfg: cfgRag,
    deps: {
      runExtraction: extractionOk,
      runConsolidation: consolidationOk,
      purgeCorpus: async () => { ordre.push("purge"); return 0; },
      ingestPiece: async () => { ordre.push("ingest"); return true; },
    },
  });
  assert.deepEqual(ordre, ["purge", "ingest"]);
});

test("runAriane : purge en echec → aucune ingestion, analyse poursuivie", async () => {
  let ingestions = 0;
  let dernierRag;
  const contrat = await runAriane({
    files: [{ filename: "D1.pdf", base64: "" }],
    cfg: cfgRag,
    onRag: (r) => { dernierRag = r; },
    deps: {
      runExtraction: extractionOk,
      runConsolidation: consolidationOk,
      purgeCorpus: async () => { throw new Error("ARIANE_RAG_PURGE"); },
      ingestPiece: async () => { ingestions++; return true; },
    },
  });
  assert.equal(ingestions, 0, "sans purge reussie on n'ingere pas : risque de melange");
  assert.ok(contrat.parties, "l'analyse doit aboutir malgre l'echec RAG");
  assert.equal(dernierRag.erreur, "ARIANE_RAG_PURGE");
  assert.equal(dernierRag.total, 0);
});

test("runAriane : une ingestion en echec sur trois → indexees 2/3", async () => {
  let dernierRag;
  await runAriane({
    files: [{ filename: "D1.pdf", base64: "" }, { filename: "D2.pdf", base64: "" }, { filename: "D3.pdf", base64: "" }],
    cfg: cfgRag,
    onRag: (r) => { dernierRag = r; },
    deps: {
      runExtraction: extractionOk,
      runConsolidation: consolidationOk,
      purgeCorpus: async () => 0,
      ingestPiece: async ({ cote }) => {
        if (cote === "D2") throw new Error("ARIANE_RAG_INGEST");
        return true;
      },
    },
  });
  assert.deepEqual(dernierRag, { indexees: 2, total: 3, erreur: null });
});

test("runAriane sans RAG configure n'appelle ni purge ni ingestion", async () => {
  let appels = 0;
  let dernierRag;
  await runAriane({
    files: [{ filename: "D1.pdf", base64: "" }],
    cfg: { mapConcurrency: 2 }, // pas de ragCorpusId
    onRag: (r) => { dernierRag = r; },
    deps: {
      runExtraction: extractionOk,
      runConsolidation: consolidationOk,
      purgeCorpus: async () => { appels++; return 0; },
      ingestPiece: async () => { appels++; return true; },
    },
  });
  assert.equal(appels, 0);
  assert.deepEqual(dernierRag, { indexees: 0, total: 0, erreur: null });
});

test("startJob expose le champ rag dans le statut", async () => {
  const jobId = createJob();
  await startJob({
    jobId,
    files: [{ filename: "D1.pdf", base64: "" }],
    cfg: cfgRag,
    deps: {
      runExtraction: extractionOk,
      runConsolidation: consolidationOk,
      purgeCorpus: async () => 0,
      ingestPiece: async () => true,
    },
  });
  const job = getJob(jobId);
  assert.equal(job.status, "done");
  assert.deepEqual(job.rag, { indexees: 1, total: 1, erreur: null });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `node --test server/ariane.test.mjs`
Expected: FAIL — les nouveaux tests échouent (`ordre` vaut `[]`, `dernierRag` vaut `undefined`)

- [ ] **Step 3: Modifier runAriane**

Dans `server/ariane.mjs`, ajouter l'import en tête de fichier (après les imports existants) :

```js
import { ragActif, purgeCorpus, ingestPiece } from "./ariane-rag.mjs";
```

Puis remplacer `runAriane` (lignes 214-235) par :

```js
// Orchestration complète : normalisation → purge RAG → MAP fan-out (best-effort, avec
// ingestion RAG en parallèle) → agrégat → REDUCE → assemblage → validation.
// deps injectables pour les tests.
export async function runAriane({ files, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep, onProgress = () => {}, onRag = () => {}, deps = {} }) {
  const extract = deps.runExtraction || runExtraction;
  const consolidate = deps.runConsolidation || runConsolidation;
  const purge = deps.purgeCorpus || purgeCorpus;
  const ingest = deps.ingestPiece || ingestPiece;
  const units = files.map((file, i) => ({ file, cote: coteFromFilename(file.filename, i) }));
  const total = units.length;

  // Le RAG est un bonus : il ne doit jamais faire échouer l'analyse. Si la purge
  // échoue on n'ingère pas — le corpus contiendrait encore la procédure précédente,
  // et le chat répondrait sur la mauvaise affaire.
  let ragOk = ragActif(cfg);
  const rag = { indexees: 0, total: ragOk ? total : 0, erreur: null };
  if (ragOk) {
    try {
      await purge({ cfg, fetchImpl });
    } catch (e) {
      ragOk = false;
      rag.total = 0;
      rag.erreur = e.message;
    }
  }
  onRag({ ...rag });

  let done = 0;
  const mapResults = await mapPool(units, cfg.mapConcurrency ?? 4, async (u) => {
    // Ingestion lancée AVANT l'attente du MAP : les deux courent en parallèle sur le
    // même buffer. Elle ne rejette jamais (best-effort, comme le MAP).
    const ingestion = ragOk
      ? ingest({ file: u.file, cote: u.cote, cfg, fetchImpl })
          .then(() => { rag.indexees++; })
          .catch(() => { /* pièce non indexée : le ratio indexees/total le porte déjà */ })
      : null;
    let out = null;
    try {
      out = await extract({ file: u.file, cote: u.cote, cfg, fetchImpl, sleep });
    } catch {
      out = null; // best-effort : pièce ignorée
    }
    if (ingestion) {
      await ingestion;
      onRag({ ...rag });
    }
    onProgress({ done: ++done, total });
    return out;
  });

  const mapOutputs = mapResults.filter(Boolean);
  if (mapOutputs.length === 0) throw new Error("ARIANE_UPSTREAM"); // aucune pièce exploitable
  const aggregate = buildAggregate(mapOutputs);
  const reduce = await consolidate({ aggregate, cfg, fetchImpl, sleep });
  return validateContract(assembleContract(mapOutputs, reduce));
}
```

`rag.erreur` ne signale qu'une panne globale (purge en échec). Une pièce isolée non indexée n'y touche pas : le ratio `indexees/total` porte déjà cette information, et le test « une ingestion en échec sur trois » attend bien `erreur: null`.

- [ ] **Step 4: Modifier createJob et startJob**

Dans `server/ariane.mjs`, remplacer `createJob` (ligne 241) par :

```js
export function createJob() {
  const jobId = randomUUID();
  jobs.set(jobId, { status: "pending", progress: { done: 0, total: 0 }, rag: { indexees: 0, total: 0, erreur: null } });
  return jobId;
}
```

Et dans `startJob`, ajouter le relais `onRag` à l'appel de `runAriane` :

```js
    const contract = await runAriane({
      files, cfg, fetchImpl, deps,
      onProgress: (p) => {
        job.progress = p;
        if (p.done === p.total && p.total > 0) job.status = "reduce";
      },
      onRag: (r) => { job.rag = r; },
    });
```

- [ ] **Step 5: Lancer toute la suite serveur**

Run: `node --test server/ariane.test.mjs server/ariane-rag.test.mjs`
Expected: PASS — 22 tests existants + 5 nouveaux + 8 de la Task 2

- [ ] **Step 6: Commit**

```bash
git add server/ariane.mjs server/ariane.test.mjs
git commit -m "feat(ariane): purge du corpus puis ingestion RAG en parallele du MAP"
```

---

### Task 4: Chat en streaming — chatStream

**Files:**
- Modify: `server/ariane-rag.mjs` (ajout en fin de fichier)
- Test: `server/ariane-rag.test.mjs` (ajouts en fin de fichier)

**Interfaces:**
- Consumes: `corpusRequis`, `cfg.ragBaseUrl`, `cfg.ragIakId`, `cfg.ragModel`, `cfg.ragMaxTokens`.
- Produces: `chatStream({ messages, cfg, fetchImpl, onDelta }) → Promise<void>`, lève `ARIANE_RAG_CHAT`.

Note d'écart avec la spec §5 : la signature retenue est `onDelta` (callback) plutôt que l'objet `res` de la réponse HTTP. Passer `res` rendrait le module dépendant du serveur HTTP et impossible à tester sans socket ; c'est la route (Task 5) qui branche `onDelta` sur `res.write`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `server/ariane-rag.test.mjs` (l'import en tête devient `import { ragActif, hashesDepuisListe, purgeCorpus, ingestPiece, chatStream } from "./ariane-rag.mjs";`) :

```js
// Fabrique un corps de reponse SSE asynchrone, comme celui d'undici.
function corpsSSE(morceaux) {
  const encoder = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of morceaux) yield encoder.encode(m);
    },
  };
}

const trameDelta = (txt) => `data: ${JSON.stringify({ choices: [{ delta: { content: txt } }] })}\n\n`;

test("chatStream relaie les deltas dans l'ordre", async () => {
  const recus = [];
  const fetchImpl = async () => ({ ok: true, body: corpsSSE([trameDelta("Bon"), trameDelta("jour"), "data: [DONE]\n\n"]) });
  await chatStream({ messages: [{ role: "user", content: "salut" }], cfg, fetchImpl, onDelta: (d) => recus.push(d) });
  assert.deepEqual(recus, ["Bon", "jour"]);
});

test("chatStream reconstitue une trame coupee entre deux morceaux", async () => {
  const recus = [];
  const trame = trameDelta("Bonjour");
  const coupe = [trame.slice(0, 20), trame.slice(20), "data: [DONE]\n\n"];
  const fetchImpl = async () => ({ ok: true, body: corpsSSE(coupe) });
  await chatStream({ messages: [{ role: "user", content: "x" }], cfg, fetchImpl, onDelta: (d) => recus.push(d) });
  assert.deepEqual(recus, ["Bonjour"]);
});

test("chatStream cible l'endpoint corpus+iak et demande le streaming", async () => {
  let recu;
  const fetchImpl = async (url, init) => { recu = { url, init }; return { ok: true, body: corpsSSE(["data: [DONE]\n\n"]) }; };
  await chatStream({ messages: [{ role: "user", content: "x" }], cfg, fetchImpl, onDelta: () => {} });
  assert.equal(recu.url, "https://iaka-api.test/corpus/corpus-1/iak/iak-1/v1/chat/completions");
  const body = JSON.parse(recu.init.body);
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [{ role: "user", content: "x" }]);
});

test("chatStream en echec amont leve ARIANE_RAG_CHAT", async () => {
  const fetchImpl = async () => ({ ok: false, status: 502 });
  await assert.rejects(
    () => chatStream({ messages: [{ role: "user", content: "x" }], cfg, fetchImpl, onDelta: () => {} }),
    /ARIANE_RAG_CHAT/,
  );
});

test("chatStream ignore les lignes non-JSON (keep-alive)", async () => {
  const recus = [];
  const fetchImpl = async () => ({ ok: true, body: corpsSSE([": ping\n\n", trameDelta("ok"), "data: [DONE]\n\n"]) });
  await chatStream({ messages: [{ role: "user", content: "x" }], cfg, fetchImpl, onDelta: (d) => recus.push(d) });
  assert.deepEqual(recus, ["ok"]);
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `node --test server/ariane-rag.test.mjs`
Expected: FAIL — `chatStream is not a function`

- [ ] **Step 3: Implémenter chatStream**

Ajouter en fin de `server/ariane-rag.mjs` :

```js
// Chat RAG : l'endpoint OpenAI-compatible fait la recherche et la generation, on ne
// gere que l'historique et le relais du flux. onDelta plutot que la reponse HTTP :
// le module reste testable sans socket, la route branche onDelta sur res.write.
export async function chatStream({ messages, cfg, fetchImpl = globalThis.fetch, onDelta }) {
  const corpusId = corpusRequis(cfg);
  const url = `${cfg.ragBaseUrl}/corpus/${corpusId}/iak/${cfg.ragIakId}/v1/chat/completions`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.ragModel,
      messages,
      temperature: 0.1,
      max_tokens: cfg.ragMaxTokens,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) throw new Error("ARIANE_RAG_CHAT");

  const decoder = new TextDecoder();
  let tampon = "";
  for await (const morceau of res.body) {
    tampon += decoder.decode(morceau, { stream: true });
    const lignes = tampon.split("\n");
    tampon = lignes.pop() ?? ""; // derniere ligne peut-etre incomplete : on la garde
    for (const ligne of lignes) {
      if (!ligne.startsWith("data:")) continue; // commentaires SSE, lignes vides
      const data = ligne.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      } catch {
        // trame non-JSON (keep-alive) : ignoree
      }
    }
  }
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `node --test server/ariane-rag.test.mjs`
Expected: PASS — 13 tests

- [ ] **Step 5: Commit**

```bash
git add server/ariane-rag.mjs server/ariane-rag.test.mjs
git commit -m "feat(ariane): chatStream — relais du flux RAG en SSE"
```

---

### Task 5: Routes BFF et configuration

**Files:**
- Modify: `server/proxy.mjs:13-25` (`ERROR_STATUS`), `server/proxy.mjs:295-325` (voisinage des routes Ariane), `server/proxy.mjs:485-516` (`cfg`)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `purgeCorpus`, `chatStream` des Tasks 2 et 4.
- Produces: `POST /api/ariane/chat` (SSE), `POST /api/ariane/corpus/purge` (JSON `{ supprimes }`), et les clés `cfg.ragBaseUrl` / `ragCorpusId` / `ragIakId` / `ragModel` / `ragMaxTokens`.

Ces routes n'ont pas de test automatisé : le fichier `server/proxy.mjs` n'a pas de suite de tests dans le dépôt, et son handler n'est pas exporté isolément. La logique testable vit dans `ariane-rag.mjs` (Tasks 2 et 4) ; les routes sont du câblage, vérifié manuellement au Step 5.

- [ ] **Step 1: Ajouter les codes d'erreur**

Dans `server/proxy.mjs`, ajouter à l'objet `ERROR_STATUS` (après les entrées Ariane existantes) :

```js
  ARIANE_RAG_PURGE: 502,
  ARIANE_RAG_INGEST: 502,
  ARIANE_RAG_CHAT: 502,
  ARIANE_RAG_INDISPONIBLE: 503,
```

- [ ] **Step 2: Étendre l'import et la configuration**

Modifier l'import Ariane en tête de `server/proxy.mjs` (ligne 7 actuellement) en ajoutant une ligne :

```js
import { purgeCorpus, chatStream } from "./ariane-rag.mjs";
```

Puis dans l'objet `cfg` (après `mapConcurrency`, ligne 496) :

```js
    // RAG Ariane — le corpus est PURGE a chaque analyse, le dedier a la demo.
    ragBaseUrl: process.env.IAKA_RAG_BASE_URL,
    ragCorpusId: process.env.IAKA_RAG_CORPUS_ID,
    ragIakId: process.env.IAKA_RAG_IAK_ID,
    ragModel: process.env.IAKA_RAG_MODEL || "mistral-small",
    ragMaxTokens: Number(process.env.IAKA_RAG_MAX_TOKENS ?? 28000),
```

- [ ] **Step 3: Ajouter la route de chat SSE**

Dans `server/proxy.mjs`, juste après le bloc `/api/ariane/status` (qui se termine ligne 325) :

```js
    if (url.pathname === "/api/ariane/chat" && req.method === "POST") {
      const raw = await readBody(req);
      let messages;
      try {
        ({ messages } = JSON.parse(raw || "{}"));
      } catch {
        messages = null;
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "MESSAGES_REQUIS" }));
        return;
      }
      // SSE : l'en-tete part avant le premier octet de reponse du modele, le front
      // affiche donc immediatement une bulle vide qui se remplit.
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      try {
        await chatStream({
          messages,
          cfg,
          fetchImpl,
          onDelta: (delta) => res.write(`data: ${JSON.stringify({ delta })}\n\n`),
        });
        res.write("data: [DONE]\n\n");
      } catch (e) {
        // Le statut HTTP est deja parti : l'erreur passe dans le flux.
        if (!(e.message in ERROR_STATUS)) console.error(e.message);
        const code = e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR";
        res.write(`event: error\ndata: ${JSON.stringify({ error: code })}\n\n`);
      }
      res.end();
      return;
    }

    if (url.pathname === "/api/ariane/corpus/purge" && req.method === "POST") {
      try {
        const supprimes = await purgeCorpus({ cfg, fetchImpl });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ supprimes }));
      } catch (e) {
        if (!(e.message in ERROR_STATUS)) console.error(e.message);
        res.writeHead(ERROR_STATUS[e.message] ?? 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
```

- [ ] **Step 4: Compléter .env.example**

Ajouter, sous les lignes Ariane existantes :

```
IAKA_RAG_MODEL=mistral-small
IAKA_RAG_MAX_TOKENS=28000
```

- [ ] **Step 5: Vérification manuelle**

Relancer le proxy, puis interroger la route de chat :

```bash
npm run proxy   # dans un terminal
curl -N -X POST http://localhost:8787/api/ariane/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Bonjour"}]}'
```

Expected: une suite de lignes `data: {"delta":"…"}` qui arrivent progressivement, puis `data: [DONE]`. Si `event: error` apparaît, lire le code : `ARIANE_RAG_INDISPONIBLE` = corpus non configuré, `ARIANE_RAG_CHAT` = échec amont (vérifier `IAKA_RAG_BASE_URL` et `IAKA_RAG_IAK_ID`).

Vérifier ensuite que la purge répond, **sur le corpus dédié uniquement** :

```bash
curl -s -X POST http://localhost:8787/api/ariane/corpus/purge
```

Expected: `{"supprimes":N}`.

- [ ] **Step 6: Commit**

```bash
git add server/proxy.mjs .env.example
git commit -m "feat(ariane): routes /api/ariane/chat (SSE) et /corpus/purge"
```

---

### Task 6: Client front — SSE et état du chat

**Files:**
- Create: `src/features/ariane/arianeChatApi.ts`
- Create: `src/features/ariane/arianeChatApi.test.ts`
- Modify: `src/features/ariane/arianeStore.ts`
- Modify: `src/features/ariane/arianeStore.test.ts`
- Modify: `src/features/ariane/arianeApi.ts:11` (type `JobStatus`)

**Interfaces:**
- Consumes: routes de la Task 5, champ `rag` du statut de job (Task 3).
- Produces:
  - `ChatMessage = { role: "user" | "assistant"; content: string }`
  - `streamChat(messages, onDelta, fetchImpl) → Promise<void>`
  - `purgeCorpusApi(fetchImpl) → Promise<number>`
  - Store : `ask(question)`, `viderTout(deps)`, état `messages` / `streaming` / `rag`.

- [ ] **Step 1: Écrire les tests du client SSE**

Créer `src/features/ariane/arianeChatApi.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { streamChat, purgeCorpusApi } from "./arianeChatApi";

function reponseSSE(morceaux: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          i < morceaux.length ? { done: false, value: encoder.encode(morceaux[i++]) } : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

const trame = (d: string) => `data: ${JSON.stringify({ delta: d })}\n\n`;

describe("streamChat", () => {
  it("accumule les deltas dans l'ordre", async () => {
    const recus: string[] = [];
    const fetchImpl = (async () => reponseSSE([trame("Bon"), trame("jour"), "data: [DONE]\n\n"])) as unknown as typeof fetch;
    await streamChat([{ role: "user", content: "salut" }], (d) => recus.push(d), fetchImpl);
    expect(recus).toEqual(["Bon", "jour"]);
  });

  it("reconstitue une trame coupee entre deux morceaux", async () => {
    const recus: string[] = [];
    const t = trame("Bonjour");
    const fetchImpl = (async () => reponseSSE([t.slice(0, 12), t.slice(12), "data: [DONE]\n\n"])) as unknown as typeof fetch;
    await streamChat([{ role: "user", content: "x" }], (d) => recus.push(d), fetchImpl);
    expect(recus).toEqual(["Bonjour"]);
  });

  it("leve sur event: error", async () => {
    const fetchImpl = (async () => reponseSSE(["event: error\ndata: {\"error\":\"ARIANE_RAG_CHAT\"}\n\n"])) as unknown as typeof fetch;
    await expect(streamChat([{ role: "user", content: "x" }], () => {}, fetchImpl)).rejects.toThrow("ARIANE_RAG_CHAT");
  });

  it("leve si la reponse n'est pas ok", async () => {
    const fetchImpl = (async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    await expect(streamChat([{ role: "user", content: "x" }], () => {}, fetchImpl)).rejects.toThrow("ARIANE_RAG_CHAT");
  });
});

describe("purgeCorpusApi", () => {
  it("rend le nombre de documents supprimes", async () => {
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ supprimes: 3 }) }) as Response) as unknown as typeof fetch;
    expect(await purgeCorpusApi(fetchImpl)).toBe(3);
  });

  it("leve ARIANE_RAG_PURGE si la route echoue", async () => {
    const fetchImpl = (async () => ({ ok: false, json: async () => ({ error: "ARIANE_RAG_PURGE" }) }) as Response) as unknown as typeof fetch;
    await expect(purgeCorpusApi(fetchImpl)).rejects.toThrow("ARIANE_RAG_PURGE");
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npm test -- arianeChatApi`
Expected: FAIL — module `./arianeChatApi` introuvable

- [ ] **Step 3: Écrire le client**

Créer `src/features/ariane/arianeChatApi.ts` :

```ts
// Client du chat RAG : POST /api/ariane/chat en SSE, et purge du corpus.
// Separe de arianeApi.ts (analyse) : deux surfaces, comme cote serveur.

export type ChatMessage = { role: "user" | "assistant"; content: string };

export async function streamChat(
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl("/api/ariane/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok || !res.body) throw new Error("ARIANE_RAG_CHAT");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let tampon = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    tampon += decoder.decode(value, { stream: true });
    const lignes = tampon.split("\n");
    tampon = lignes.pop() ?? ""; // derniere ligne peut-etre incomplete
    for (const ligne of lignes) {
      if (ligne.startsWith("event: error")) throw new Error("ARIANE_RAG_CHAT");
      if (!ligne.startsWith("data:")) continue;
      const data = ligne.slice(5).trim();
      if (data === "[DONE]") return;
      const { delta } = JSON.parse(data) as { delta?: string };
      if (delta) onDelta(delta);
    }
  }
}

export async function purgeCorpusApi(fetchImpl: typeof fetch = fetch): Promise<number> {
  const res = await fetchImpl("/api/ariane/corpus/purge", { method: "POST" });
  if (!res.ok) throw new Error("ARIANE_RAG_PURGE");
  const { supprimes } = (await res.json()) as { supprimes?: number };
  return supprimes ?? 0;
}
```

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `npm test -- arianeChatApi`
Expected: PASS — 6 tests

- [ ] **Step 5: Écrire les tests du store**

Ajouter à `src/features/ariane/arianeStore.test.ts` :

```ts
import { ask, viderTout, resetChat, seedRagForTest } from "./arianeStore";

describe("chat", () => {
  it("ask accumule les deltas dans le dernier message assistant", async () => {
    resetChat();
    await ask("Qui est mis en cause ?", {
      stream: async (_messages, onDelta) => { onDelta("Jean "); onDelta("DUPONT"); },
    });
    const { messages, streaming } = snapshotForTest();
    expect(messages).toEqual([
      { role: "user", content: "Qui est mis en cause ?" },
      { role: "assistant", content: "Jean DUPONT" },
    ]);
    expect(streaming).toBe(false);
  });

  it("ask conserve le texte deja recu si le flux casse", async () => {
    resetChat();
    await ask("x", {
      stream: async (_messages, onDelta) => { onDelta("debut"); throw new Error("ARIANE_RAG_CHAT"); },
    });
    const { messages, error } = snapshotForTest();
    expect(messages[1].content).toBe("debut");
    expect(error).toBeTruthy();
  });

  // seedRagForTest est indispensable ici : viderTout ne purge que si rag.total > 0
  // (sinon un clic sur Vider sans RAG configuré declencherait un 503 inutile), et
  // seul run() renseigne rag en vrai.
  it("viderTout purge le corpus avant de reinitialiser", async () => {
    seedRagForTest({ indexees: 2, total: 2, erreur: null });
    const ordre: string[] = [];
    await viderTout({ purge: async () => { ordre.push("purge"); return 1; } });
    expect(ordre).toEqual(["purge"]);
    expect(snapshotForTest().dossier).toBeUndefined();
  });

  it("viderTout ne purge pas quand aucune piece n'est indexee", async () => {
    seedRagForTest({ indexees: 0, total: 0, erreur: null });
    let appelee = false;
    await viderTout({ purge: async () => { appelee = true; return 0; } });
    expect(appelee).toBe(false);
  });

  it("viderTout n'efface pas l'ecran si la purge echoue", async () => {
    resetChat();
    seedRagForTest({ indexees: 2, total: 2, erreur: null });
    await ask("x", { stream: async (_m, onDelta) => onDelta("reponse") });
    await viderTout({ purge: async () => { throw new Error("ARIANE_RAG_PURGE"); } });
    const { messages, error } = snapshotForTest();
    expect(messages.length).toBe(2);
    expect(error).toBeTruthy();
  });
});
```

- [ ] **Step 6: Lancer pour vérifier l'échec**

Run: `npm test -- arianeStore`
Expected: FAIL — `ask is not a function`

- [ ] **Step 7: Étendre le store**

Dans `src/features/ariane/arianeApi.ts`, étendre le type `JobStatus` (ligne 11) :

```ts
export type RagEtat = { indexees: number; total: number; erreur: string | null };
export type JobStatus = { status: string; progress: { done: number; total: number }; rag?: RagEtat; result?: Dossier; error?: string };
```

Dans `src/features/ariane/arianeStore.ts` :

1. Étendre les imports :

```ts
import { encodePiece, startAnalyse, fetchStatus, type Dossier, type RagEtat } from "./arianeApi";
import { streamChat, purgeCorpusApi, type ChatMessage } from "./arianeChatApi";
```

2. Ajouter la vue et les messages d'erreur :

```ts
export type ViewKey = "synthese" | "parties" | "faits" | "actes" | "reseau" | "questions";
```

Dans `MESSAGES` :

```ts
  ARIANE_RAG_CHAT: "Le service de questions est indisponible. Réessayez.",
  ARIANE_RAG_PURGE: "Les documents n'ont pas pu être retirés du corpus. Vérifiez avant de relancer une démonstration.",
  ARIANE_RAG_INDISPONIBLE: "Questions indisponibles : corpus non configuré.",
```

3. Étendre l'état :

```ts
const RAG_VIDE: RagEtat = { indexees: 0, total: 0, erreur: null };

export type ArianeState = {
  pieces: File[];
  running: boolean;
  statusLabel: string;
  progress: { done: number; total: number };
  dossier?: Dossier;
  error?: string;
  view: ViewKey;
  selectedCote?: string;
  rag: RagEtat;
  messages: ChatMessage[];
  streaming: boolean;
};

const store = createPersistedStore<ArianeState>({
  pieces: [], running: false, statusLabel: "", progress: { done: 0, total: 0 }, view: "synthese",
  rag: RAG_VIDE, messages: [], streaming: false,
});
```

4. Dans `run`, propager `rag` à chaque poll — remplacer la ligne `store.set({ progress: ... })` par :

```ts
      store.set({ progress: snap.progress ?? store.get().progress, statusLabel: statusLabel(snap.status), rag: snap.rag ?? store.get().rag });
```

Et dans le `store.set` initial de `run`, réinitialiser le chat :

```ts
    store.set({ running: true, error: undefined, dossier: undefined, selectedCote: undefined, statusLabel: "Préparation…", progress: { done: 0, total: pieces.length }, rag: RAG_VIDE, messages: [], streaming: false });
```

5. Ajouter les actions en fin de fichier, avant `export const useAriane` :

```ts
export function resetChat() {
  store.set({ messages: [], streaming: false, error: undefined });
}

type AskDeps = { stream?: typeof streamChat };

// Ajoute la question, puis remplit le message assistant au fil du flux. En cas de
// coupure on garde le texte deja recu : mieux qu'une bulle vide.
export async function ask(question: string, deps: AskDeps = {}) {
  const stream = deps.stream ?? streamChat;
  const { messages, streaming } = store.get();
  if (streaming || !question.trim()) return;
  const historique: ChatMessage[] = [...messages, { role: "user", content: question }];
  store.set({ messages: [...historique, { role: "assistant", content: "" }], streaming: true, error: undefined });
  try {
    await stream(historique, (delta) => {
      const courant = store.get().messages;
      const dernier = courant[courant.length - 1];
      store.set({ messages: [...courant.slice(0, -1), { ...dernier, content: dernier.content + delta }] });
    });
    store.set({ streaming: false });
  } catch (e) {
    store.set({ streaming: false, error: msg((e as Error).message) });
  }
}

type ViderDeps = { purge?: typeof purgeCorpusApi };

// Vide l'ecran ET le corpus. Si la purge echoue on NE reinitialise pas : sinon la
// demo suivante repondrait sur l'affaire precedente sans que personne le voie.
export async function viderTout(deps: ViderDeps = {}) {
  const purge = deps.purge ?? purgeCorpusApi;
  try {
    if (store.get().rag.total > 0) await purge();
    reset();
    store.set({ rag: RAG_VIDE, messages: [], streaming: false });
  } catch (e) {
    store.set({ error: msg((e as Error).message) });
  }
}
```

6. Ajouter le point d'amorçage de test, juste après `snapshotForTest` en fin de fichier :

```ts
// Seul run() renseigne `rag` en fonctionnement normal. Les tests de viderTout ont
// besoin d'un corpus non vide pour franchir la garde `rag.total > 0` : ce seam evite
// d'y rejouer tout le pipeline.
export function seedRagForTest(rag: RagEtat) {
  store.set({ rag });
}
```

- [ ] **Step 8: Lancer pour vérifier le succès**

Run: `npm test -- arianeStore arianeChatApi`
Expected: PASS — les 5 nouveaux tests du store et les 6 du client

- [ ] **Step 9: Commit**

```bash
git add src/features/ariane/arianeChatApi.ts src/features/ariane/arianeChatApi.test.ts src/features/ariane/arianeStore.ts src/features/ariane/arianeStore.test.ts src/features/ariane/arianeApi.ts
git commit -m "feat(ariane): client SSE du chat et etat de conversation"
```

---

### Task 7: Onglet Questions

**Files:**
- Create: `src/features/ariane/ChatView.tsx`
- Create: `src/features/ariane/ChatView.test.tsx`
- Modify: `src/features/ariane/ArianeApp.tsx:11-17` (TABS), `:30-33` (`vider`), `:93-99` (rendu des vues)

**Interfaces:**
- Consumes: `ask`, `viderTout`, `useAriane` (état `messages`, `streaming`, `rag`) de la Task 6.
- Produces: rien (feuille de l'arbre).

- [ ] **Step 1: Écrire les tests de la vue**

Créer `src/features/ariane/ChatView.test.tsx` :

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatView from "./ChatView";

describe("ChatView", () => {
  it("affiche les messages de la conversation", () => {
    render(<ChatView messages={[{ role: "user", content: "Qui est mis en cause ?" }, { role: "assistant", content: "Jean DUPONT" }]} streaming={false} rag={{ indexees: 3, total: 3, erreur: null }} onAsk={() => {}} />);
    expect(screen.getByText("Qui est mis en cause ?")).toBeTruthy();
    expect(screen.getByText("Jean DUPONT")).toBeTruthy();
  });

  it("signale une indexation partielle", () => {
    render(<ChatView messages={[]} streaming={false} rag={{ indexees: 2, total: 3, erreur: null }} onAsk={() => {}} />);
    expect(screen.getByText(/2\/3/)).toBeTruthy();
  });

  it("desactive l'envoi pendant le streaming", () => {
    render(<ChatView messages={[]} streaming={true} rag={{ indexees: 3, total: 3, erreur: null }} onAsk={() => {}} />);
    expect(screen.getByRole("button", { name: /envoyer/i }).hasAttribute("disabled")).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npm test -- ChatView`
Expected: FAIL — module `./ChatView` introuvable

- [ ] **Step 3: Écrire ChatView**

Créer `src/features/ariane/ChatView.tsx` :

```tsx
import { useState } from "react";
import { Button } from "@gouvfr-lasuite/cunningham-react";
import type { ChatMessage } from "./arianeChatApi";
import type { RagEtat } from "./arianeApi";

type Props = {
  messages: ChatMessage[];
  streaming: boolean;
  rag: RagEtat;
  onAsk: (question: string) => void;
};

export default function ChatView({ messages, streaming, rag, onAsk }: Props) {
  const [saisie, setSaisie] = useState("");

  function envoyer(e: React.FormEvent) {
    e.preventDefault();
    if (!saisie.trim() || streaming) return;
    onAsk(saisie);
    setSaisie("");
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "#5b5b6b", margin: "0 0 12px" }}>
        Questions sur le texte intégral des pièces indexées.
        {rag.indexees < rag.total && ` ${rag.indexees}/${rag.total} pièces indexées.`}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 280, marginBottom: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "80%", padding: "10px 14px", borderRadius: 10, fontSize: 14, lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            background: m.role === "user" ? "#000091" : "#f5f5fe",
            color: m.role === "user" ? "#fff" : "#1e1e1e",
          }}>
            {m.content}
          </div>
        ))}
      </div>

      <form onSubmit={envoyer} style={{ display: "flex", gap: 10 }}>
        <input
          type="text"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder="Poser une question sur la procédure"
          aria-label="Question"
          style={{ flex: 1, padding: "10px 12px", fontSize: 14, borderRadius: 6, border: "1px solid #ddd" }}
        />
        <Button type="submit" disabled={streaming}
          icon={<span className="material-icons" aria-hidden>send</span>}>
          Envoyer
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `npm test -- ChatView`
Expected: PASS — 3 tests

- [ ] **Step 5: Câbler l'onglet dans ArianeApp**

Dans `src/features/ariane/ArianeApp.tsx` :

1. Étendre les imports (lignes 4 et 9) :

```tsx
import { useAriane, setPieces, run, viderTout, setView, selectCote, ask, type ViewKey } from "./arianeStore";
import ChatView from "./ChatView";
```

(`reset` n'est plus importé : `viderTout` le remplace.)

2. Ajouter l'onglet à `TABS` (après `reseau`, ligne 16) :

```tsx
  { key: "questions", label: "Questions", icon: "forum" },
```

3. Récupérer l'état RAG dans le composant (ligne 20) :

```tsx
  const { pieces, running, statusLabel, progress, dossier, error, view, selectedCote, rag, messages, streaming } = useAriane();
```

4. Remplacer `vider` (lignes 30-33) :

```tsx
  async function vider() {
    await viderTout(); // purge le corpus RAG avant de réinitialiser l'écran
    if (inputRef.current) inputRef.current.value = "";
  }
```

5. Griser l'onglet Questions tant que rien n'est indexé — remplacer le `<button>` du `TABS.map` (lignes 75-82) par :

```tsx
              <button key={t.key} type="button" onClick={() => setView(t.key)}
                disabled={t.key === "questions" && rag.indexees === 0}
                title={t.key === "questions" && rag.indexees === 0 ? "Aucune pièce indexée" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 14,
                  cursor: t.key === "questions" && rag.indexees === 0 ? "not-allowed" : "pointer",
                  opacity: t.key === "questions" && rag.indexees === 0 ? 0.4 : 1,
                  border: "none", background: "none", borderBottom: "2px solid " + (view === t.key ? "#000091" : "transparent"),
                  color: view === t.key ? "#000091" : "#5b5b6b", fontWeight: view === t.key ? 700 : 500,
                }}>
                <span className="material-icons" aria-hidden style={{ fontSize: 18 }}>{t.icon}</span> {t.label}
              </button>
```

6. Ajouter le rendu de la vue (après la ligne 98) :

```tsx
            {view === "questions" && <ChatView messages={messages} streaming={streaming} rag={rag} onAsk={ask} />}
```

- [ ] **Step 6: Lancer toute la suite front**

Run: `npm test`
Expected: PASS — aucune régression sur les tests Ariane existants (`ArianeApp`, `views`, `reseau`, `graph`, `arianeStore`, `arianeApi`)

- [ ] **Step 7: Vérifier la compilation**

Run: `npm run build`
Expected: succès `tsc -b && vite build`, sans erreur de type.

- [ ] **Step 8: Commit**

```bash
git add src/features/ariane/ChatView.tsx src/features/ariane/ChatView.test.tsx src/features/ariane/ArianeApp.tsx
git commit -m "feat(ariane): onglet Questions — chat RAG sur la procedure"
```

---

### Task 8: Recette bout-en-bout et documentation

**Files:**
- Modify: `docs/iaka-ariane-workflow.md` (section RAG en fin de fichier)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: rien.

- [ ] **Step 1: Recette manuelle**

Lancer `npm run dev:all`, aller sur `/ariane`, déposer trois pièces d'une même procédure (par exemple les PDF `04_`, `05_`, `07_` de `/Users/brunogauville/Developpeur/maud/data/pieces/`), puis vérifier dans l'ordre :

1. L'analyse aboutit comme avant (synthèse, parties, faits, actes, réseau).
2. L'onglet **Questions** est actif et n'affiche pas de ratio partiel.
3. Une question sur le texte d'une pièce (« que déclare Camille CEULENEER sur le 12 décembre ? ») reçoit une réponse **qui s'écrit progressivement**.
4. Le bouton **Vider** vide l'écran ; un `curl` de contrôle confirme le corpus vide :
   `curl -s "$IAKA_BASE_URL/rag/documents?corpus_id=$IAKA_RAG_CORPUS_ID" -H "Authorization: Bearer $IAKA_JWT"`
5. Relancer une analyse sur une **autre** procédure et poser une question portant sur la première : la réponse doit indiquer qu'elle ne dispose pas de l'information. C'est le test qui prouve que l'isolation fonctionne — le plus important de la recette.

- [ ] **Step 2: Documenter dans le doc des workflows**

Ajouter en fin de `docs/iaka-ariane-workflow.md` :

```markdown
---

## RAG documentaire et chat

En parallèle du MAP, chaque pièce est ingérée dans un corpus RAG IAka
(`POST /rag/ingest`), et l'onglet Questions interroge ce corpus via l'endpoint
OpenAI-compatible `{IAKA_RAG_BASE_URL}/corpus/{corpus}/iak/{iak}/v1/chat/completions`
en streaming. Conception : `docs/superpowers/specs/2026-07-20-ariane-rag-chat-design.md`.

**Le corpus est purgé au début de chaque analyse et au clic sur Vider.** Sans filtre par
métadonnées côté API, c'est la seule façon de garantir que le chat répond sur la
procédure affichée. `IAKA_RAG_CORPUS_ID` doit donc pointer sur un corpus **dédié à la
démo Ariane** : la purge y supprime tout, sans distinction d'origine.

Variables d'environnement :

```
IAKA_RAG_BASE_URL=<base OpenAI-compatible>
IAKA_RAG_CORPUS_ID=<corpus DEDIE>
IAKA_RAG_IAK_ID=<iak procedure judiciaire>
IAKA_RAG_MODEL=mistral-small
IAKA_RAG_MAX_TOKENS=28000
```

Le RAG est best-effort : purge en échec → aucune ingestion mais analyse poursuivie ;
pièce non indexée → ratio `indexees/total` affiché ; aucun échec RAG ne fait échouer un
job.
```

- [ ] **Step 3: Commit**

```bash
git add docs/iaka-ariane-workflow.md
git commit -m "docs(ariane): documenter le RAG documentaire et le chat"
```

---

### Task 9: Métadonnées d'ingestion depuis l'XML embarqué (PDF/A-3)

Les pièces au format procédure pénale numérique sont des PDF/A-3 portant une pièce jointe `data.xml` (schéma LRPGN 1.50) qui décrit la pièce en structuré. Quand elle est présente, elle qualifie le document ingéré bien mieux que son nom de fichier.

**Périmètre : métadonnées d'ingestion RAG uniquement.** Le même parseur ouvrirait le chemin hybride de la spec Ariane §8.1 (remplacer le MAP LLM quand l'XML existe) — hors sujet ici, cf. §9 de la spec RAG.

**Files:**
- Create: `server/piece-xml.mjs`
- Create: `server/piece-xml.test.mjs`
- Modify: `server/ariane-rag.mjs` (`ingestPiece`)
- Modify: `server/ariane-rag.test.mjs` (ajout d'un test)

**Interfaces:**
- Consumes: `ingestPiece` de la Task 2.
- Produces:
  - `extraireXmlEmbarque(buffer) → string | null`
  - `dateParis(utc) → "AAAA-MM-JJ" | null`
  - `metadonneesDepuisXml(xml) → object | null`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `server/piece-xml.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { extraireXmlEmbarque, dateParis, metadonneesDepuisXml } from "./piece-xml.mjs";

// Echantillon reduit aux balises reellement lues (le vrai data.xml en porte bien plus,
// et « pas toujours au complet » selon le XSD 1.50).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Procedure Titre_Piece="04340_00059_2025__ENQU&#202;TE PR&#201;LIMINAIRE_PROC&#200;S-VERBAL D&amp;apos;AUDITION__Marc_BIDULE">
  <Enqueteurs><Enqueteur><Enqueteur_Nom>Adjudant Julie MALLIETTE</Enqueteur_Nom></Enqueteur></Enqueteurs>
  <Entete>
    <Enquete_Type>ENQU&#202;TE PR&#201;LIMINAIRE</Enquete_Type>
    <Piece_Titre>PROC&#200;S-VERBAL D&amp;apos;AUDITION</Piece_Titre>
    <Unite_L4>COB LE-LION-D-ANGERS</Unite_L4>
    <Procedure_Numero>00059</Procedure_Numero>
    <Procedure_Annee>2025</Procedure_Annee>
  </Entete>
  <Faits><Fait><Natinf>10832</Natinf><Libelle_Fait>VOL EN BANDE ORGANISEE</Libelle_Fait></Fait></Faits>
  <Redaction_Proces_Verbal>
    <Acte_Enquete_Date utc="2025-02-20T23:00Z[UTC]">vendredi 21 f&#233;vrier 2025</Acte_Enquete_Date>
  </Redaction_Proces_Verbal>
</Procedure>`;

const pdfAvecXml = (xml) =>
  Buffer.concat([Buffer.from("%PDF-1.7\nstream\n"), zlib.deflateSync(Buffer.from(xml, "utf8")), Buffer.from("\nendstream\n%%EOF")]);

test("extraireXmlEmbarque decompresse la piece jointe data.xml", () => {
  const xml = extraireXmlEmbarque(pdfAvecXml(XML));
  assert.ok(xml.includes("<Procedure"));
  assert.ok(xml.includes("VOL EN BANDE ORGANISEE"));
});

test("extraireXmlEmbarque rend null sur un PDF sans XML", () => {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\nstream\n"), zlib.deflateSync(Buffer.from("pas du xml")), Buffer.from("\nendstream")]);
  assert.equal(extraireXmlEmbarque(pdf), null);
});

test("extraireXmlEmbarque rend null sur un buffer quelconque", () => {
  assert.equal(extraireXmlEmbarque(Buffer.from("nimporte quoi")), null);
});

// Piege : 23:00Z le 20 fevrier = le 21 fevrier a Paris. Tronquer l'UTC decalerait
// toute la chronologie d'un jour.
test("dateParis convertit l'attribut utc en date locale", () => {
  assert.equal(dateParis("2025-02-20T23:00Z[UTC]"), "2025-02-21");
  assert.equal(dateParis("2025-02-21T13:47Z[UTC]"), "2025-02-21");
  assert.equal(dateParis(null), null);
  assert.equal(dateParis("pas une date"), null);
});

test("metadonneesDepuisXml lit les champs qualifiant la piece", () => {
  assert.deepEqual(metadonneesDepuisXml(XML), {
    titre_piece: "04340_00059_2025__ENQUÊTE PRÉLIMINAIRE_PROCÈS-VERBAL D'AUDITION__Marc_BIDULE",
    type_piece: "PROCÈS-VERBAL D'AUDITION",
    type_enquete: "ENQUÊTE PRÉLIMINAIRE",
    procedure: "00059/2025",
    unite: "COB LE-LION-D-ANGERS",
    redacteur: "Adjudant Julie MALLIETTE",
    date_acte: "2025-02-21",
    nature_fait: "VOL EN BANDE ORGANISEE",
    natinf: "10832",
  });
});

test("metadonneesDepuisXml omet les champs absents plutot que de mettre null", () => {
  const meta = metadonneesDepuisXml(`<Procedure Titre_Piece="X"><Entete><Unite_L4>COB</Unite_L4></Entete></Procedure>`);
  assert.deepEqual(meta, { titre_piece: "X", unite: "COB" });
});

test("metadonneesDepuisXml rend null sans XML", () => {
  assert.equal(metadonneesDepuisXml(null), null);
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `node --test server/piece-xml.test.mjs`
Expected: FAIL — `Cannot find module './piece-xml.mjs'`

- [ ] **Step 3: Écrire le module**

Créer `server/piece-xml.mjs` :

```js
import zlib from "node:zlib";

// PDF/A-3 des procedures penales numeriques : une piece jointe data.xml (schema LRPGN
// 1.50) decrit la piece en structuré. On y lit de quoi QUALIFIER le document pour le
// RAG — volontairement pas d'etat civil : le texte du PDF est deja indexe, et une
// metadonnee nominative serait interrogeable sans rien apporter a la demonstration.

// Balaie les flux du PDF et rend le premier qui se decompresse en XML de procedure.
// Evite une dependance PDF pour lire un seul fichier joint.
export function extraireXmlEmbarque(buffer) {
  const s = buffer.toString("latin1"); // 1 octet = 1 caractere : les index restent des offsets
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const debut = m.index + m[0].length;
    const fin = s.indexOf("endstream", debut);
    if (fin < 0) continue;
    try {
      const txt = zlib.inflateSync(buffer.subarray(debut, fin)).toString("utf8");
      if (txt.includes("<Procedure")) return txt;
    } catch {
      // flux non compresse, chiffre, ou non-XML : on passe au suivant
    }
  }
  return null;
}

// Le fichier porte des entites doublement encodees (`D&amp;apos;AUDITION`) : deux passes.
function decode(txt) {
  const une = (t) =>
    t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
     .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
     .replace(/&amp;/g, "&");
  return une(une(txt));
}

const balise = (xml, nom) => {
  const m = xml.match(new RegExp(`<${nom}[^>]*>([^<]*)</${nom}>`));
  return m ? decode(m[1].trim()) || null : null;
};

const attribut = (xml, nom) => {
  const m = xml.match(new RegExp(`\\b${nom}="([^"]*)"`));
  return m ? decode(m[1]) || null : null;
};

const attributUtcDe = (xml, nom) => {
  const m = xml.match(new RegExp(`<${nom}[^>]*\\butc="([^"]+)"`));
  return m ? m[1] : null;
};

// `utc="2025-02-20T23:00Z[UTC]"` designe le 21 fevrier a Paris. Tronquer la chaine UTC
// a 10 caracteres decalerait la chronologie d'un jour sur toutes les pieces du soir.
export function dateParis(utc) {
  if (!utc) return null;
  const d = new Date(utc.replace(/\[.*\]$/, ""));
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

// Le XSD 1.50 autorise des pieces incompletes : tout champ absent est omis, jamais null.
export function metadonneesDepuisXml(xml) {
  if (!xml) return null;
  const numero = balise(xml, "Procedure_Numero");
  const annee = balise(xml, "Procedure_Annee");
  const meta = {
    titre_piece: attribut(xml, "Titre_Piece"),
    type_piece: balise(xml, "Piece_Titre"),
    type_enquete: balise(xml, "Enquete_Type"),
    procedure: numero && annee ? `${numero}/${annee}` : (numero ?? annee),
    unite: balise(xml, "Unite_L4") ?? balise(xml, "Unite_L1"),
    redacteur: balise(xml, "Enqueteur_Nom"),
    date_acte: dateParis(attributUtcDe(xml, "Acte_Enquete_Date")),
    nature_fait: balise(xml, "Libelle_Fait"),
    natinf: balise(xml, "Natinf"),
  };
  for (const [k, v] of Object.entries(meta)) if (v == null) delete meta[k];
  return meta;
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `node --test server/piece-xml.test.mjs`
Expected: PASS — 7 tests

- [ ] **Step 5: Vérifier sur la vraie pièce**

Le module doit tenir face à un PDF/A-3 réel, pas seulement face au buffer synthétique des tests :

```bash
node -e '
import("./server/piece-xml.mjs").then(async (m) => {
  const fs = await import("node:fs");
  const buf = fs.readFileSync("/Users/brunogauville/Downloads/20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf");
  console.log(m.metadonneesDepuisXml(m.extraireXmlEmbarque(buf)));
});'
```

Expected: un objet portant `titre_piece`, `type_piece: "PROCÈS-VERBAL D'AUDITION"`, `procedure: "00059/2025"`, `unite: "COB LE-LION-D-ANGERS"`, `redacteur: "Adjudant Julie MALLIETTE"`, `date_acte: "2025-02-21"`, `nature_fait: "VOL EN BANDE ORGANISEE"`, `natinf: "10832"`.

Vérifier en particulier `date_acte` : `2025-02-20` signalerait que la conversion Paris a sauté.

- [ ] **Step 6: Brancher sur l'ingestion**

Dans `server/ariane-rag.mjs`, ajouter l'import en tête :

```js
import { extraireXmlEmbarque, metadonneesDepuisXml } from "./piece-xml.mjs";
```

Puis, dans `ingestPiece`, remplacer la ligne `form.set("metadata", ...)` par :

```js
  // Les PDF/A-3 de procedure portent un data.xml qui qualifie la piece bien mieux que
  // son nom de fichier. Absent (PDF ordinaire) : on retombe sur la seule cote.
  const depuisXml = metadonneesDepuisXml(extraireXmlEmbarque(bytes));
  form.set("metadata", JSON.stringify({ cote, ...(depuisXml ?? {}) }));
```

- [ ] **Step 7: Ajouter le test d'intégration à ariane-rag**

Ajouter à `server/ariane-rag.test.mjs` (l'import en tête gagne `zlib` : `import zlib from "node:zlib";`) :

```js
test("ingestPiece enrichit les metadonnees depuis l'XML embarque", async () => {
  const xml = `<Procedure Titre_Piece="04340_00059_2025__PV"><Entete><Unite_L4>COB X</Unite_L4></Entete></Procedure>`;
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\nstream\n"), zlib.deflateSync(Buffer.from(xml, "utf8")), Buffer.from("\nendstream")]);
  let recu;
  const fetchImpl = async (url, init) => { recu = init; return ok({}); };
  await ingestPiece({ file: { base64: pdf.toString("base64"), mime: "application/pdf", filename: "D12.pdf" }, cote: "D12", cfg, fetchImpl });
  assert.deepEqual(JSON.parse(recu.body.get("metadata")), {
    cote: "D12", titre_piece: "04340_00059_2025__PV", unite: "COB X",
  });
});

test("ingestPiece se contente de la cote sur un PDF sans XML", async () => {
  let recu;
  const fetchImpl = async (url, init) => { recu = init; return ok({}); };
  const file = { base64: Buffer.from("%PDF-1.4 sans xml").toString("base64"), mime: "application/pdf", filename: "D12.pdf" };
  await ingestPiece({ file, cote: "D12", cfg, fetchImpl });
  assert.deepEqual(JSON.parse(recu.body.get("metadata")), { cote: "D12" });
});
```

- [ ] **Step 8: Lancer toute la suite serveur**

Run: `node --test server/piece-xml.test.mjs server/ariane-rag.test.mjs server/ariane.test.mjs`
Expected: PASS — aucune régression

- [ ] **Step 9: Commit**

```bash
git add server/piece-xml.mjs server/piece-xml.test.mjs server/ariane-rag.mjs server/ariane-rag.test.mjs
git commit -m "feat(ariane): metadonnees d'ingestion lues dans l'XML des PDF/A-3"
```
