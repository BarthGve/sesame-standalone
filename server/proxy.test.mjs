import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "./proxy.mjs";

const cfg = { pollIntervalMs: 0, pollTimeoutMs: 100 };
const fc = { type: "FeatureCollection", features: [] };

async function withServer(run, fn) {
  const server = createServer(createHandler({ cfg, run }));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    server.close();
  }
}

test("POST /api/query async → 202 + jobId, status done avec le GeoJSON", async () => {
  await withServer(async () => fc, async (port) => {
    const start = await fetch(`http://localhost:${port}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "communes" }),
    });
    assert.equal(start.status, 202);
    const { jobId } = await start.json();
    assert.ok(jobId);
    await new Promise((r) => setTimeout(r, 10));
    const st = await fetch(`http://localhost:${port}/api/job/status?jobId=${jobId}`);
    assert.equal(st.status, 200);
    const body = await st.json();
    assert.equal(body.status, "done");
    assert.deepEqual(body.result, fc);
  });
});

test("erreur amont → job en erreur avec le message IAKA_UPSTREAM", async () => {
  const run = async () => { throw new Error("IAKA_UPSTREAM"); };
  await withServer(run, async (port) => {
    const start = await fetch(`http://localhost:${port}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "x" }),
    });
    assert.equal(start.status, 202);
    const { jobId } = await start.json();
    await new Promise((r) => setTimeout(r, 10));
    const st = await fetch(`http://localhost:${port}/api/job/status?jobId=${jobId}`);
    const body = await st.json();
    assert.equal(body.status, "error");
    assert.equal(body.error, "IAKA_UPSTREAM");
  });
});

test("timeout → job en erreur avec IAKA_TIMEOUT", async () => {
  const run = async () => { throw new Error("IAKA_TIMEOUT"); };
  await withServer(run, async (port) => {
    const start = await fetch(`http://localhost:${port}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "x" }),
    });
    assert.equal(start.status, 202);
    const { jobId } = await start.json();
    await new Promise((r) => setTimeout(r, 10));
    const st = await fetch(`http://localhost:${port}/api/job/status?jobId=${jobId}`);
    const body = await st.json();
    assert.equal(body.status, "error");
    assert.equal(body.error, "IAKA_TIMEOUT");
  });
});

test("question manquante → 400", async () => {
  await withServer(async () => fc, async (port) => {
    const res = await fetch(`http://localhost:${port}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

test("GET /api/query → 404 (méthode non gérée)", async () => {
  await withServer(async () => fc, async (port) => {
    const res = await fetch(`http://localhost:${port}/api/query`, { method: "GET" });
    assert.equal(res.status, 404);
  });
});

test("POST /api/identify async → 202 + jobId, status done avec l'objet", async () => {
  const objet = { categorie: "ARME", libelle: "Pistolet" };
  const h = createHandler({ cfg, identify: async () => objet });
  const startRes = mockRes();
  await h(mockReq("POST", "/api/identify", JSON.stringify({ imageBase64: "AA==", mime: "image/jpeg", filename: "a.jpg" })), startRes);
  assert.equal(startRes.code, 202);
  const jobId = JSON.parse(startRes.body).jobId;
  assert.ok(jobId);
  await new Promise((r) => setTimeout(r, 10));
  const statusRes = mockRes();
  await h(mockReq("GET", `/api/job/status?jobId=${jobId}`), statusRes);
  assert.equal(statusRes.code, 200);
  const body = JSON.parse(statusRes.body);
  assert.equal(body.status, "done");
  assert.deepEqual(body.result, objet);
});

test("POST /api/identify : réessaie sur OBJET_INVALID puis succès", async () => {
  let calls = 0;
  const objet = { categorie: "DIVERS" };
  const identify = async () => {
    calls++;
    if (calls < 3) throw new Error("OBJET_INVALID");
    return objet;
  };
  const h = createHandler({ cfg: { ...cfg, maxAttempts: 3 }, identify });
  const startRes = mockRes();
  await h(mockReq("POST", "/api/identify", JSON.stringify({ imageBase64: "AA==", mime: "image/jpeg" })), startRes);
  assert.equal(startRes.code, 202);
  const jobId = JSON.parse(startRes.body).jobId;
  await new Promise((r) => setTimeout(r, 10));
  const statusRes = mockRes();
  await h(mockReq("GET", `/api/job/status?jobId=${jobId}`), statusRes);
  const body = JSON.parse(statusRes.body);
  assert.equal(body.status, "done");
  assert.deepEqual(body.result, objet);
  assert.equal(calls, 3, "a réessayé jusqu'au succès");
});

test("POST /api/identify : image manquante → 400", async () => {
  const h = createHandler({ cfg, identify: async () => ({}) });
  const res = mockRes();
  await h(mockReq("POST", "/api/identify", JSON.stringify({})), res);
  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).error, "IMAGE_REQUISE");
});

// --- Forward vers rgp-api ---

function mockRes() {
  return {
    code: 0, headers: null, body: "", chunks: [],
    writeHead(c, h) { this.code = c; this.headers = h; return this; },
    end(b) { this.body = b || ""; },
    // Les ecritures sont conservees : les reponses SSE passent par write(), pas end().
    on() {}, once() {}, emit() {}, write(c) { this.chunks.push(String(c)); return true; },
    flux() { return this.chunks.join(""); },
  };
}
function mockReq(method, url, body) {
  const h = {};
  return {
    method, url, headers: {},
    on(ev, cb) { h[ev] = cb; if (ev === "end") { if (h.data && body) h.data(body); cb(); } },
  };
}

test("POST /api/perquisition -> POST {rgp}/perquisition avec Bearer", async () => {
  let captured;
  const fetchImpl = async (u, init) => { captured = { u, init }; return { status: 200, text: async () => JSON.stringify({ data: { id: 1 } }) }; };
  const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080", rgpApiToken: "tok" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("POST", "/api/perquisition", JSON.stringify({ adresse: "1 rue" })), res);
  assert.equal(captured.u, "http://x:8080/perquisition");
  assert.equal(captured.init.headers.Authorization, "Bearer tok");
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.body).data.id, 1);
});

test("GET /api/perquisitions -> transmet la query", async () => {
  let captured;
  const fetchImpl = async (u) => { captured = u; return { status: 200, text: async () => JSON.stringify({ data: [] }) }; };
  const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("GET", "/api/perquisitions?una=1/2/2024"), res);
  assert.equal(captured, "http://x:8080/perquisitions?una=1/2/2024");
});

test("relaie 502 si rgp-api injoignable", async () => {
  const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
  const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("GET", "/api/perquisitions"), res);
  assert.equal(res.code, 502);
  assert.equal(JSON.parse(res.body).error, "RGP_UPSTREAM");
});

test("proxy forward: POST /api/perquisition/objets -> /perquisition/objets avec Bearer", async () => {
  let captured;
  const fetchImpl = async (u, init) => { captured = { u, init }; return { status: 200, text: async () => JSON.stringify({ data: { id: 1 } }) }; };
  const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080", rgpApiToken: "tok" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("POST", "/api/perquisition/objets", JSON.stringify({ perquisition_id: 1, objets: [] })), res);
  assert.equal(captured.u, "http://x:8080/perquisition/objets");
  assert.equal(captured.init.headers.Authorization, "Bearer tok");
  assert.equal(res.code, 200);
});

test("proxy forward: POST /api/perquisition/objet/update -> /perquisition/objet/update avec Bearer", async () => {
  let captured;
  const fetchImpl = async (u, init) => { captured = { u, init }; return { status: 200, text: async () => JSON.stringify({ data: { id: 1 } }) }; };
  const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080", rgpApiToken: "tok" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("POST", "/api/perquisition/objet/update", JSON.stringify({ objet_id: 1, categorie: "DIVERS", champs: [] })), res);
  assert.equal(captured.u, "http://x:8080/perquisition/objet/update");
  assert.equal(captured.init.headers.Authorization, "Bearer tok");
  assert.equal(res.code, 200);
});

// --- Forward vers rens-api ---

test("GET /api/rens/fiches relaie vers rens-api avec le token", async () => {
  let captured;
  const fetchImpl = async (u, init) => { captured = { u, init }; return { status: 200, text: async () => JSON.stringify({ data: [] }) }; };
  const h = createHandler({ cfg: { rensApiUrl: "http://x:8081", rensApiToken: "tok" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("GET", "/api/rens/fiches?date=2026-03-04"), res);
  assert.equal(captured.u, "http://x:8081/fiches?date=2026-03-04");
  assert.equal(captured.init.headers.Authorization, "Bearer tok");
  assert.equal(res.code, 200);
});

test("GET /api/rens/fiche?id=12 relaie vers /fiches/12", async () => {
  let captured;
  const fetchImpl = async (u) => { captured = u; return { status: 200, text: async () => JSON.stringify({ data: { id: 12 } }) }; };
  const h = createHandler({ cfg: { rensApiUrl: "http://x:8081" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("GET", "/api/rens/fiche?id=12"), res);
  assert.equal(captured, "http://x:8081/fiches/12");
});

// Le status du job est asservi au worker (runJob, microtâches) : on laisse tourner un
// court instant après le 202 avant d'interroger /api/job/status.
async function statutJob(h, jobId) {
  await new Promise((r) => setTimeout(r, 20));
  const st = mockRes();
  await h(mockReq("GET", `/api/job/status?jobId=${jobId}`), st);
  return { code: st.code, body: JSON.parse(st.body) };
}

test("POST /api/rens/synthese : job async → synthèse (autonome) puis zoom (prompt = synthèse)", async () => {
  const seen = [];
  const rensWorkflow = async ({ prompt, appId }) => {
    seen.push({ prompt, appId });
    if (appId === "wSynth") return "## Synthèse\nRAS ce jour.";
    return "<tool>listFiches<tool-output>{}</tool-output></tool>\n\n## Zoom\nDétail du signal.";
  };
  const h = createHandler({ cfg: { rensSyntheseAppId: "wSynth", rensZoomAppId: "wZoom" }, rensWorkflow });
  const res = mockRes();
  await h(mockReq("POST", "/api/rens/synthese", JSON.stringify({})), res);
  assert.equal(res.code, 202);               // job store : réponse immédiate + jobId
  const { jobId } = JSON.parse(res.body);
  assert.ok(jobId);
  const { code, body } = await statutJob(h, jobId);
  assert.equal(code, 200);
  assert.equal(body.status, "done");
  // Séquentiel : synthèse (autonome) puis zoom qui reçoit la SORTIE de la synthèse.
  assert.deepEqual(seen.map((s) => s.appId), ["wSynth", "wZoom"]);
  assert.equal(seen[0].prompt, undefined);
  assert.equal(seen[1].prompt, "## Synthèse\nRAS ce jour.");
  assert.equal(body.result.markdown, "## Synthèse\nRAS ce jour.\n\n---\n\n## Zoom\nDétail du signal.");
});

test("POST /api/rens/synthese : zoom en échec → synthèse seule (job done)", async () => {
  const rensWorkflow = async ({ appId }) => {
    if (appId === "wSynth") return "## Synthèse\nRAS.";
    throw new Error("IAKA_UPSTREAM"); // zoom tombe : best-effort, ne fait pas échouer le job
  };
  const h = createHandler({ cfg: { rensSyntheseAppId: "wSynth", rensZoomAppId: "wZoom" }, rensWorkflow });
  const res = mockRes();
  await h(mockReq("POST", "/api/rens/synthese", JSON.stringify({})), res);
  assert.equal(res.code, 202);
  const { body } = await statutJob(h, JSON.parse(res.body).jobId);
  assert.equal(body.status, "done");
  assert.equal(body.result.markdown, "## Synthèse\nRAS.");
});

test("POST /api/rens/synthese : synthèse en échec → job en erreur", async () => {
  const rensWorkflow = async () => { throw new Error("RENS_INVALIDE"); };
  const h = createHandler({ cfg: { rensSyntheseAppId: "wSynth", rensZoomAppId: "wZoom" }, rensWorkflow });
  const res = mockRes();
  await h(mockReq("POST", "/api/rens/synthese", JSON.stringify({})), res);
  assert.equal(res.code, 202);
  const { body } = await statutJob(h, JSON.parse(res.body).jobId);
  assert.equal(body.status, "error");
  assert.equal(body.error, "RENS_INVALIDE");
});

test("POST /api/query : applique le poll carte (délai/intervalle dédiés) et transmet fetchImpl", async () => {
  let captured;
  const myFetch = (async () => new Response("{}")); // fetchImpl injecté, distinct du défaut
  const run = async ({ question, cfg, fetchImpl }) => { captured = { question, cfg, fetchImpl }; return { type: "FeatureCollection", features: [] }; };
  const h = createHandler({ cfg: { cartePollTimeoutMs: 111, cartePollIntervalMs: 22 }, run, fetchImpl: myFetch });
  const res = mockRes();
  await h(mockReq("POST", "/api/query", JSON.stringify({ question: "communes" })), res);
  assert.equal(res.code, 202);
  const { body } = await statutJob(h, JSON.parse(res.body).jobId);
  assert.equal(body.status, "done");
  assert.equal(captured.cfg.pollTimeoutMs, 111); // délai carte, pas le défaut
  assert.equal(captured.cfg.pollIntervalMs, 22); // intervalle carte
  assert.equal(captured.fetchImpl, myFetch);     // fetchImpl bien transmis (injectable)
});

// --- Photos : le BFF forwarde /api/photo vers rgp-api /photo (MinIO interne) ---

test("photo upload: POST /api/photo -> forward rgp-api /photo avec Bearer, relaie la réponse", async () => {
  let captured;
  const fetchImpl = async (u, init) => { captured = { u, init }; return { status: 200, text: async () => JSON.stringify({ data: { key: "abc.jpg" } }) }; };
  const h = createHandler({ cfg: { rgpApiUrl: "http://rgp:8080", rgpApiToken: "tok" }, fetchImpl });
  const res = mockRes();
  const payload = JSON.stringify({ imageBase64: Buffer.from("hello").toString("base64"), mime: "image/jpeg" });
  await h(mockReq("POST", "/api/photo", payload), res);
  assert.equal(captured.u, "http://rgp:8080/photo");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, "Bearer tok");
  assert.equal(captured.init.body, payload); // corps relayé tel quel (validation faite par rgp-api)
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.body).data.key, "abc.jpg");
});

test("photo upload: relaie l'erreur amont (400) telle quelle", async () => {
  const fetchImpl = async () => ({ status: 400, text: async () => JSON.stringify({ error: { code: "bad_request", message: "type image invalide" } }) });
  const h = createHandler({ cfg: { rgpApiUrl: "http://rgp:8080", rgpApiToken: "tok" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("POST", "/api/photo", JSON.stringify({ imageBase64: "x", mime: "text/html" })), res);
  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).error.code, "bad_request");
});

test("photo upload: rgp-api injoignable -> 502 PHOTO_UPLOAD", async () => {
  const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
  const h = createHandler({ cfg: { rgpApiUrl: "http://rgp:8080" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("POST", "/api/photo", JSON.stringify({})), res);
  assert.equal(res.code, 502);
  assert.equal(JSON.parse(res.body).error, "PHOTO_UPLOAD");
});

test("photo serve: GET /api/photo?key=x -> octets relayés + en-têtes de durcissement navigateur", async () => {
  let captured;
  const fetchImpl = async (u, init) => { captured = { u, init }; return { ok: true, status: 200, arrayBuffer: async () => Buffer.from("PNGBYTES") }; };
  const h = createHandler({ cfg: { rgpApiUrl: "http://rgp:8080", rgpApiToken: "tok" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("GET", "/api/photo?key=abc.png"), res);
  assert.equal(captured.u, "http://rgp:8080/photo?key=abc.png");
  assert.equal(captured.init.headers.Authorization, "Bearer tok");
  assert.equal(res.code, 200);
  assert.equal(res.headers["Content-Type"], "image/png"); // dérivé de la clé
  assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(res.headers["Content-Disposition"], "inline");
  assert.equal(Buffer.from(res.body).toString(), "PNGBYTES"); // binaire relayé sans .text()
});

test("photo serve: clé de traversée -> 400 au BFF, sans appel amont", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, status: 200, arrayBuffer: async () => Buffer.from("") }; };
  const h = createHandler({ cfg: { rgpApiUrl: "http://rgp:8080" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("GET", "/api/photo?key=../secret"), res);
  assert.equal(res.code, 400);
  assert.equal(called, false, "aucun appel amont sur clé invalide");
});

test("photo serve: 404 amont relayé en JSON (pas de flux binaire)", async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ error: { code: "not_found", message: "Photo introuvable" } }) });
  const h = createHandler({ cfg: { rgpApiUrl: "http://rgp:8080" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("GET", "/api/photo?key=zzz.png"), res);
  assert.equal(res.code, 404);
  assert.equal(JSON.parse(res.body).error.code, "not_found");
});

test("proxy forward: POST /api/perquisition/objet/delete -> /perquisition/objet/delete avec Bearer", async () => {
  let captured;
  const fetchImpl = async (u, init) => { captured = { u, init }; return { status: 200, text: async () => JSON.stringify({ data: { id: 1 } }) }; };
  const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080", rgpApiToken: "tok" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("POST", "/api/perquisition/objet/delete", JSON.stringify({ objet_id: 1 })), res);
  assert.equal(captured.u, "http://x:8080/perquisition/objet/delete");
  assert.equal(captured.init.headers.Authorization, "Bearer tok");
  assert.equal(res.code, 200);
});

// --- Route RGP chat (IAka RGP workflow) ---

test("POST /api/rgp/chat async → 202 + jobId, status done relaie/injecte la date/normalise", async () => {
  let forwarded;
  const runRaw = async ({ prompt }) => {
    forwarded = prompt;
    return (
      `<tool>createProcedure<tool-input>{}</tool-input>` +
      `<tool-output>{"data":{"una":"15127/126/2026"}}</tool-output></tool>\n\nCréée.`
    );
  };
  const server = createServer(createHandler({ cfg, runRaw }));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const start = await fetch(`http://localhost:${port}/api/rgp/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "crée un PV" }),
    });
    assert.equal(start.status, 202);
    const { jobId } = await start.json();
    assert.ok(jobId);
    await new Promise((r) => setTimeout(r, 10));
    const st = await fetch(`http://localhost:${port}/api/job/status?jobId=${jobId}`);
    const body = await st.json();
    assert.equal(body.status, "done");
    assert.deepEqual(body.result.parsed, { data: { una: "15127/126/2026" } });
    assert.equal(body.result.message, "Créée.");
    // le prompt transmis à IAka contient la date du jour + le prompt utilisateur
    assert.match(forwarded, /date du jour est \d{4}-\d{2}-\d{2}/);
    assert.ok(forwarded.includes("crée un PV"));
  } finally {
    server.close();
  }
});

test("POST /api/rgp/chat réessaie si l'agent décrit l'appel sans l'exécuter", async () => {
  let calls = 0;
  const runRaw = async () => {
    calls++;
    if (calls === 1)
      return '{"call":"modifyProcedure","args":{"una":"15127/128/2026","sensible":true}}';
    return (
      '<tool>modifyProcedure<tool-input>{}</tool-input>' +
      '<tool-output>{"data":{"una":"15127/128/2026","sensible":true}}</tool-output></tool>\n\nPassée en sensible.'
    );
  };
  const server = createServer(createHandler({ cfg, runRaw }));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const start = await fetch(`http://localhost:${port}/api/rgp/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "bascule le 128 en sensible" }),
    });
    assert.equal(start.status, 202);
    const { jobId } = await start.json();
    await new Promise((r) => setTimeout(r, 10));
    const st = await fetch(`http://localhost:${port}/api/job/status?jobId=${jobId}`);
    const body = await st.json();
    assert.equal(body.status, "done");
    assert.equal(calls, 2);
    assert.deepEqual(body.result.parsed, { data: { una: "15127/128/2026", sensible: true } });
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

test("POST /api/rgp/chat timeout IAka → job en erreur avec IAKA_TIMEOUT", async () => {
  const runRaw = async () => { throw new Error("IAKA_TIMEOUT"); };
  const server = createServer(createHandler({ cfg, runRaw }));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const start = await fetch(`http://localhost:${port}/api/rgp/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x" }),
    });
    assert.equal(start.status, 202);
    const { jobId } = await start.json();
    await new Promise((r) => setTimeout(r, 10));
    const st = await fetch(`http://localhost:${port}/api/job/status?jobId=${jobId}`);
    const body = await st.json();
    assert.equal(body.status, "error");
    assert.equal(body.error, "IAKA_TIMEOUT");
  } finally {
    server.close();
  }
});

test("POST /api/pvtcmp async → 202 + jobId, status done avec {texte} (retry sur PVTCMP_INGESTION)", async () => {
  let calls = 0;
  const pvtcmp = async () => {
    calls++;
    if (calls < 3) throw new Error("PVTCMP_INGESTION");
    return "<h2>Saisine</h2><p>...</p>";
  };
  const server = createServer(createHandler({ cfg: { ...cfg, maxAttempts: 3 }, pvtcmp }));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const start = await fetch(`http://localhost:${port}/api/pvtcmp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ base64: "AA==" }] }),
    });
    assert.equal(start.status, 202);
    const { jobId } = await start.json();
    assert.ok(jobId);
    await new Promise((r) => setTimeout(r, 10));
    const st = await fetch(`http://localhost:${port}/api/job/status?jobId=${jobId}`);
    const body = await st.json();
    assert.equal(body.status, "done");
    assert.equal(body.result.texte, "<h2>Saisine</h2><p>...</p>");
    assert.equal(calls, 3, "a réessayé jusqu'au succès");
  } finally {
    server.close();
  }
});

test("POST /api/pvtcmp : PVTCMP_INGESTION persistant → job en erreur", async () => {
  const pvtcmp = async () => { throw new Error("PVTCMP_INGESTION"); };
  const server = createServer(createHandler({ cfg: { ...cfg, maxAttempts: 2 }, pvtcmp }));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const start = await fetch(`http://localhost:${port}/api/pvtcmp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ base64: "AA==" }] }),
    });
    assert.equal(start.status, 202);
    const { jobId } = await start.json();
    await new Promise((r) => setTimeout(r, 10));
    const st = await fetch(`http://localhost:${port}/api/job/status?jobId=${jobId}`);
    const body = await st.json();
    assert.equal(body.status, "error");
    assert.equal(body.error, "PVTCMP_INGESTION");
  } finally {
    server.close();
  }
});

test("POST /api/pvtcmp : fichiers manquants → 400", async () => {
  const server = createServer(createHandler({ cfg, pvtcmp: async () => ({}) }));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/pvtcmp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

// --- /api/synthese async + /api/job/status générique ---

test("POST /api/synthese rend 202 + jobId, puis /api/job/status livre le résultat", async () => {
  const h = createHandler({ cfg, synthese: async () => "SYNTHESE OK" });
  const startRes = mockRes();
  await h(mockReq("POST", "/api/synthese", JSON.stringify({ files: [{ base64: "x" }] })), startRes);
  assert.equal(startRes.code, 202);
  const jobId = JSON.parse(startRes.body).jobId;
  assert.ok(jobId);
  // laisser le worker finir
  await new Promise((r) => setTimeout(r, 10));
  const statusRes = mockRes();
  await h(mockReq("GET", `/api/job/status?jobId=${jobId}`), statusRes);
  assert.equal(statusRes.code, 200);
  const body = JSON.parse(statusRes.body);
  assert.equal(body.status, "done");
  assert.deepEqual(body.result, { texte: "SYNTHESE OK" });
});

test("GET /api/job/status jobId inconnu → 404", async () => {
  const h = createHandler({ cfg });
  const res = mockRes();
  await h(mockReq("GET", "/api/job/status?jobId=nope"), res);
  assert.equal(res.code, 404);
});

test("worker jette une erreur NON whitelistée → /api/job/status renvoie error=INTERNAL_ERROR (pas le message brut)", async () => {
  const h = createHandler({ cfg, synthese: async () => { throw new Error("boom"); } });
  const startRes = mockRes();
  await h(mockReq("POST", "/api/synthese", JSON.stringify({ files: [{ base64: "x" }] })), startRes);
  const jobId = JSON.parse(startRes.body).jobId;
  await new Promise((r) => setTimeout(r, 10));
  const statusRes = mockRes();
  await h(mockReq("GET", `/api/job/status?jobId=${jobId}`), statusRes);
  const body = JSON.parse(statusRes.body);
  assert.equal(body.status, "error");
  assert.equal(body.error, "INTERNAL_ERROR");
});

test("worker jette une erreur whitelistée (SYNTHESE_UPSTREAM) → /api/job/status la renvoie telle quelle", async () => {
  const h = createHandler({ cfg, synthese: async () => { throw new Error("SYNTHESE_UPSTREAM"); } });
  const startRes = mockRes();
  await h(mockReq("POST", "/api/synthese", JSON.stringify({ files: [{ base64: "x" }] })), startRes);
  const jobId = JSON.parse(startRes.body).jobId;
  await new Promise((r) => setTimeout(r, 10));
  const statusRes = mockRes();
  await h(mockReq("GET", `/api/job/status?jobId=${jobId}`), statusRes);
  const body = JSON.parse(statusRes.body);
  assert.equal(body.status, "error");
  assert.equal(body.error, "SYNTHESE_UPSTREAM");
});

// --- Front statique (dist/) ---

test("GET / sert index.html quand staticDir est fourni", async () => {
  const TMP_DIST = mkdtempSync(join(tmpdir(), "proxy-dist-"));
  writeFileSync(join(TMP_DIST, "index.html"), "<!doctype html><html><body>ok</body></html>");
  const h = createHandler({ cfg: { staticDir: TMP_DIST } });
  const res = mockRes();
  await h(mockReq("GET", "/"), res);
  assert.equal(res.code, 200);
  assert.match(String(res.body), /<!doctype html>/i);
  // GET / doit servir index.html en text/html (sinon le navigateur télécharge la SPA).
  assert.match(res.headers["Content-Type"], /text\/html/);
});

test("GET /assets/x inexistant → fallback SPA sur index.html", async () => {
  const TMP_DIST = mkdtempSync(join(tmpdir(), "proxy-dist-"));
  writeFileSync(join(TMP_DIST, "index.html"), "<!doctype html><html><body>ok</body></html>");
  const h = createHandler({ cfg: { staticDir: TMP_DIST } });
  const res = mockRes();
  await h(mockReq("GET", "/assets/inexistant.js"), res);
  assert.equal(res.code, 200);
  assert.match(String(res.body), /<!doctype html>/i);
});

test("sans staticDir, comportement inchangé (404)", async () => {
  const h = createHandler({ cfg });
  const res = mockRes();
  await h(mockReq("GET", "/"), res);
  assert.equal(res.code, 404);
});

test("GET /api/inconnu avec staticDir fourni → toujours 404 (jamais servi comme fichier statique)", async () => {
  const TMP_DIST = mkdtempSync(join(tmpdir(), "proxy-dist-"));
  writeFileSync(join(TMP_DIST, "index.html"), "<!doctype html><html><body>ok</body></html>");
  const h = createHandler({ cfg: { staticDir: TMP_DIST } });
  const res = mockRes();
  await h(mockReq("GET", "/api/inconnu"), res);
  assert.equal(res.code, 404);
});

// --- Ariane RAG : chat SSE et purge du corpus ---

// cfg complet : corpus + hote OpenAI-compatible + iak (les deux capacites actives).
// ragModel fait partie des prerequis de chatActif : sans lui la route repondrait
// ARIANE_RAG_INDISPONIBLE sans jamais atteindre le code sous test.
const cfgRag = { ragBaseUrl: "https://iaka-chat.test", ragCorpusId: "corpus-demo", ragIakId: "iak-1", ragModel: "modele-test" };
// Toute tentative d'appel reseau fait echouer le test : sert a prouver qu'un
// garde-fou a bien coupe AVANT le premier octet sortant.
const fetchInterdit = async () => { throw new Error("APPEL_RESEAU_INTERDIT"); };

test("POST /api/ariane/chat relaie les deltas en SSE puis [DONE]", async () => {
  const ragChat = async ({ messages, onDelta }) => {
    assert.deepEqual(messages, [{ role: "user", content: "Qui est mis en cause ?" }]);
    onDelta("Le mis ");
    onDelta("en cause est…");
  };
  const h = createHandler({ cfg: cfgRag, ragChat });
  const res = mockRes();
  await h(mockReq("POST", "/api/ariane/chat", JSON.stringify({ messages: [{ role: "user", content: "Qui est mis en cause ?" }] })), res);
  assert.equal(res.code, 200);
  assert.equal(res.headers["Content-Type"], "text/event-stream");
  assert.equal(
    res.flux(),
    'data: {"delta":"Le mis "}\n\ndata: {"delta":"en cause est…"}\n\ndata: [DONE]\n\n',
  );
});

test("POST /api/ariane/chat sans messages → 400", async () => {
  const h = createHandler({ cfg: cfgRag, ragChat: fetchInterdit });
  const res = mockRes();
  await h(mockReq("POST", "/api/ariane/chat", JSON.stringify({})), res);
  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).error, "MESSAGES_REQUIS");
});

test("POST /api/ariane/chat avec un corps illisible → 400", async () => {
  const h = createHandler({ cfg: cfgRag, ragChat: fetchInterdit });
  const res = mockRes();
  await h(mockReq("POST", "/api/ariane/chat", "{pas du json"), res);
  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).error, "MESSAGES_REQUIS");
});

// L'en-tete 200 part avant le premier octet du modele : une erreur survenue ensuite
// ne peut plus prendre la forme d'un statut HTTP, elle passe donc dans le flux.
test("POST /api/ariane/chat : echec amont → event: error dans le flux", async () => {
  const ragChat = async () => { throw new Error("ARIANE_RAG_CHAT"); };
  const h = createHandler({ cfg: cfgRag, ragChat });
  const res = mockRes();
  await h(mockReq("POST", "/api/ariane/chat", JSON.stringify({ messages: [{ role: "user", content: "x" }] })), res);
  assert.equal(res.code, 200);
  assert.equal(res.flux(), 'event: error\ndata: {"error":"ARIANE_RAG_CHAT"}\n\n');
});

test("POST /api/ariane/chat : erreur hors taxonomie masquee en INTERNAL_ERROR", async () => {
  const ragChat = async () => { throw new Error("ECONNREFUSED 10.0.0.1:443"); };
  const h = createHandler({ cfg: cfgRag, ragChat });
  const res = mockRes();
  await h(mockReq("POST", "/api/ariane/chat", JSON.stringify({ messages: [{ role: "user", content: "x" }] })), res);
  assert.equal(res.flux(), 'event: error\ndata: {"error":"INTERNAL_ERROR"}\n\n');
  assert.ok(!res.flux().includes("10.0.0.1"), "aucun detail amont ne doit fuir vers le client");
});

// GARDE-FOU : sans IAKA_RAG_CORPUS_ID le RAG est entierement desactive. Le vrai
// chatStream est utilise ici (pas de double) : c'est lui qui porte la protection.
test("POST /api/ariane/chat sans corpus configure → ARIANE_RAG_INDISPONIBLE, aucun appel reseau", async () => {
  const h = createHandler({ cfg: { ragBaseUrl: "https://iaka-chat.test", ragIakId: "iak-1" }, fetchImpl: fetchInterdit });
  const res = mockRes();
  await h(mockReq("POST", "/api/ariane/chat", JSON.stringify({ messages: [{ role: "user", content: "x" }] })), res);
  assert.equal(res.flux(), 'event: error\ndata: {"error":"ARIANE_RAG_INDISPONIBLE"}\n\n');
});

test("POST /api/ariane/corpus/purge → 200 avec le nombre de documents supprimes", async () => {
  const h = createHandler({ cfg: cfgRag, ragPurge: async () => 7 });
  const res = mockRes();
  await h(mockReq("POST", "/api/ariane/corpus/purge", ""), res);
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { supprimes: 7 });
});

test("POST /api/ariane/corpus/purge : echec amont → 502", async () => {
  const h = createHandler({ cfg: cfgRag, ragPurge: async () => { throw new Error("ARIANE_RAG_PURGE"); } });
  const res = mockRes();
  await h(mockReq("POST", "/api/ariane/corpus/purge", ""), res);
  assert.equal(res.code, 502);
  assert.equal(JSON.parse(res.body).error, "ARIANE_RAG_PURGE");
});

// GARDE-FOU CENTRAL : la purge vide un corpus entier, irreversiblement. Sans corpus
// explicitement configure, aucune route ne doit pouvoir la declencher — a fortiori
// pas sur un corpus par defaut qui ne serait pas celui de la demo.
test("POST /api/ariane/corpus/purge sans corpus configure → 503 et AUCUNE suppression", async () => {
  const h = createHandler({ cfg: {}, fetchImpl: fetchInterdit });
  const res = mockRes();
  await h(mockReq("POST", "/api/ariane/corpus/purge", ""), res);
  assert.equal(res.code, 503);
  assert.equal(JSON.parse(res.body).error, "ARIANE_RAG_INDISPONIBLE");
});

test("GET /api/ariane/corpus/purge → 404 (la purge n'est jamais declenchable en GET)", async () => {
  const h = createHandler({ cfg: cfgRag, fetchImpl: fetchInterdit });
  const res = mockRes();
  await h(mockReq("GET", "/api/ariane/corpus/purge"), res);
  assert.equal(res.code, 404);
});

// Le corpus est la, mais l'hote de chat / l'iak manquent : capacite d'ingestion
// active, capacite de chat inactive. Le front doit recevoir un code exploitable
// (« onglet indisponible »), pas un INTERNAL_ERROR qui masque une simple config.
test("POST /api/ariane/chat sans hote de chat configure → ARIANE_RAG_INDISPONIBLE", async () => {
  const h = createHandler({ cfg: { ragCorpusId: "corpus-demo" }, fetchImpl: fetchInterdit });
  const res = mockRes();
  await h(mockReq("POST", "/api/ariane/chat", JSON.stringify({ messages: [{ role: "user", content: "x" }] })), res);
  assert.equal(res.flux(), 'event: error\ndata: {"error":"ARIANE_RAG_INDISPONIBLE"}\n\n');
});

// --- Évaluation des avoirs : POST /api/evaluation (job asynchrone) ---

// Appelle le handler comme les tests mockRes/mockReq ci-dessus, mais renvoie
// directement {code, body} désérialisé : évite de reparser le JSON dans chaque test.
async function appelJson(handler, method, url, bodyObj) {
  const res = mockRes();
  await handler(mockReq(method, url, bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined), res);
  return { code: res.code, body: res.body ? JSON.parse(res.body) : undefined };
}

test("POST /api/evaluation cree un job et rend 202", async () => {
  const handler = createHandler({
    cfg: { evaluationAppId: "app", tenantId: "t" },
    evaluation: async () => ({ evaluations: [], non_evalues: [], total: null, pv_evaluation: "## PV" }),
  });
  const res = await appelJson(handler, "POST", "/api/evaluation", { una: "12345/00042/2026", objetIds: [1] });
  assert.equal(res.code, 202);
  assert.ok(res.body.jobId);
});

// Le 202 part AVANT que le job ne s'exécute : sans attendre le statut `done`,
// aucune assertion ne porterait sur ce qui est réellement transmis au workflow.
// Une inversion d'arguments (una/objetIds) passerait alors les tests de route.
test("POST /api/evaluation transmet bien { una, objetIds } au workflow", async () => {
  let recu = null;
  const handler = createHandler({
    cfg: { evaluationAppId: "app", tenantId: "t" },
    evaluation: async (args) => {
      recu = args;
      return { evaluations: [], non_evalues: [], total: null, pv_evaluation: "## PV" };
    },
  });
  const demarrage = await appelJson(handler, "POST", "/api/evaluation", {
    una: "12345/00042/2026",
    objetIds: [42, 43],
  });
  assert.equal(demarrage.code, 202);

  // Le job tourne en arrière-plan : on interroge son statut jusqu'à sa fin.
  let statut;
  for (let i = 0; i < 50; i++) {
    statut = await appelJson(handler, "GET", `/api/job/status?jobId=${demarrage.body.jobId}`);
    if (statut.body?.status === "done" || statut.body?.status === "error") break;
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(statut.body.status, "done");

  assert.equal(recu.una, "12345/00042/2026");
  assert.deepEqual(recu.objetIds, [42, 43]);
  assert.equal(recu.cfg.evaluationAppId, "app");
});

test("POST /api/evaluation sans objetIds -> 400 OBJETS_REQUIS", async () => {
  const handler = createHandler({ cfg: {}, evaluation: async () => ({}) });
  const res = await appelJson(handler, "POST", "/api/evaluation", { una: "12345/00042/2026", objetIds: [] });
  assert.equal(res.code, 400);
  assert.equal(res.body.error, "OBJETS_REQUIS");
});

test("POST /api/evaluation sans una -> 400 UNA_REQUIS", async () => {
  const handler = createHandler({ cfg: {}, evaluation: async () => ({}) });
  const res = await appelJson(handler, "POST", "/api/evaluation", { objetIds: [1] });
  assert.equal(res.code, 400);
  assert.equal(res.body.error, "UNA_REQUIS");
});

test("GET /health → 200 { data: { ok: true } } sans auth", async () => {
  const handler = createHandler({ cfg: {} });
  const res = await appelJson(handler, "GET", "/health");
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { data: { ok: true } });
});

test("BFF_API_TOKEN : /api sans Bearer → 401 ; health reste ouvert", async () => {
  const handler = createHandler({ cfg: { bffApiToken: "secret" } });
  const denied = await appelJson(handler, "GET", "/api/evaluation/unas");
  assert.equal(denied.code, 401);
  assert.equal(denied.body.error, "UNAUTHORIZED");
  const health = await appelJson(handler, "GET", "/health");
  assert.equal(health.code, 200);
});

test("BFF_API_TOKEN : Bearer valide laisse passer", async () => {
  const handler = createHandler({
    cfg: { bffApiToken: "secret" },
    evaluation: async () => ({ evaluations: [] }),
  });
  // mockReq ne pose pas d'Authorization : on appelle le handler à la main.
  const res = mockRes();
  const req = mockReq("POST", "/api/evaluation", JSON.stringify({ una: "1/2/2024", objetIds: [1] }));
  req.headers = { authorization: "Bearer secret" };
  await handler(req, res);
  assert.equal(res.code, 202);
});

test("POST corps trop volumineux → 413 BODY_TOO_LARGE", async () => {
  // Défaut MAX_BODY_BYTES = 15 Mo (lu au chargement du module). Un corps de 16 Mo
  // doit être rejeté avant tout parse JSON / appel workflow.
  const gros = "x".repeat(16 * 1024 * 1024);
  const handler = createHandler({ cfg: {} });
  const res = mockRes();
  await handler(mockReq("POST", "/api/query", gros), res);
  assert.equal(res.code, 413);
  assert.equal(JSON.parse(res.body).error, "BODY_TOO_LARGE");
});
