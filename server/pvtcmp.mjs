import { requireWorkflow } from "./config.mjs";

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Rubriques du PV dans l'ordre canonique de la trame (cf. prompt de l'agent de rédaction),
// avec leur intitulé lisible. Le rendu suit cet ordre quel que soit celui de la sortie.
const RUBRIQUES = [
  ["saisine", "Saisine"],
  ["situation_arrivee", "Situation à l'arrivée"],
  ["mesures_prises", "Mesures prises"],
  ["etat_des_lieux", "État des lieux"],
  ["corps_du_delit", "Corps du délit"],
  ["mesures_diverses", "Mesures diverses"],
  ["cloture", "Clôture"],
];
const ORDRE = RUBRIQUES.map(([cle]) => cle);

const echapper = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Un texte de rubrique → paragraphes HTML (double saut = nouveau <p>, simple saut = <br>).
function paragraphes(texte) {
  const blocs = String(texte ?? "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (!blocs.length) return "<p></p>";
  return blocs.map((b) => `<p>${echapper(b).replace(/\n/g, "<br>")}</p>`).join("");
}

// Extrait le projet de PV du `result` IAka. L'agent de rédaction rend UN objet JSON
// { rubriques_redigees: [{ cle, texte }] } (éventuellement entouré de traces d'agent ou
// d'un fence). On le transforme en HTML éditable (un titre par rubrique), rendu et exporté
// comme la synthèse d'audition. Plus de .docx.
export function extractPv(result) {
  if (typeof result !== "string") throw new Error("PVTCMP_INVALIDE");
  const nettoye = result.replace(/<tool>[\s\S]*?<\/tool>/gi, "");
  const start = nettoye.indexOf("{");
  const end = nettoye.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("PVTCMP_INVALIDE");
  let data;
  try {
    data = JSON.parse(nettoye.slice(start, end + 1));
  } catch {
    throw new Error("PVTCMP_INVALIDE");
  }
  const rubriques = data?.rubriques_redigees;
  if (!Array.isArray(rubriques) || !rubriques.length) throw new Error("PVTCMP_INVALIDE");

  const parCle = new Map();
  for (const r of rubriques) if (r && r.cle && !parCle.has(r.cle)) parCle.set(r.cle, r.texte ?? "");

  const html = [];
  // 1) rubriques connues, dans l'ordre canonique de la trame.
  for (const [cle, titre] of RUBRIQUES) {
    if (parCle.has(cle)) html.push(`<h2>${titre}</h2>${paragraphes(parCle.get(cle))}`);
  }
  // 2) rubriques hors trame éventuelles (le libellé retombe sur la clé), à la suite.
  for (const [cle, texte] of parCle) {
    if (!ORDRE.includes(cle)) html.push(`<h2>${echapper(cle)}</h2>${paragraphes(texte)}`);
  }
  if (!html.length) throw new Error("PVTCMP_INVALIDE");
  return html.join("");
}

/**
 * Déclenche le workflow IAka « PV transport » avec les notes de terrain en
 * pièce jointe (multipart/form-data), attend le résultat et en extrait le .docx.
 *
 * @param {object} p
 * @param {{base64: string, mime: string, filename: string}[]} p.files
 * @param {object} p.cfg  config IAka (voir proxy.mjs)
 */
export async function runPvtcmp({ files, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  requireWorkflow(cfg, cfg.pvtcmpAppId);
  const auth = { Authorization: `Bearer ${cfg.jwt}` };
  const execPath = cfg.executePath || "/workflows/execute";
  const statusTpl = cfg.statusPath || "/workflows/executions/{id}";

  // Diffusion restreinte : les notes de terrain ne sortent JAMAIS dans les logs.
  // Seules des métadonnées (nombre de pièces, taille, libellé d'erreur IAka) sont
  // tracées — même règle que ariane.mjs. PVTCMP_TIMEOUT/UPSTREAM sont opaques côté
  // front ; sans ces traces un timeout ne laisse AUCUN indice sur la cause réelle.
  const form = new FormData();
  form.set("app_id", cfg.pvtcmpAppId);
  form.set("tenant_id", cfg.tenantId);
  form.set("langue", "fr");
  const field = cfg.pvtcmpFileField || cfg.imageField || "file";
  let totalKo = 0;
  for (const [i, f] of files.entries()) {
    const bytes = Buffer.from(f.base64, "base64");
    totalKo += Math.round(bytes.length / 1024);
    const blob = new Blob([bytes], { type: f.mime || "application/octet-stream" });
    form.append(field, blob, f.filename || `notes-${i + 1}`);
  }

  const execRes = await fetchImpl(`${cfg.baseUrl}${execPath}`, {
    method: "POST",
    headers: auth, // pas de Content-Type : fetch pose la boundary multipart
    body: form,
  });
  if (!execRes.ok) {
    console.error(`[pvtcmp] execute HTTP ${execRes.status}`);
    throw new Error("PVTCMP_UPSTREAM");
  }
  const exec = await execRes.json();
  const executionId = exec.execution_id;
  if (!executionId) {
    console.error("[pvtcmp] execute sans execution_id");
    throw new Error("PVTCMP_UPSTREAM");
  }

  const deadline = cfg.pollTimeoutMs;
  const startMs = Date.now();
  const statusUrl = `${cfg.baseUrl}${statusTpl.replace("{id}", executionId)}?tenant_id=${cfg.tenantId}`;
  console.error(`[pvtcmp] exec ${executionId} lancee: ${files.length} piece(s), ${totalKo} ko`);

  let polls = 0;
  while (Date.now() - startMs <= deadline) {
    const res = await fetchImpl(statusUrl, { method: "GET", headers: auth });
    polls++;
    if (!res.ok) {
      console.error(`[pvtcmp] exec ${executionId} status HTTP ${res.status} apres ${Date.now() - startMs}ms`);
      throw new Error("PVTCMP_UPSTREAM");
    }
    const body = await res.json();
    if (body.status === "SUCCESS") {
      console.error(`[pvtcmp] exec ${executionId} SUCCESS apres ${Date.now() - startMs}ms (${polls} polls)`);
      return extractPv(body.result);
    }
    if (body.status === "ERROR") {
      // L'ingestion du fichier (indexation en amont du workflow) échoue par
      // intermittence : « Ingestion not completed after 10 attempts of 5 seconds ».
      // C'est transitoire (aucune génération faite) → erreur distincte, réessayable.
      // On ne logue que le libellé d'erreur IAka, jamais le contenu des notes.
      console.error(`[pvtcmp] exec ${executionId} ERROR apres ${Date.now() - startMs}ms: ${String(body.error ?? "").slice(0, 200)}`);
      if (/ingestion/i.test(JSON.stringify(body))) throw new Error("PVTCMP_INGESTION");
      throw new Error("PVTCMP_UPSTREAM");
    }
    await sleep(cfg.pollIntervalMs);
  }
  console.error(`[pvtcmp] exec ${executionId} TIMEOUT apres ${Date.now() - startMs}ms (${polls} polls, deadline ${deadline}ms)`);
  throw new Error("PVTCMP_TIMEOUT");
}
