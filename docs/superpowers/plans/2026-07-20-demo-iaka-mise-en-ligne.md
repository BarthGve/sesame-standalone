# Mise en ligne demo-iaka — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre demo-iaka en ligne sur OVH (pattern `carnet`), protégé par email via Cloudflare Access, avec les appels IAka longs passés en asynchrone pour tenir sous la limite ~100s de Cloudflare.

**Architecture:** Un conteneur Node `demo-iaka` sert le front build (`dist/`) et le BFF (`proxy.mjs` sur `/api/*`), joignant les services internes OVH par nom docker. Derrière nginx (`demo-iaka.kerjean.net`, TLS wildcard), Cloudflare orange + Access (OTP email). Les endpoints IAka deviennent async (job store mémoire généralisé depuis Ariane + poll côté front).

**Tech Stack:** Node (http natif, `node --test`), React/Vite + Vitest, Docker Compose, nginx, Cloudflare Access.

## Global Constraints

- Front sans emoji (CLAUDE.md) : icônes Material Icons / SVG uniquement.
- Tests serveur : `node --test` (fichiers `server/*.test.mjs`). Tests front : `npx vitest run`.
- Secrets jamais commit ; fournis via l'environnement docker-compose OVH.
- Services internes joints par nom docker : `rgp-api:8080`, `rens-api:8080`, `minio:9000`, IAka (`n8n`) via `IAKA_BASE_URL`.
- Sous-domaine cible : `demo-iaka.kerjean.net`. Port interne conteneur : `8787`.
- Déploiement manuel (scp + `docker compose up -d --build`), comme rgp-api.
- Ne pas casser Ariane (`/api/ariane*`), déjà async.

---

## Phase 1 — Refonte async (local, testable sans OVH)

### Task 1: Job store générique `server/jobs.mjs`

**Files:**
- Create: `server/jobs.mjs`
- Test: `server/jobs.test.mjs`

**Interfaces:**
- Produces:
  - `createJob() → string` (jobId)
  - `getJob(jobId: string) → { status: "pending"|"running"|"done"|"error", result?, error? } | undefined`
  - `runJob(jobId: string, worker: () => Promise<any>) → void` (fire-and-forget ; passe `running` puis `done`+result ou `error`+message)

- [ ] **Step 1: Write the failing test**

```javascript
// server/jobs.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { createJob, getJob, runJob } from "./jobs.mjs";

const tick = () => new Promise((r) => setImmediate(r));

test("createJob → jobId + statut pending", () => {
  const id = createJob();
  assert.equal(typeof id, "string");
  assert.equal(getJob(id).status, "pending");
});

test("runJob : done + result quand le worker réussit", async () => {
  const id = createJob();
  runJob(id, async () => ({ texte: "ok" }));
  assert.equal(getJob(id).status, "running");
  await tick(); await tick();
  assert.equal(getJob(id).status, "done");
  assert.deepEqual(getJob(id).result, { texte: "ok" });
});

test("runJob : error + message quand le worker jette", async () => {
  const id = createJob();
  runJob(id, async () => { throw new Error("SYNTHESE_UPSTREAM"); });
  await tick(); await tick();
  assert.equal(getJob(id).status, "error");
  assert.equal(getJob(id).error, "SYNTHESE_UPSTREAM");
});

test("getJob : undefined si inconnu", () => {
  assert.equal(getJob("nope"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/jobs.test.mjs`
Expected: FAIL (`Cannot find module './jobs.mjs'`).

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/jobs.mjs
// Store de jobs en mémoire (démo, pas de persistance) : rend les endpoints IAka
// asynchrones (start rend un jobId, le front poll /api/job/status). Généralise le
// pattern déjà utilisé par Ariane.
import { randomUUID } from "node:crypto";

const jobs = new Map();

export function createJob() {
  const jobId = randomUUID();
  jobs.set(jobId, { status: "pending" });
  return jobId;
}

export function getJob(jobId) {
  return jobs.get(jobId);
}

// Lance le worker en arrière-plan et met à jour le job. Ne bloque pas l'appelant :
// la route a déjà renvoyé le jobId. Le worker doit renvoyer un résultat DÉJÀ normalisé
// (au format attendu par la feature) — le status générique le ressert tel quel.
export function runJob(jobId, worker) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "running";
  Promise.resolve()
    .then(worker)
    .then((result) => { job.result = result; job.status = "done"; })
    .catch((e) => { job.error = e?.message || "INTERNAL_ERROR"; job.status = "error"; });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/jobs.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/jobs.mjs server/jobs.test.mjs
git commit -m "feat(bff): job store générique async (createJob/getJob/runJob)"
```

---

### Task 2: Endpoint status générique + `/api/synthese` async

**Files:**
- Modify: `server/proxy.mjs` (imports ; route `/api/synthese` ~246-267 ; ajout route `/api/job/status`)
- Test: `server/proxy.test.mjs` (ajouts)

**Interfaces:**
- Consumes: `createJob`, `getJob`, `runJob` (Task 1).
- Produces: `POST /api/synthese → 202 { jobId }` ; `GET /api/job/status?jobId=… → { status, result?, error? }` (200) ou `{ error: "JOB_INCONNU" }` (404).

- [ ] **Step 1: Write the failing test** (ajouter à `server/proxy.test.mjs`)

```javascript
test("POST /api/synthese rend 202 + jobId, puis /api/job/status livre le résultat", async () => {
  const handler = createHandler({
    cfg: {},
    synthese: async () => "SYNTHESE OK",
  });
  // start
  const start = await callJson(handler, "POST", "/api/synthese", { files: [{ base64: "x" }] });
  assert.equal(start.status, 202);
  const jobId = start.body.jobId;
  assert.ok(jobId);
  // laisser le worker finir
  await new Promise((r) => setTimeout(r, 10));
  const st = await callJson(handler, "GET", `/api/job/status?jobId=${jobId}`);
  assert.equal(st.status, 200);
  assert.equal(st.body.status, "done");
  assert.deepEqual(st.body.result, { texte: "SYNTHESE OK" });
});

test("GET /api/job/status jobId inconnu → 404", async () => {
  const handler = createHandler({ cfg: {} });
  const st = await callJson(handler, "GET", "/api/job/status?jobId=nope");
  assert.equal(st.status, 404);
});
```

> Note : si `callJson` (helper de test simulant req/res) n'existe pas déjà dans `proxy.test.mjs`, réutiliser le helper de mock req/res présent dans ce fichier (même mécanisme que les tests existants de `createHandler`). Aligner la forme sur les tests déjà présents.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/proxy.test.mjs`
Expected: FAIL (`/api/synthese` rend 200 `{texte}` synchrone, pas 202 ; pas de route status).

- [ ] **Step 3: Write minimal implementation**

Ajouter l'import en tête de `server/proxy.mjs` :

```javascript
import { createJob, getJob, runJob } from "./jobs.mjs";
```

Remplacer le corps de la route `/api/synthese` (le bloc `if (url.pathname === "/api/synthese" && req.method === "POST")`) par la version async :

```javascript
    if (url.pathname === "/api/synthese" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { files } = JSON.parse(raw || "{}");
        if (!Array.isArray(files) || files.length === 0 || files.some((f) => !f?.base64)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "FICHIERS_REQUIS" }));
          return;
        }
        const jobId = createJob();
        // worker : réutilise la logique existante, NORMALISE avant de stocker.
        runJob(jobId, async () => ({ texte: await synthese({ files, cfg, fetchImpl }) }));
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId }));
      } catch (e) {
        const status = ERROR_STATUS[e.message] ?? 500;
        if (!(e.message in ERROR_STATUS)) console.error(e.message);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
```

Ajouter la route status générique (juste après le bloc `/api/ariane/status`, ou près des autres routes GET) :

```javascript
    if (url.pathname === "/api/job/status" && req.method === "GET") {
      const job = getJob(url.searchParams.get("jobId"));
      if (!job) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "JOB_INCONNU" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(job));
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/proxy.test.mjs`
Expected: PASS (dont les 2 nouveaux).

- [ ] **Step 5: Commit**

```bash
git add server/proxy.mjs server/proxy.test.mjs
git commit -m "feat(bff): /api/synthese async + /api/job/status générique"
```

---

### Task 3: Passer query, identify, pvtcmp, rgp/chat en async

**Files:**
- Modify: `server/proxy.mjs` (routes `/api/rgp/chat` ~212, `/api/pvtcmp` ~300, `/api/query` et `/api/identify` ~334-407)
- Test: `server/proxy.test.mjs` (un cas par endpoint : 202 + jobId ; status done avec la bonne forme)

**Interfaces:**
- Consumes: `createJob`, `runJob` (Task 1), `/api/job/status` (Task 2).
- Produces: chaque endpoint rend `202 { jobId }` ; le job.result garde la forme actuelle par feature (GeoJSON pour query, objet pour identify, `{docxBase64,filename,chapitres}` pour pvtcmp, `{text,parsed,message}` pour rgp/chat).

- [ ] **Step 1: Write the failing tests** (un par endpoint ; exemple carte)

```javascript
test("POST /api/query async → 202 + jobId, status done avec le GeoJSON", async () => {
  const geo = { type: "FeatureCollection", features: [] };
  const handler = createHandler({ cfg: {}, run: async () => geo });
  const start = await callJson(handler, "POST", "/api/query", { question: "où ?" });
  assert.equal(start.status, 202);
  await new Promise((r) => setTimeout(r, 10));
  const st = await callJson(handler, "GET", `/api/job/status?jobId=${start.body.jobId}`);
  assert.equal(st.body.status, "done");
  assert.deepEqual(st.body.result, geo);
});
// idem : /api/identify (result = objet), /api/pvtcmp (result = {docxBase64,filename,chapitres}),
//        /api/rgp/chat (result = {text,parsed,message}).
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/proxy.test.mjs`
Expected: FAIL (endpoints encore synchrones → 200, pas 202).

- [ ] **Step 3: Write minimal implementation**

Pour CHAQUE endpoint, garder la validation d'entrée + la logique de retry existante DANS le worker, et remplacer le `res.writeHead(200…)+res.end(result)` final par `createJob`+`runJob`+`202`. Modèle (rgp/chat) :

```javascript
    if (url.pathname === "/api/rgp/chat" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { prompt } = JSON.parse(raw || "{}");
        if (!prompt || typeof prompt !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "PROMPT_REQUIS" }));
          return;
        }
        const jobId = createJob();
        runJob(jobId, async () => {
          const today = new Date().toISOString().slice(0, 10);
          const dated = `(Contexte : la date du jour est ${today}. Utilise-la pour interpréter « cette année », « ce mois », « juin », etc.)\n${prompt}`;
          const maxAttempts = cfg.maxAttempts ?? 3;
          let result;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            result = await runRaw({ prompt: dated, cfg, fetchImpl });
            if (result && result.includes("<tool-output>")) break;
          }
          const { parsed, message } = normalizeResult(result);
          return { text: result, parsed, message };
        });
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId }));
      } catch (e) {
        const status = ERROR_STATUS[e.message] ?? 500;
        if (!(e.message in ERROR_STATUS)) console.error(e);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
```

Appliquer le même schéma à `/api/pvtcmp` (worker = la boucle de retry existante, renvoie `{docxBase64, filename, chapitres}`), `/api/query` (worker = boucle GEOJSON_INVALID, renvoie le geojson), `/api/identify` (worker = boucle OBJET_INVALID, renvoie l'objet). La validation d'entrée (`FICHIERS_REQUIS`, `IMAGE_REQUISE`, `QUESTION_REQUISE`) reste AVANT `createJob`, synchrone.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/proxy.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/proxy.mjs server/proxy.test.mjs
git commit -m "feat(bff): query/identify/pvtcmp/rgp-chat en async (job store)"
```

---

### Task 4: Helper front `runJobAsync`

**Files:**
- Create: `src/lib/runJobAsync.ts`
- Test: `src/lib/runJobAsync.test.ts`

**Interfaces:**
- Produces: `runJobAsync<T>(startUrl: string, body: unknown, opts?: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal }) → Promise<T>`.
  - POST `startUrl` (JSON body) → attend `{ jobId }`.
  - Poll `GET /api/job/status?jobId=` toutes les `intervalMs` (défaut 3000), jusqu'à `done` (résout `result`) ou `error` (rejette `new Error(job.error)`), ou `timeoutMs` (défaut 300000 → rejette `Error("TIMEOUT")`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/runJobAsync.test.ts
import { describe, it, expect, vi } from "vitest";
import { runJobAsync } from "./runJobAsync";

function fetchSeq(responses: any[]) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return { ok: true, json: async () => r } as any;
  });
}

describe("runJobAsync", () => {
  it("POST start puis poll jusqu'à done, résout le result", async () => {
    const fetchImpl = fetchSeq([
      { jobId: "j1" },
      { status: "running" },
      { status: "done", result: { texte: "ok" } },
    ]);
    const out = await runJobAsync("/api/synthese", { files: [] }, { intervalMs: 1, fetchImpl } as any);
    expect(out).toEqual({ texte: "ok" });
  });

  it("rejette si le job est en error", async () => {
    const fetchImpl = fetchSeq([{ jobId: "j2" }, { status: "error", error: "SYNTHESE_UPSTREAM" }]);
    await expect(
      runJobAsync("/api/synthese", {}, { intervalMs: 1, fetchImpl } as any),
    ).rejects.toThrow("SYNTHESE_UPSTREAM");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/runJobAsync.test.ts`
Expected: FAIL (module absent).

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/runJobAsync.ts
// Lance un workflow BFF asynchrone (POST start → { jobId }) puis poll /api/job/status
// jusqu'à done/error. Chaque requête est courte → compatible Cloudflare (~100s).
export interface RunJobOpts {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function runJobAsync<T = unknown>(
  startUrl: string,
  body: unknown,
  opts: RunJobOpts = {},
): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  const interval = opts.intervalMs ?? 3000;
  const timeout = opts.timeoutMs ?? 300000;

  const startRes = await f(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  const started = await startRes.json();
  if (!startRes.ok || !started?.jobId) throw new Error(started?.error || "START_FAILED");
  const jobId = started.jobId;

  const deadline = Date.now() + timeout;
  for (;;) {
    if (Date.now() > deadline) throw new Error("TIMEOUT");
    await new Promise((r) => setTimeout(r, interval));
    if (opts.signal?.aborted) throw new Error("ABORTED");
    const res = await f(`/api/job/status?jobId=${encodeURIComponent(jobId)}`, { signal: opts.signal });
    const job = await res.json();
    if (job.status === "done") return job.result as T;
    if (job.status === "error") throw new Error(job.error || "INTERNAL_ERROR");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/runJobAsync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runJobAsync.ts src/lib/runJobAsync.test.ts
git commit -m "feat(front): helper runJobAsync (start + poll job)"
```

---

### Task 5: Brancher les clients d'API front sur `runJobAsync`

**Files:**
- Modify (chacun, la fonction qui fait `fetch("/api/<feature>")` et attend le résultat) :
  - `src/features/synthese/syntheseApi.ts`
  - `src/features/pvtransport/` (client d'API PV)
  - `src/features/rgp/rgpApi.ts` (ou équivalent — `sendRgpPrompt`)
  - carte : le client de `/api/query`
  - saisies/identify : le client de `/api/identify`
- Test: adapter les tests existants de ces clients (ils mockaient un `fetch` unique → mocker start `{jobId}` + status `{status:"done",result}`), ou ajouter un test par client.

**Interfaces:**
- Consumes: `runJobAsync` (Task 4).
- Produces: signatures publiques des clients INCHANGÉES (même valeur de retour qu'avant) — seul l'intérieur passe par `runJobAsync`.

- [ ] **Step 1: Repérer chaque client et son test**

Run: `grep -rn "/api/synthese\|/api/pvtcmp\|/api/query\|/api/identify\|/api/rgp/chat" src`
Noter, pour chacun, la fonction exportée et sa forme de retour actuelle.

- [ ] **Step 2: Adapter le premier client (synthèse) + son test (échoue d'abord)**

Dans `syntheseApi.ts`, remplacer le `fetch("/api/synthese", …)` + lecture `{texte}` par :

```typescript
import { runJobAsync } from "../../lib/runJobAsync";
// …
const { texte } = await runJobAsync<{ texte: string }>("/api/synthese", { files });
return texte;
```

Adapter le test existant : au lieu d'un `fetch` unique renvoyant `{texte}`, mocker la séquence start `{jobId:"j"}` puis status `{status:"done",result:{texte:"…"}}`.

Run: `npx vitest run src/features/synthese` → PASS.

- [ ] **Step 3: Répéter pour pv, rgp, carte, identify** (même transformation, valeur de retour préservée).

- [ ] **Step 4: Run all front tests**

Run: `npx vitest run` puis `npx tsc --noEmit`
Expected: PASS + tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(front): clients IAka via runJobAsync (async)"
```

---

## Phase 2 — Conteneurisation (front + BFF unifiés)

### Task 6: `proxy.mjs` sert le front statique (`dist/`)

**Files:**
- Modify: `server/proxy.mjs` (dans `createHandler`, avant le 404 final : servir les fichiers statiques + fallback SPA)
- Test: `server/proxy.test.mjs` (GET `/` → 200 index.html ; GET `/assets/x` inexistant → SPA fallback index)

**Interfaces:**
- Consumes: `cfg.staticDir` (chemin de `dist/`, injecté ; absent en test → static désactivé, comportement actuel préservé).
- Produces: GET non-`/api` → fichier de `dist/` si présent, sinon `index.html` (SPA). Ne touche jamais `/api/*`.

- [ ] **Step 1: Write the failing test**

```javascript
test("GET / sert index.html quand staticDir est fourni", async () => {
  // staticDir pointant sur un dossier temporaire contenant index.html
  const handler = createHandler({ cfg: { staticDir: TMP_DIST } });
  const r = await call(handler, "GET", "/");
  assert.equal(r.status, 200);
  assert.match(r.body, /<!doctype html>/i);
});
```

(Créer `TMP_DIST` avec un `index.html` minimal via `node:fs`/`node:os` dans le test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/proxy.test.mjs`
Expected: FAIL (GET `/` → 404 aujourd'hui).

- [ ] **Step 3: Write minimal implementation**

Ajouter, dans `createHandler`, juste avant le `if (req.method !== "POST") { res.writeHead(404)… }` final, un handler statique (GET only, jamais `/api`) :

```javascript
    // --- Front statique (dist/) : tout ce qui n'est pas /api ---
    if (req.method === "GET" && cfg.staticDir && !url.pathname.startsWith("/api/")) {
      const { readFile } = await import("node:fs/promises");
      const { join, normalize } = await import("node:path");
      const rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
      const candidate = join(cfg.staticDir, rel);
      try {
        const data = await readFile(candidate.endsWith("/") ? join(candidate, "index.html") : candidate);
        res.writeHead(200, { "Content-Type": contentTypeFor(candidate) });
        res.end(data);
        return;
      } catch {
        // Fallback SPA : sert index.html pour les routes client (react-router).
        try {
          const html = await readFile(join(cfg.staticDir, "index.html"));
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          return;
        } catch { /* pas de dist → 404 plus bas */ }
      }
    }
```

Ajouter un petit helper `contentTypeFor(path)` (map d'extensions usuelles : `.html`,`.js`,`.css`,`.svg`,`.png`,`.woff2`,`.json`, défaut `application/octet-stream`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/proxy.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/proxy.mjs server/proxy.test.mjs
git commit -m "feat(bff): sert le front statique dist/ (fallback SPA)"
```

Et brancher `staticDir` au démarrage direct (bloc `if (import.meta.url === …)`), après `const cfg = {…}` :
```javascript
  cfg.staticDir = process.env.STATIC_DIR || null;
```

---

### Task 7: Dockerfile + `.dockerignore`

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Produces: image qui build le front (`npm run build`) et lance `node server/proxy.mjs` avec `STATIC_DIR=/app/dist`, port `8787`.

- [ ] **Step 1: Écrire le Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production STATIC_DIR=/app/dist PROXY_PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8787
CMD ["node", "server/proxy.mjs"]
```

- [ ] **Step 2: `.dockerignore`**

```
node_modules
dist
.git
docs
*.md
.env
```

- [ ] **Step 3: Build local de vérification**

Run: `docker build -t demo-iaka:test .`
Expected: build OK (front + install prod).

- [ ] **Step 4: Smoke run**

Run: `docker run --rm -p 8788:8787 demo-iaka:test &` puis `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8788/`
Expected: `200` (index servi). Arrêter le conteneur ensuite.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: Dockerfile demo-iaka (front + BFF unifiés)"
```

---

## Phase 3 — Déploiement OVH

### Task 8: Service `demo-iaka` dans le docker-compose OVH

**Files (sur OVH, via ssh) :**
- Modify: `/home/brunogauville/docker-compose.yml` (ajouter le service `demo-iaka`)
- Create: `/home/brunogauville/demo-iaka/` (dossier build : `server/`, `dist/`, `Dockerfile`, `package.json`, `package-lock.json`) via scp
- Backup: copier le compose avant édition (`cp docker-compose.yml docker-compose.yml.bak-$(date +%s)`)

**Interfaces:**
- Produces: conteneur `demo-iaka` sur le même réseau que `rgp-api`/`rens-api`/`minio`/n8n, joignable en interne, non publié en ports (nginx y accède par nom docker).

- [ ] **Step 1: Copier les sources buildées sur OVH**

Local :
```bash
npm run build
ssh ovh 'mkdir -p /home/brunogauville/demo-iaka'
scp -r Dockerfile package.json package-lock.json server dist ovh:/home/brunogauville/demo-iaka/
```

- [ ] **Step 2: Ajouter le service au compose** (repérer le réseau utilisé par `rgp-api` dans le fichier et le réutiliser)

```yaml
  demo-iaka:
    build: ./demo-iaka
    container_name: demo-iaka
    restart: unless-stopped
    env_file: ./demo-iaka/.env
    networks: [ default ]   # même réseau que rgp-api/rens-api/minio (adapter au nom réel)
```

`./demo-iaka/.env` (sur OVH, jamais commit) : reprendre les variables de `.env.example`, valeurs internes : `IAKA_BASE_URL`, `IAKA_JWT`, `IAKA_TENANT_ID`, `IAKA_*_APP_ID`, `RGP_API_URL=http://rgp-api:8080`, `RGP_API_TOKEN`, `RENS_API_URL=http://rens-api:8080`, `MINIO_ENDPOINT=minio`, `MINIO_*`, `PROXY_PORT=8787`, `STATIC_DIR=/app/dist`.

- [ ] **Step 3: Build + up**

Run (OVH): `cd /home/brunogauville && docker compose up -d --build demo-iaka`
Expected: `Container demo-iaka Started`.

- [ ] **Step 4: Vérifier l'accès interne**

Run (OVH): `docker exec demo-iaka node -e "fetch('http://localhost:8787/').then(r=>console.log(r.status))"`
Expected: `200`. Et joignabilité rgp-api : `docker exec demo-iaka node -e "fetch('http://rgp-api:8080/health').then(r=>console.log(r.status))"` → `200`.

- [ ] **Step 5: Commit** (côté repo : le service compose n'est pas dans ce repo ; documenter dans `docs/`)

```bash
# noter la conf de déploiement dans le repo
git add docs/superpowers/plans/2026-07-20-demo-iaka-mise-en-ligne.md
git commit -m "docs(deploy): service compose demo-iaka sur OVH"
```

---

### Task 9: Vhost nginx `demo-iaka.kerjean.net`

**Files (OVH) :**
- Create: `/home/brunogauville/nginx/conf.d/demo-iaka.conf` (copie adaptée de `carnet.conf`)

- [ ] **Step 1: Écrire le vhost** (calqué sur `carnet.conf`)

```nginx
# DEMO-IAKA - demo-iaka.kerjean.net
server {
    listen 80;
    server_name demo-iaka.kerjean.net;
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    http2 on;
    server_name demo-iaka.kerjean.net;

    ssl_certificate     /etc/nginx/ssl/wildcard-fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/wildcard-privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 25M;   # uploads photos/pièces (base64)

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location ~ /\.(git|env|htaccess|htpasswd) { deny all; return 404; }

    resolver 127.0.0.11 valid=10s;
    set $up demo-iaka:8787;

    location / {
        proxy_pass http://$up;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # requêtes async courtes ; marge de sécurité
    }
}
```

- [ ] **Step 2: Tester + recharger nginx**

Run (OVH): `docker exec brunogauville-nginx-1 nginx -t && docker exec brunogauville-nginx-1 nginx -s reload`
Expected: `syntax is ok` + `test is successful`, reload sans erreur.

- [ ] **Step 3: Vérifier via l'IP (avant DNS)** — optionnel : `curl -s -o /dev/null -w "%{http_code}\n" -H "Host: demo-iaka.kerjean.net" https://127.0.0.1 --resolve demo-iaka.kerjean.net:443:127.0.0.1 -k` depuis OVH → `200`/`301`.

- [ ] **Step 4: Commit** (doc)

```bash
git commit -am "docs(deploy): vhost nginx demo-iaka" --allow-empty
```

---

### Task 10: DNS Cloudflare

- [ ] **Step 1:** Dans le dashboard Cloudflare (zone `kerjean.net`) : enregistrement **A** `demo-iaka` → `91.134.75.161`, **Proxied (orange)**.
- [ ] **Step 2:** Attendre la propagation (quelques min).
- [ ] **Step 3: Vérifier** : `curl -s -o /dev/null -w "%{http_code}\n" https://demo-iaka.kerjean.net/` → `200` (ou une redirection Access une fois la Task 11 faite).

---

## Phase 4 — Protection email (Cloudflare Access)

### Task 11: Application Access + policy OTP email

- [ ] **Step 1:** Cloudflare Zero Trust → **Access → Applications → Add** → Self-hosted.
- [ ] **Step 2:** Application domain : `demo-iaka.kerjean.net`, path `/*` (tout le site, `/api` inclus).
- [ ] **Step 3:** Policy **Allow** : Include → **Emails** → `bgauville@mac.com`. Méthode de login : **One-time PIN** (email OTP).
- [ ] **Step 4:** Session duration au choix (ex. 24h).
- [ ] **Step 5: Vérifier** : ouvrir `https://demo-iaka.kerjean.net/` dans un navigateur → écran Access → saisir `bgauville@mac.com` → OTP par email → accès au front.

---

## Phase 5 — Vérification en ligne

### Task 12: Bout-en-bout

- [ ] **Step 1: Court** — après login, page **Assistant RGP** : poser une question → réponse (appel court, async).
- [ ] **Step 2: Long** — page **Synthèse** ou **PV transport** : lancer un traitement de 2-3 min → le front poll `/api/job/status`, le résultat arrive **sans 524** (preuve que l'async passe Cloudflare).
- [ ] **Step 3: Perquisitions** — upload photo (MinIO) → OK.
- [ ] **Step 4: Non-régression** — vérifier qu'aucune requête ne dépasse ~100s (onglet réseau : chaque appel court).
- [ ] **Step 5:** Noter le résultat dans la mémoire projet (déploiement effectif, URL, date).

---

## Self-review (couverture spec)

- Hébergement OVH pattern carnet → Tasks 6-9. Protection Access email → Task 11. Refonte async (job store généralisé + status unique + helper front + clients) → Tasks 1-5. Static serving → Task 6. Dockerfile → Task 7. DNS → Task 10. Vérif court+long → Task 12. ✅
- Ariane laissé intact (son propre store) → non modifié par les tasks. ✅
- Pas de placeholder : code réel fourni pour chaque task de code ; config exacte pour l'ops.
