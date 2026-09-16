# Page RGP — agent conversationnel UNA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter à SÉSAME une page « RGP » (zone de chat) qui relaie le prompt utilisateur vers le workflow IAka RGP et affiche le résultat (fiche/liste UNA créée/modifiée, ou données de consultation).

**Architecture:** Le moteur (compréhension + exécution) vit dans un workflow IAka **déjà construit et validé** (routage → condition → agent write MCP-API / agent read MCP-SQL). Le repo n'ajoute qu'un relais mince : front (vue chat) → proxy `POST /api/rgp/chat` → `runWorkflowRaw` (poll `/workflows/execute`) → `normalizeResult` extrait le JSON du `<tool-output>` → `{ text, parsed, message }` rendu par le front.

**Tech Stack:** Node.js natif (`http`, `node:test`) côté proxy ; React 19 + Cunningham/ui-kit + vitest côté front. Pas de nouvelle dépendance.

## Global Constraints

- **INTERDIT : emoji dans le front.** Icônes = Material Icons (`className="material-icons"`, déjà importé) ou SVG inline. (CLAUDE.md)
- App_id du workflow RGP : `IAKA_RGP_APP_ID=7fe23cda-5458-423a-bac3-ca51ef8a2b7b`.
- Réutilise `IAKA_BASE_URL`, `IAKA_JWT`, `IAKA_TENANT_ID`, `POLL_INTERVAL_MS`, `POLL_TIMEOUT_MS` existants.
- Format du `result` IAka : `<tool>…<tool-output>{JSON}</tool-output></tool>` + texte final. Cible de parsing = le **bloc `<tool-output>`** (JSON propre ; peut être enveloppé `{"json_build_object":{…}}`). Voir spec §6.
- Tests serveur : `node --test server/<fichier>.test.mjs`. Tests front : `npx vitest run <chemin>`.
- Enveloppe RGP : succès `{ "data": … }` (objet pour create/modify, tableau pour consult) ; erreur `{ "error": { "code", "message" } }`.

---

### Task 1: `normalizeResult` — extraction du JSON du result IAka

**Files:**
- Create: `server/rgpResult.mjs`
- Test: `server/rgpResult.test.mjs`

**Interfaces:**
- Produces: `normalizeResult(text: string) => { parsed: object|null, message: string }`
  - `parsed` = objet JSON extrait du `<tool-output>` (déballé de `json_build_object` si présent), sinon `null`.
  - `message` = texte hors balises `<tool>…</tool>` (phrase de l'agent), string éventuellement vide.

- [ ] **Step 1: Write the failing test**

```javascript
// server/rgpResult.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeResult } from "./rgpResult.mjs";

test("écriture : extrait data du tool-output + message", () => {
  const text =
    '<tool>createProcedure<tool-input>{"unite":15127}</tool-input>' +
    '<tool-output>{"data":{"una":"15127/126/2026","urgent":true}}</tool-output></tool>\n\n' +
    "La procédure a bien été créée.";
  const { parsed, message } = normalizeResult(text);
  assert.deepEqual(parsed, { data: { una: "15127/126/2026", urgent: true } });
  assert.equal(message, "La procédure a bien été créée.");
});

test("lecture : déballe json_build_object", () => {
  const text =
    '<tool>execute_sql<tool-input>{"sql":"..."}</tool-input>' +
    '<tool-output>{"json_build_object":{"data":[{"una":"15127/126/2026"}]}}</tool-output></tool>\n\n' +
    '{"data":[{"una":"15127/126/2026"}]}';
  const { parsed } = normalizeResult(text);
  assert.deepEqual(parsed, { data: [{ una: "15127/126/2026" }] });
});

test("erreur métier RGP dans le tool-output", () => {
  const text =
    '<tool>createProcedure<tool-input>{}</tool-input>' +
    '<tool-output>{"error":{"code":"groupe_inconnu","message":"Groupe X inconnu"}}</tool-output></tool>';
  const { parsed } = normalizeResult(text);
  assert.equal(parsed.error.code, "groupe_inconnu");
});

test("apostrophe française préservée (JSON double-quote)", () => {
  const text =
    "<tool-output>{\"data\":{\"synthese\":\"vol à l'étalage\"}}</tool-output>";
  const { parsed } = normalizeResult(text);
  assert.equal(parsed.data.synthese, "vol à l'étalage");
});

test("pas de wrapper : JSON direct", () => {
  const { parsed } = normalizeResult('{"data":[]}');
  assert.deepEqual(parsed, { data: [] });
});

test("inparsable → parsed null, message conservé", () => {
  const { parsed, message } = normalizeResult("texte libre sans json");
  assert.equal(parsed, null);
  assert.equal(message, "texte libre sans json");
});

test("non-string → parsed null", () => {
  assert.equal(normalizeResult(null).parsed, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/rgpResult.test.mjs`
Expected: FAIL (`Cannot find module './rgpResult.mjs'`).

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/rgpResult.mjs
// Extrait l'objet JSON du `result` d'un workflow RGP IAka.
// Forme : <tool>…<tool-output>{JSON}</tool-output></tool> + texte final de l'agent.
// Le bloc <tool-output> est la source fiable (JSON propre) ; le texte final varie
// (JSON nu en lecture, parfois enrobé ```json``` en écriture).
export function normalizeResult(text) {
  if (typeof text !== "string") return { parsed: null, message: "" };
  const trimmed = text.trim();
  const message = trimmed.replace(/<tool>[\s\S]*?<\/tool>/gi, "").trim();

  let jsonText;
  const toolOut = trimmed.match(/<tool-output>([\s\S]*?)<\/tool-output>/i);
  if (toolOut) jsonText = toolOut[1].trim();
  else jsonText = message;

  const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1].trim();

  let candidate = jsonText;
  if (!candidate.startsWith("{")) {
    const s = candidate.indexOf("{");
    const e = candidate.lastIndexOf("}");
    if (s === -1 || e <= s) return { parsed: null, message };
    candidate = candidate.slice(s, e + 1);
  }

  let obj;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return { parsed: null, message };
  }

  // Déballe { json_build_object: {…} } (sortie SQL json_build_object).
  if (obj && typeof obj === "object" && obj.json_build_object && typeof obj.json_build_object === "object") {
    obj = obj.json_build_object;
  }
  return { parsed: obj, message };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/rgpResult.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/rgpResult.mjs server/rgpResult.test.mjs
git commit -m "feat(rgp): normalizeResult — extraction JSON du tool-output IAka"
```

---

### Task 2: `runWorkflowRaw` — exécution workflow renvoyant le result brut

**Files:**
- Modify: `server/iaka.mjs` (extraire un cœur `execWorkflow`, ajouter `runWorkflowRaw`)
- Test: `server/iaka.test.mjs` (ajouter un test ; ne pas casser l'existant)

**Interfaces:**
- Consumes: `cfg` (avec `baseUrl`, `jwt`, `tenantId`, `rgpAppId`, `pollIntervalMs`, `pollTimeoutMs`).
- Produces: `runWorkflowRaw({ prompt: string, cfg, fetchImpl?, sleep? }) => Promise<string>` (le `result` brut du workflow). Lève `IAKA_UPSTREAM` / `IAKA_TIMEOUT`.
- Inchangé : `runWorkflow({ question, cfg, … }) => Promise<FeatureCollection>` (comportement identique après refactor).

- [ ] **Step 1: Write the failing test**

Ajouter à la fin de `server/iaka.test.mjs` :

```javascript
import { runWorkflowRaw } from "./iaka.mjs";

test("runWorkflowRaw renvoie le result brut et envoie l'app_id RGP", async () => {
  const cfg = { baseUrl: "http://x", jwt: "j", tenantId: "t", rgpAppId: "app", pollIntervalMs: 0, pollTimeoutMs: 100 };
  let execBody;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/workflows/execute")) {
      execBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ execution_id: "e1" }) };
    }
    return { ok: true, json: async () => ({ status: "SUCCESS", result: '<tool-output>{"data":[]}</tool-output>' }) };
  };
  const out = await runWorkflowRaw({ prompt: "liste", cfg, fetchImpl, sleep: async () => {} });
  assert.equal(out, '<tool-output>{"data":[]}</tool-output>');
  assert.equal(execBody.app_id, "app");
  assert.equal(execBody.prompt, "liste");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/iaka.test.mjs`
Expected: FAIL (`runWorkflowRaw` non exporté).

- [ ] **Step 3: Refactor `iaka.mjs` — cœur commun + deux sorties**

Remplacer le contenu de `server/iaka.mjs` par :

```javascript
import { extractGeoJSON } from "./geojson.mjs";

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cœur : déclenche l'exécution d'un workflow IAka et poll jusqu'au result brut.
async function execWorkflow({ prompt, appId, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const headers = { Authorization: `Bearer ${cfg.jwt}`, "Content-Type": "application/json" };
  const execPath = cfg.executePath || "/workflows/execute";
  const statusTpl = cfg.statusPath || "/workflows/executions/{id}";

  const execRes = await fetchImpl(`${cfg.baseUrl}${execPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      app_id: appId,
      tenant_id: cfg.tenantId,
      prompt,
      langue: "fr",
      include_traitement: false,
    }),
  });
  if (!execRes.ok) throw new Error("IAKA_UPSTREAM");
  const exec = await execRes.json();
  const executionId = exec.execution_id;
  if (!executionId) throw new Error("IAKA_UPSTREAM");

  const deadline = cfg.pollTimeoutMs;
  let elapsed = 0;
  const startMs = Date.now();
  const statusUrl = `${cfg.baseUrl}${statusTpl.replace("{id}", executionId)}?tenant_id=${cfg.tenantId}`;

  while (elapsed <= deadline) {
    const res = await fetchImpl(statusUrl, { method: "GET", headers });
    if (!res.ok) throw new Error("IAKA_UPSTREAM");
    const body = await res.json();
    if (body.status === "SUCCESS") return body.result;
    if (body.status === "ERROR") throw new Error("IAKA_UPSTREAM");
    if (elapsed >= deadline || (Date.now() - startMs) >= deadline) throw new Error("IAKA_TIMEOUT");
    await sleep(cfg.pollIntervalMs);
    elapsed += cfg.pollIntervalMs || 1;
  }
  throw new Error("IAKA_TIMEOUT");
}

// Carte BDSP : prompt (question) → GeoJSON. Inchangé côté appelant.
export async function runWorkflow({ question, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const result = await execWorkflow({ prompt: question, appId: cfg.appId, cfg, fetchImpl, sleep });
  return extractGeoJSON(result);
}

// RGP : prompt → result brut (chaîne). Le proxy le normalise (normalizeResult).
export async function runWorkflowRaw({ prompt, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  return execWorkflow({ prompt, appId: cfg.rgpAppId, cfg, fetchImpl, sleep });
}
```

- [ ] **Step 4: Run tests (nouveau + non-régression)**

Run: `node --test server/iaka.test.mjs`
Expected: PASS (les tests existants de `runWorkflow` + le nouveau `runWorkflowRaw`).

- [ ] **Step 5: Commit**

```bash
git add server/iaka.mjs server/iaka.test.mjs
git commit -m "feat(rgp): runWorkflowRaw (result brut) via cœur execWorkflow partagé"
```

---

### Task 3: Route proxy `POST /api/rgp/chat`

**Files:**
- Modify: `server/proxy.mjs` (import, `createHandler` param `runRaw`, dispatch, bloc `cfg`)
- Test: `server/proxy.test.mjs` (ajouter des tests)

**Interfaces:**
- Consumes: `runWorkflowRaw` (Task 2), `normalizeResult` (Task 1).
- Produces: `POST /api/rgp/chat` avec body `{ prompt }` → `200 { text, parsed, message }` ; `400 { error:"PROMPT_REQUIS" }` si prompt manquant ; `502/504 { error }` sur erreur IAka.
- `createHandler` accepte désormais `runRaw = runWorkflowRaw` (injectable pour les tests).

- [ ] **Step 1: Write the failing test**

Ajouter à `server/proxy.test.mjs` :

```javascript
test("POST /api/rgp/chat relaie et normalise", async () => {
  const runRaw = async ({ prompt }) =>
    `<tool>createProcedure<tool-input>{"p":"${prompt}"}</tool-input>` +
    `<tool-output>{"data":{"una":"15127/126/2026"}}</tool-output></tool>\n\nCréée.`;
  const server = createServer(createHandler({ cfg, runRaw }));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/rgp/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "crée un PV" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.parsed, { data: { una: "15127/126/2026" } });
    assert.equal(body.message, "Créée.");
  } finally {
    server.close();
  }
});

test("POST /api/rgp/chat sans prompt → 400", async () => {
  const server = createServer(createHandler({ cfg, runRaw: async () => "" }));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/rgp/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "PROMPT_REQUIS");
  } finally {
    server.close();
  }
});

test("POST /api/rgp/chat timeout IAka → 504", async () => {
  const runRaw = async () => { throw new Error("IAKA_TIMEOUT"); };
  const server = createServer(createHandler({ cfg, runRaw }));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/rgp/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x" }),
    });
    assert.equal(res.status, 504);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/proxy.test.mjs`
Expected: FAIL (route inconnue → 404, ou `runRaw` ignoré).

- [ ] **Step 3: Implémenter la route**

Dans `server/proxy.mjs` :

a) En haut, à côté des imports existants, ajouter :
```javascript
import { runWorkflow, runWorkflowRaw } from "./iaka.mjs";
import { normalizeResult } from "./rgpResult.mjs";
```
(Adapter la ligne `import { runWorkflow } ...` existante pour inclure `runWorkflowRaw`.)

b) Signature de `createHandler` — ajouter `runRaw` :
```javascript
export function createHandler({ cfg, run = runWorkflow, runRaw = runWorkflowRaw, identify = runIdentify, fetchImpl = fetch, minioClient }) {
```

c) Dispatch — juste après le bloc `/api/photo` et **avant** `if (req.method !== "POST")` :
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
        const result = await runRaw({ prompt, cfg, fetchImpl });
        const { parsed, message } = normalizeResult(result);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: result, parsed, message }));
      } catch (e) {
        const status = ERROR_STATUS[e.message] ?? 500;
        if (!(e.message in ERROR_STATUS)) console.error(e);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
```

d) Dans le bloc `cfg` du démarrage direct (`if (import.meta.url === …)`), ajouter :
```javascript
    rgpAppId: process.env.IAKA_RGP_APP_ID,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/proxy.test.mjs`
Expected: PASS (existants + 3 nouveaux).

- [ ] **Step 5: Mettre à jour `.env.example`**

Ajouter la ligne (après les autres `IAKA_*`) :
```
IAKA_RGP_APP_ID=7fe23cda-5458-423a-bac3-ca51ef8a2b7b
```

- [ ] **Step 6: Commit**

```bash
git add server/proxy.mjs server/proxy.test.mjs .env.example
git commit -m "feat(rgp): route proxy POST /api/rgp/chat (runWorkflowRaw + normalizeResult)"
```

---

### Task 4: Client front `rgpApi.ts`

**Files:**
- Create: `src/features/rgp/rgpApi.ts`
- Test: `src/features/rgp/rgpApi.test.ts`

**Interfaces:**
- Produces:
  - `type RgpUna = { una: string; type?: string; type_description?: string; synthese?: string | null; urgent?: boolean; sensible?: boolean; groupe?: string | null; commune?: string | null; date_submit?: string; numero?: number; annee?: number }`
  - `type RgpParsed = { data?: RgpUna | RgpUna[]; error?: { code: string; message: string } } | null`
  - `type RgpReply = { text: string; parsed: RgpParsed; message: string }`
  - `sendRgpPrompt(prompt: string, fetchImpl?: typeof fetch) => Promise<RgpReply>`

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/rgp/rgpApi.test.ts
import { describe, it, expect } from "vitest";
import { sendRgpPrompt } from "./rgpApi";

describe("sendRgpPrompt", () => {
  it("poste le prompt et renvoie la réponse normalisée", async () => {
    const fake: typeof fetch = async (_url, init) => {
      const body = JSON.parse((init!.body as string) ?? "{}");
      expect(body.prompt).toBe("crée un PV");
      return new Response(
        JSON.stringify({ text: "raw", parsed: { data: { una: "15127/126/2026" } }, message: "Créée." }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };
    const out = await sendRgpPrompt("crée un PV", fake);
    expect(out.parsed).toEqual({ data: { una: "15127/126/2026" } });
    expect(out.message).toBe("Créée.");
  });

  it("erreur HTTP → throw avec le code", async () => {
    const fake: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "IAKA_TIMEOUT" }), { status: 504 });
    await expect(sendRgpPrompt("x", fake)).rejects.toThrow("IAKA_TIMEOUT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/rgp/rgpApi.test.ts`
Expected: FAIL (module inexistant).

- [ ] **Step 3: Write implementation**

```typescript
// src/features/rgp/rgpApi.ts
export type RgpUna = {
  una: string;
  type?: string;
  type_description?: string;
  synthese?: string | null;
  urgent?: boolean;
  sensible?: boolean;
  groupe?: string | null;
  commune?: string | null;
  date_submit?: string;
  numero?: number;
  annee?: number;
};

export type RgpParsed =
  | { data?: RgpUna | RgpUna[]; error?: { code: string; message: string } }
  | null;

export type RgpReply = { text: string; parsed: RgpParsed; message: string };

export async function sendRgpPrompt(
  prompt: string,
  fetchImpl: typeof fetch = fetch
): Promise<RgpReply> {
  const res = await fetchImpl("/api/rgp/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    let code = "ERREUR_INCONNUE";
    try {
      code = (await res.json()).error ?? code;
    } catch {
      /* ignore */
    }
    throw new Error(code);
  }
  return (await res.json()) as RgpReply;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/rgp/rgpApi.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/rgp/rgpApi.ts src/features/rgp/rgpApi.test.ts
git commit -m "feat(rgp): client front sendRgpPrompt"
```

---

### Task 5: Rendu d'une réponse `RgpResult.tsx`

**Files:**
- Create: `src/features/rgp/RgpResult.tsx`
- Test: `src/features/rgp/RgpResult.test.tsx`

**Interfaces:**
- Consumes: `RgpReply`, `RgpUna` (Task 4).
- Produces: `export default function RgpResult({ reply }: { reply: RgpReply }): JSX.Element`
  - `parsed.error` → message d'erreur.
  - `parsed.data` tableau → une carte par UNA (ou « Aucun résultat » si vide).
  - `parsed.data` objet → une carte.
  - `parsed` null → affiche `message` (ou `text` si message vide), en texte brut.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/rgp/RgpResult.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RgpResult from "./RgpResult";

describe("RgpResult", () => {
  it("carte pour un UNA créé (data objet)", () => {
    render(<RgpResult reply={{ text: "", message: "Créée.", parsed: { data: { una: "15127/126/2026", type: "PVEJ", synthese: "cambriolage", urgent: true } } }} />);
    expect(screen.getByText("15127/126/2026")).toBeInTheDocument();
    expect(screen.getByText(/PVEJ/)).toBeInTheDocument();
  });

  it("liste (data tableau)", () => {
    render(<RgpResult reply={{ text: "", message: "", parsed: { data: [{ una: "15127/1/2026" }, { una: "15127/2/2026" }] } }} />);
    expect(screen.getByText("15127/1/2026")).toBeInTheDocument();
    expect(screen.getByText("15127/2/2026")).toBeInTheDocument();
  });

  it("tableau vide → aucun résultat", () => {
    render(<RgpResult reply={{ text: "", message: "", parsed: { data: [] } }} />);
    expect(screen.getByText(/aucun résultat/i)).toBeInTheDocument();
  });

  it("erreur métier", () => {
    render(<RgpResult reply={{ text: "", message: "", parsed: { error: { code: "groupe_inconnu", message: "Groupe X inconnu" } } }} />);
    expect(screen.getByText(/Groupe X inconnu/)).toBeInTheDocument();
  });

  it("parsed null → texte brut", () => {
    render(<RgpResult reply={{ text: "brut", message: "réponse libre", parsed: null }} />);
    expect(screen.getByText("réponse libre")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/rgp/RgpResult.test.tsx`
Expected: FAIL (module inexistant).

- [ ] **Step 3: Write implementation**

```tsx
// src/features/rgp/RgpResult.tsx
import type { RgpReply, RgpUna } from "./rgpApi";

function Card({ una }: { una: RgpUna }) {
  const champs: [string, string | undefined][] = [
    ["Type", una.type],
    ["Synthèse", una.synthese ?? undefined],
    ["Groupe", una.groupe ?? undefined],
    ["Commune", una.commune ?? undefined],
    ["Urgent", una.urgent === undefined ? undefined : una.urgent ? "oui" : "non"],
    ["Sensible", una.sensible === undefined ? undefined : una.sensible ? "oui" : "non"],
  ];
  return (
    <div style={{ border: "1px solid var(--c--globals--colors--gray-200, #ddd)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ fontWeight: 700, color: "#000091", marginBottom: 6 }}>{una.una}</div>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px", margin: 0 }}>
        {champs.filter(([, v]) => v != null && v !== "").map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "#5C5F63" }}>{k}</dt>
            <dd style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function RgpResult({ reply }: { reply: RgpReply }) {
  const { parsed, message, text } = reply;

  if (parsed && "error" in parsed && parsed.error) {
    return (
      <p role="alert" style={{ color: "#e1000f", margin: 0 }}>
        {parsed.error.message} ({parsed.error.code})
      </p>
    );
  }

  const data = parsed && "data" in parsed ? parsed.data : undefined;

  if (Array.isArray(data)) {
    if (data.length === 0) return <p style={{ margin: 0 }}>Aucun résultat.</p>;
    return (
      <div>
        {message && <p style={{ margin: "0 0 8px" }}>{message}</p>}
        {data.map((u, i) => <Card key={u.una ?? i} una={u} />)}
      </div>
    );
  }

  if (data && typeof data === "object") {
    return (
      <div>
        {message && <p style={{ margin: "0 0 8px" }}>{message}</p>}
        <Card una={data} />
      </div>
    );
  }

  return <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{message || text}</p>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/rgp/RgpResult.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/rgp/RgpResult.tsx src/features/rgp/RgpResult.test.tsx
git commit -m "feat(rgp): RgpResult — carte/liste/erreur/texte"
```

---

### Task 6: Page `RgpApp.tsx` + intégration navigation

**Files:**
- Create: `src/features/rgp/RgpApp.tsx`
- Modify: `src/App.tsx` (type `View`, `AppNav`, rendu)
- Test: `src/features/rgp/RgpApp.test.tsx`

**Interfaces:**
- Consumes: `sendRgpPrompt`, `RgpReply` (Task 4) ; `RgpResult` (Task 5).
- Produces: `export default function RgpApp(): JSX.Element` — zone de prompt + fil d'échanges (chaque envoi indépendant, pas de mémoire).

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/rgp/RgpApp.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RgpApp from "./RgpApp";
import * as api from "./rgpApi";

describe("RgpApp", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("envoie le prompt et affiche le résultat", async () => {
    vi.spyOn(api, "sendRgpPrompt").mockResolvedValue({
      text: "", message: "Créée.",
      parsed: { data: { una: "15127/126/2026", type: "PVEJ" } },
    });
    render(<RgpApp />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "crée un PV" } });
    fireEvent.click(screen.getByRole("button", { name: /envoyer/i }));
    await waitFor(() => expect(screen.getByText("15127/126/2026")).toBeInTheDocument());
    expect(api.sendRgpPrompt).toHaveBeenCalledWith("crée un PV");
  });

  it("affiche une erreur si l'appel échoue", async () => {
    vi.spyOn(api, "sendRgpPrompt").mockRejectedValue(new Error("IAKA_TIMEOUT"));
    render(<RgpApp />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /envoyer/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/rgp/RgpApp.test.tsx`
Expected: FAIL (module inexistant).

- [ ] **Step 3: Écrire `RgpApp.tsx`**

```tsx
// src/features/rgp/RgpApp.tsx
import { useState } from "react";
import { sendRgpPrompt, type RgpReply } from "./rgpApi";
import RgpResult from "./RgpResult";

type Echange = { prompt: string; reply?: RgpReply; error?: string };

const MESSAGES: Record<string, string> = {
  IAKA_TIMEOUT: "Délai dépassé. Réessayez.",
  IAKA_UPSTREAM: "Service RGP indisponible. Réessayez.",
  ERREUR_INCONNUE: "Erreur inconnue.",
};

export default function RgpApp() {
  const [prompt, setPrompt] = useState("");
  const [echanges, setEchanges] = useState<Echange[]>([]);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = prompt.trim();
    if (!p || loading) return;
    setPrompt("");
    setLoading(true);
    const idx = echanges.length;
    setEchanges((xs) => [...xs, { prompt: p }]);
    try {
      const reply = await sendRgpPrompt(p);
      setEchanges((xs) => xs.map((x, i) => (i === idx ? { ...x, reply } : x)));
    } catch (err) {
      const code = (err as Error).message;
      setEchanges((xs) => xs.map((x, i) => (i === idx ? { ...x, error: MESSAGES[code] ?? code } : x)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "2rem", maxWidth: 820, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <h1 style={{ fontSize: 20, color: "#000091", marginTop: 0 }}>RGP — Assistant procédures</h1>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {echanges.map((x, i) => (
          <div key={i}>
            <p style={{ fontWeight: 600, margin: "0 0 6px" }}>{x.prompt}</p>
            {x.reply && <RgpResult reply={x.reply} />}
            {x.error && <p role="alert" style={{ color: "#e1000f", margin: 0 }}>{x.error}</p>}
            {!x.reply && !x.error && <p style={{ margin: 0, color: "#5b5b6b" }}>Traitement en cours…</p>}
          </div>
        ))}
      </div>

      <form onSubmit={submit} style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          type="text"
          aria-label="Demande RGP"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ex : je rentre d'un cambriolage, donne-moi un numéro de PV urgent"
          style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--c--globals--colors--gray-300, #ccc)" }}
        />
        <button type="submit" disabled={loading} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#000091", color: "#fff", cursor: loading ? "default" : "pointer", fontWeight: 600 }}>
          Envoyer
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/rgp/RgpApp.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Intégrer dans `src/App.tsx`**

a) Import (avec les autres imports de features) :
```tsx
import RgpApp from "./features/rgp/RgpApp";
```

b) Type `View` :
```tsx
type View = "saisies" | "carte" | "rgp";
```

c) Dans `AppNav`, ajouter l'entrée (icône Material, pas d'emoji) — le tableau `items` :
```tsx
    { key: "rgp", label: "RGP", icon: "gavel" },
```

d) Dans le rendu du `MainLayout`, remplacer le ternaire `view === "saisies" ? (...) : (...)` par un rendu à trois cas :
```tsx
          {view === "saisies" ? (
            <div style={{ height: "100%", minWidth: 0 }}>
              <SaisiesApp />
            </div>
          ) : view === "rgp" ? (
            <div style={{ height: "100%", minWidth: 0 }}>
              <RgpApp />
            </div>
          ) : (
            /* … bloc carte existant inchangé … */
          )}
```
(Conserver le bloc carte existant tel quel dans la branche finale.)

- [ ] **Step 6: Vérifier build + suite complète**

Run: `npm run build`
Expected: succès TypeScript + Vite.

Run: `npx vitest run`
Expected: toute la suite front PASS.

Run: `node --test server/rgpResult.test.mjs server/iaka.test.mjs server/proxy.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/features/rgp/RgpApp.tsx src/features/rgp/RgpApp.test.tsx
git commit -m "feat(rgp): page RGP (chat) + entrée navigation"
```

---

## Notes d'exécution (hors code)

Le workflow IAka RGP est **déjà construit et validé** (voir `docs/iaka-rgp-workflow.md`). Pour faire tourner l'app end-to-end en local :
- `.env` doit définir `IAKA_RGP_APP_ID=7fe23cda-5458-423a-bac3-ca51ef8a2b7b` (+ `IAKA_BASE_URL`/`IAKA_JWT`/`IAKA_TENANT_ID` déjà présents).
- Lancer `npm run dev:all` (proxy + vite).

Vérification manuelle (une création alloue un UNA réel, irréversible) : préférer d'abord une **lecture** (« liste les procédures 2026 ») pour valider le rendu sans effet de bord.
