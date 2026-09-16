import { extractObjet } from "./objetjson.mjs";

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Déclenche le workflow IAka d'identification avec l'image en pièce jointe
 * (multipart/form-data), attend le résultat et en extrait l'objet JSON.
 *
 * @param {object} p
 * @param {string} p.imageBase64  image encodée base64 (sans préfixe data:)
 * @param {string} p.mime         type MIME (image/jpeg, image/png…)
 * @param {string} p.filename     nom de fichier
 * @param {object} p.cfg          config IAka (voir proxy.mjs)
 */
export async function runIdentify({ imageBase64, mime, filename, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const auth = { Authorization: `Bearer ${cfg.jwt}` };
  const execPath = cfg.executePath || "/workflows/execute";
  const statusTpl = cfg.statusPath || "/workflows/executions/{id}";

  // 1. Déclenche — multipart : champs texte + fichier image (pièce jointe).
  const form = new FormData();
  form.set("app_id", cfg.identifyAppId);
  form.set("tenant_id", cfg.tenantId);
  form.set("langue", "fr");
  const bytes = Buffer.from(imageBase64, "base64");
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  form.set(cfg.imageField || "file", blob, filename || "objet.jpg");

  const execRes = await fetchImpl(`${cfg.baseUrl}${execPath}`, {
    method: "POST",
    headers: auth, // pas de Content-Type : fetch pose la boundary multipart
    body: form,
  });
  if (!execRes.ok) throw new Error("IDENTIFY_UPSTREAM");
  const exec = await execRes.json();
  const executionId = exec.execution_id;
  if (!executionId) throw new Error("IDENTIFY_UPSTREAM");

  // 2. Polling
  const deadline = cfg.pollTimeoutMs;
  const startMs = Date.now();
  const statusUrl = `${cfg.baseUrl}${statusTpl.replace("{id}", executionId)}?tenant_id=${cfg.tenantId}`;

  while (Date.now() - startMs <= deadline) {
    const res = await fetchImpl(statusUrl, { method: "GET", headers: auth });
    if (!res.ok) throw new Error("IDENTIFY_UPSTREAM");
    const body = await res.json();
    if (body.status === "SUCCESS") return extractObjet(body.result);
    if (body.status === "ERROR") throw new Error("IDENTIFY_UPSTREAM");
    await sleep(cfg.pollIntervalMs);
  }
  throw new Error("IDENTIFY_TIMEOUT");
}
