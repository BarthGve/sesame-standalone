import { extractGeoJSON } from "./geojson.mjs";
import { iakaReady } from "./config.mjs";

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cœur : déclenche l'exécution d'un workflow IAka et poll jusqu'au result brut.
async function execWorkflow({ prompt, appId, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  iakaReady(cfg);
  const headers = { Authorization: `Bearer ${cfg.jwt}`, "Content-Type": "application/json" };
  const execPath = cfg.executePath || "/workflows/execute";
  const statusTpl = cfg.statusPath || "/workflows/executions/{id}";

  // Certains workflows (RENS synthèse/zoom) sont AUTONOMES : ils n'ont pas d'entrée `prompt`
  // et rejettent (422) tout champ `prompt`. On n'inclut prompt/langue/include_traitement que si
  // un prompt est fourni (carte, RGP, …) ; sinon on n'envoie que app_id + tenant_id.
  const payload = { app_id: appId, tenant_id: cfg.tenantId };
  if (prompt != null && prompt !== "") {
    payload.prompt = prompt;
    payload.langue = "fr";
    payload.include_traitement = false;
  }
  const execRes = await fetchImpl(`${cfg.baseUrl}${execPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!execRes.ok) {
    const body = typeof execRes.text === "function" ? await execRes.text().catch(() => "") : "";
    console.error("IAKA_EXEC_FAIL", { appId, status: execRes.status, body: body.slice(0, 500) });
    throw new Error("IAKA_UPSTREAM");
  }
  const exec = await execRes.json();
  const executionId = exec.execution_id;
  if (!executionId) {
    console.error("IAKA_NO_EXEC_ID", { appId, exec: JSON.stringify(exec).slice(0, 500) });
    throw new Error("IAKA_UPSTREAM");
  }

  const deadline = cfg.pollTimeoutMs;
  let elapsed = 0;
  const startMs = Date.now();
  const statusUrl = `${cfg.baseUrl}${statusTpl.replace("{id}", executionId)}?tenant_id=${cfg.tenantId}`;

  while (elapsed <= deadline) {
    const res = await fetchImpl(statusUrl, { method: "GET", headers });
    if (!res.ok) {
      const t = typeof res.text === "function" ? await res.text().catch(() => "") : "";
      console.error("IAKA_STATUS_FAIL", { appId, status: res.status, body: t.slice(0, 300) });
      throw new Error("IAKA_UPSTREAM");
    }
    const body = await res.json();
    if (body.status === "SUCCESS") return body.result;
    if (body.status === "ERROR") {
      console.error("IAKA_STATUS_ERROR", { appId, body: JSON.stringify(body).slice(0, 500) });
      throw new Error("IAKA_UPSTREAM");
    }
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

// RENS : déclenche un workflow IAka par app_id → result brut (chaîne). Le proxy extrait le
// markdown (extractSynthese). Deux workflows chaînés (chacun son app_id) : synthèse quotidienne
// (autonome), puis zoom qui reçoit la SORTIE de la synthèse en prompt ; le proxy concatène.
export async function runRensWorkflow({ prompt, appId, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  return execWorkflow({ prompt, appId, cfg, fetchImpl, sleep });
}
