// Déclenche le workflow IAka « évaluation des avoirs » et valide sa réponse.
//
// Le BFF n'interroge NI la cote NI rgp-api : c'est l'agent qui le fait, par ses
// tools MCP. Ce module ne fait que déclencher, attendre, et refuser une réponse
// qui ne serait pas exploitable — mieux vaut une erreur franche qu'un PV
// construit sur une réponse à moitié comprise.

import { requireWorkflow } from "./config.mjs";

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Erreurs de contrat exposées par ce module : elles doivent atteindre
// l'appelant telles quelles, jamais réécrites en EVALUATION_UPSTREAM.
const ERREURS_CONTRAT = new Set([
  "EVALUATION_INVALIDE",
  "EVALUATION_UPSTREAM",
  "EVALUATION_TIMEOUT",
  "OBJETS_REQUIS",
  "IAKA_UNAVAILABLE",
  "WORKFLOW_NON_CONFIGURE",
]);

/**
 * Exécute un appel réseau ou un parsing JSON de réponse upstream, et
 * transforme toute exception (fetch qui rejette, corps non-JSON) en
 * EVALUATION_UPSTREAM — sauf si c'est déjà une des erreurs de contrat
 * connues, auquel cas elle est relancée sans modification.
 */
async function appelUpstream(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && ERREURS_CONTRAT.has(err.message)) throw err;
    throw new Error("EVALUATION_UPSTREAM");
  }
}

/**
 * Extrait la réponse JSON du workflow : retire la trace d'agent, déballe la
 * DERNIÈRE fence (la réponse finale de l'agent, pas un brouillon intermédiaire),
 * isole le premier objet JSON, puis vérifie le minimum exploitable (des
 * évaluations — même vides — et un PV).
 */
export function extraireEvaluation(result) {
  if (typeof result !== "string") throw new Error("EVALUATION_INVALIDE");

  let texte = result.replace(/<tool>[\s\S]*?<\/tool>/gi, "").trim();
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fence;
  let derniereFence;
  while ((fence = fenceRegex.exec(texte)) !== null) {
    derniereFence = fence;
  }
  if (derniereFence) texte = derniereFence[1].trim();
  if (!texte.startsWith("{")) {
    const debut = texte.indexOf("{");
    const fin = texte.lastIndexOf("}");
    if (debut === -1 || fin <= debut) throw new Error("EVALUATION_INVALIDE");
    texte = texte.slice(debut, fin + 1);
  }

  let objet;
  try {
    objet = JSON.parse(texte);
  } catch {
    throw new Error("EVALUATION_INVALIDE");
  }

  if (!objet || typeof objet !== "object") throw new Error("EVALUATION_INVALIDE");
  if (!Array.isArray(objet.evaluations)) throw new Error("EVALUATION_INVALIDE");
  if (typeof objet.pv_evaluation !== "string" || !objet.pv_evaluation.trim()) {
    throw new Error("EVALUATION_INVALIDE");
  }

  // Une entrée sans identifiant d'objet exploitable ne se rattache à aucun
  // véhicule : elle ne peut ni s'afficher, ni être confrontée à la base. On
  // l'écarte ici plutôt que de la laisser produire un `objetId: undefined`
  // côté front. La validité des MONTANTS, elle, reste jugée par le front
  // (`validerEstimation`), seul endroit qui décide de ce qui entre dans le
  // total : la dédoubler ici ferait diverger deux règles pour une seule
  // décision.
  // Number(null) et Number("") valent 0 : l'identifiant doit être testé avant
  // conversion, sinon une entrée sans objet_id se rattacherait à l'objet 0.
  const idExploitable = (v) =>
    v != null && v !== "" && typeof v !== "boolean" && Number.isFinite(Number(v));
  const evaluations = objet.evaluations.filter(
    (e) => e && typeof e === "object" && idExploitable(e.objet_id)
  );
  const nonEvalues = (Array.isArray(objet.non_evalues) ? objet.non_evalues : []).filter(
    (n) => n && typeof n === "object" && idExploitable(n.objet_id)
  );
  // Le total n'est retenu que s'il est un objet (ni tableau, ni nombre nu) : le
  // BFF ne juge pas ses bornes. La forme { bas, moyen, haut } est vérifiée par
  // `normTotal`, côté front, seul endroit qui décide de ce qui s'affiche — comme
  // pour les montants ci-dessus, on ne dédouble pas la règle. Un objet partiel
  // passe donc ici et sera écarté là-bas.
  const total =
    objet.total && typeof objet.total === "object" && !Array.isArray(objet.total)
      ? objet.total
      : null;

  return { evaluations, non_evalues: nonEvalues, total, pv_evaluation: objet.pv_evaluation };
}

/**
 * @param {object} p
 * @param {string} p.una
 * @param {number[]} p.objetIds  objets cochés par l'enquêteur
 * @param {object} p.cfg         config IAka (voir proxy.mjs)
 */
export async function runEvaluation({
  una,
  objetIds,
  cfg,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
}) {
  requireWorkflow(cfg, cfg.evaluationAppId);
  if (!Array.isArray(objetIds) || objetIds.length === 0) throw new Error("OBJETS_REQUIS");

  const auth = { Authorization: `Bearer ${cfg.jwt}`, "Content-Type": "application/json" };
  const execPath = cfg.executePath || "/workflows/execute";
  const statusTpl = cfg.statusPath || "/workflows/executions/{id}";

  // L'agent reçoit l'UNA et les identifiants cochés, rien de plus : il va
  // chercher les objets lui-même par MCP. Lui servir les champs reviendrait à ne
  // lui laisser qu'un rôle de rédacteur.
  const execRes = await appelUpstream(() =>
    fetchImpl(`${cfg.baseUrl}${execPath}`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        app_id: cfg.evaluationAppId,
        tenant_id: cfg.tenantId,
        langue: "fr",
        prompt: JSON.stringify({ una, objetIds }),
      }),
    })
  );
  if (!execRes.ok) throw new Error("EVALUATION_UPSTREAM");
  const exec = await appelUpstream(() => execRes.json());
  if (!exec?.execution_id) throw new Error("EVALUATION_UPSTREAM");

  const statusUrl = `${cfg.baseUrl}${statusTpl.replace("{id}", exec.execution_id)}?tenant_id=${cfg.tenantId}`;
  const debut = Date.now();

  while (Date.now() - debut <= cfg.pollTimeoutMs) {
    const res = await appelUpstream(() =>
      fetchImpl(statusUrl, { method: "GET", headers: { Authorization: auth.Authorization } })
    );
    if (!res.ok) throw new Error("EVALUATION_UPSTREAM");
    const body = await appelUpstream(() => res.json());
    if (!body || typeof body !== "object") throw new Error("EVALUATION_UPSTREAM");
    if (body.status === "SUCCESS") return extraireEvaluation(body.result);
    if (body.status === "ERROR") throw new Error("EVALUATION_UPSTREAM");
    await sleep(cfg.pollIntervalMs);
  }
  throw new Error("EVALUATION_TIMEOUT");
}
