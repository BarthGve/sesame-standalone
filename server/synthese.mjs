const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Extrait le texte de synthèse du `result` IAka : on retire les blocs
// <tool>…</tool> (trace d'agent) et les fences de code éventuelles.
export function extractTexte(result) {
  if (typeof result !== "string") throw new Error("SYNTHESE_INVALIDE");
  let text = result.replace(/<tool>[\s\S]*?<\/tool>/gi, "").trim();
  const fence = text.match(/```(?:markdown|md|text)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  if (!text) throw new Error("SYNTHESE_INVALIDE");
  return text;
}

/**
 * Déclenche le workflow IAka de synthèse avec les pièces de procédure en
 * pièces jointes (multipart/form-data), attend le résultat et en extrait le texte.
 *
 * @param {object} p
 * @param {{base64: string, mime: string, filename: string}[]} p.files
 * @param {string|null} [p.contexte]  XML LRPGN extrait de la pièce, envoyé en `prompt`
 * @param {object} p.cfg  config IAka (voir proxy.mjs)
 */
export async function runSynthese({ files, contexte = null, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const auth = { Authorization: `Bearer ${cfg.jwt}` };
  const execPath = cfg.executePath || "/workflows/execute";
  const statusTpl = cfg.statusPath || "/workflows/executions/{id}";

  // CONVENTION MULTI-FICHIERS NON VÉRIFIÉE : le workflow de synthèse n'existe pas
  // encore, on ne sait pas s'il attend le champ répété (ci-dessous), un champ
  // `files[]`, ou une exécution par pièce. À confirmer à la mise en place du
  // workflow — c'est le seul endroit à corriger.
  function construireForm(avecContexte) {
    const form = new FormData();
    form.set("app_id", cfg.syntheseAppId);
    form.set("tenant_id", cfg.tenantId);
    form.set("langue", "fr");
    // Le workflow porte son instruction figée ; le champ `prompt` ne sert donc
    // qu'à transporter la donnée. Le XML est encadré par une balise explicite :
    // il vient d'un fichier tiers et ne doit jamais pouvoir se lire comme une
    // consigne adressée au modèle.
    if (avecContexte) form.set("prompt", `<contexte_procedure>\n${contexte}\n</contexte_procedure>`);
    const field = cfg.syntheseFileField || cfg.imageField || "file";
    for (const [i, f] of files.entries()) {
      const bytes = Buffer.from(f.base64, "base64");
      const blob = new Blob([bytes], { type: f.mime || "application/octet-stream" });
      form.append(field, blob, f.filename || `piece-${i + 1}`);
    }
    return form;
  }

  const postExec = (avecContexte) =>
    fetchImpl(`${cfg.baseUrl}${execPath}`, {
      method: "POST",
      headers: auth, // pas de Content-Type : fetch pose la boundary multipart
      body: construireForm(avecContexte),
    });

  // Le contexte XML n'est envoyé qu'au mieux : certains workflows IAka rejettent
  // en 4xx tout champ qu'ils ne déclarent pas (cf. iaka.mjs). Un refus fait
  // rejouer l'exécution sans contexte, pour ne jamais dégrader l'analyse. Un 5xx
  // est une panne amont : rejouer n'y changerait rien.
  let execRes = await postExec(Boolean(contexte));
  if (!execRes.ok && contexte && execRes.status >= 400 && execRes.status < 500) {
    console.error(`[synthese] contexte refusé par le workflow (${execRes.status}) → nouvel essai sans`);
    execRes = await postExec(false);
  }
  if (!execRes.ok) throw new Error("SYNTHESE_UPSTREAM");
  const exec = await execRes.json();
  const executionId = exec.execution_id;
  if (!executionId) throw new Error("SYNTHESE_UPSTREAM");

  const deadline = cfg.pollTimeoutMs;
  const startMs = Date.now();
  const statusUrl = `${cfg.baseUrl}${statusTpl.replace("{id}", executionId)}?tenant_id=${cfg.tenantId}`;

  while (Date.now() - startMs <= deadline) {
    const res = await fetchImpl(statusUrl, { method: "GET", headers: auth });
    if (!res.ok) throw new Error("SYNTHESE_UPSTREAM");
    const body = await res.json();
    if (body.status === "SUCCESS") return extractTexte(body.result);
    if (body.status === "ERROR") throw new Error("SYNTHESE_UPSTREAM");
    await sleep(cfg.pollIntervalMs);
  }
  throw new Error("SYNTHESE_TIMEOUT");
}
