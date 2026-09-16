import { createServer } from "node:http";
import { runWorkflow, runWorkflowRaw, runRensWorkflow } from "./iaka.mjs";
import { runIdentify } from "./identify.mjs";
import { runSynthese } from "./synthese.mjs";
import { createJob, getJob, startJob } from "./ariane.mjs";
import { purgeCorpus, chatStream, chatActif } from "./ariane-rag.mjs";
import { createJob as createGenericJob, getJob as getGenericJob, runJob } from "./jobs.mjs";
// Le code d'audit vit dans rens-api mais l'image du BFF embarque tout `server/` : on
// l'importe plutôt que de le dupliquer. La frontière de confiance (parse.mjs) reste donc
// UNIQUE pour le batch nocturne et pour l'analyse à la demande.
import { composerFragment } from "./rens-api/audit/fragments.mjs";
import { parseSortieAgents } from "./rens-api/audit/parse.mjs";
import { construireRapportAnalyse } from "./rens-api/audit/analyse.mjs";
import { portePii } from "./rens-api/audit/regles.mjs";
import { runPvtcmp } from "./pvtcmp.mjs";
import { normalizeResult } from "./rgpResult.mjs";
import { extractSynthese } from "./rens.mjs";
import { listerUnasEvaluables } from "./unasEvaluables.mjs";
import { runEvaluation } from "./evaluationWorkflow.mjs";
import { loadCfg } from "./config.mjs";
import {
  ERROR_STATUS,
  readBody,
  writeBodyTooLarge,
  writeJson,
  logRequest,
  checkBffAccess,
} from "./httpUtil.mjs";

const RGP_ROUTES = {
  "POST /api/perquisition": "/perquisition",
  "POST /api/perquisition/objets": "/perquisition/objets",
  "POST /api/perquisition/objet/update": "/perquisition/objet/update",
  "POST /api/perquisition/objet/delete": "/perquisition/objet/delete",
  "GET /api/perquisitions": "/perquisitions",
  "GET /api/perquisition": "/perquisition",
  "GET /api/objets/recherche": "/objets/recherche",
  "GET /api/procedures": "/procedures",
};

async function forwardRgp(req, res, cfg, fetchImpl, path, search) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (cfg.rgpApiToken) headers.Authorization = "Bearer " + cfg.rgpApiToken;
    const init = { method: req.method, headers };
    if (req.method === "POST") init.body = await readBody(req);
    const upstream = await fetchImpl((cfg.rgpApiUrl || "") + path + (search || ""), init);
    const text = await upstream.text();
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    if (e.message === "BODY_TOO_LARGE") return writeBodyTooLarge(res);
    console.error("rgp_forward_error", e.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "RGP_UPSTREAM" }));
  }
}

async function forwardRens(req, res, cfg, fetchImpl, path, search) {
  try {
    const headers = {};
    if (cfg.rensApiToken) headers.Authorization = "Bearer " + cfg.rensApiToken;
    const init = { method: req.method || "GET", headers };
    if (req.method === "POST") {
      headers["Content-Type"] = "application/json";
      init.body = await readBody(req);
    }
    const upstream = await fetchImpl((cfg.rensApiUrl || "") + path + (search || ""), init);
    const text = await upstream.text();
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    if (e.message === "BODY_TOO_LARGE") return writeBodyTooLarge(res);
    console.error("rens_forward_error", e.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "RENS_UPSTREAM" }));
  }
}

// Type MIME sûr dérivé de l'extension de la clé (jamais d'un metadata amont) — anti-XSS au service.
const MIME_BY_EXT = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic" };
function safeMimeFromKey(key) {
  const m = /(\.[a-z0-9]+)$/i.exec(key || "");
  return (m && MIME_BY_EXT[m[1].toLowerCase()]) || "application/octet-stream";
}

// Les photos de scellés vivent désormais dans rgp-api (seul service à parler à
// MinIO, en interne). Le BFF n'a plus d'identifiants MinIO : il relaie /api/photo
// vers rgp-api /photo, comme forwardRgp. Le durcissement navigateur (nosniff, CSP)
// reste posé ICI car c'est le BFF qui répond au navigateur.
async function handlePhotoUpload(req, res, cfg, fetchImpl) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (cfg.rgpApiToken) headers.Authorization = "Bearer " + cfg.rgpApiToken;
    const upstream = await fetchImpl((cfg.rgpApiUrl || "") + "/photo", { method: "POST", headers, body: await readBody(req) });
    const text = await upstream.text();
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    if (e.message === "BODY_TOO_LARGE") return writeBodyTooLarge(res);
    console.error("photo_upload_error", e.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "PHOTO_UPLOAD" }));
  }
}

async function handlePhotoGet(req, res, cfg, fetchImpl, url) {
  const key = url.searchParams.get("key") || "";
  if (!key || key.includes("/") || key.includes("..")) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "CLE_INVALIDE" }));
    return;
  }
  try {
    const headers = {};
    if (cfg.rgpApiToken) headers.Authorization = "Bearer " + cfg.rgpApiToken;
    const upstream = await fetchImpl((cfg.rgpApiUrl || "") + "/photo?key=" + encodeURIComponent(key), { method: "GET", headers });
    if (!upstream.ok) {
      // rgp-api renvoie une enveloppe JSON d'erreur (401/404…) : on la relaie telle quelle.
      res.writeHead(upstream.status, { "Content-Type": "application/json" });
      res.end(await upstream.text());
      return;
    }
    res.writeHead(200, {
      "Content-Type": safeMimeFromKey(key),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    // Binaire-safe : on relaie les octets bruts (arrayBuffer), jamais .text() qui
    // corromprait l'image.
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    console.error("photo_get_error", e.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "PHOTO_GET" }));
  }
}

export function createHandler({ cfg, run = runWorkflow, runRaw = runWorkflowRaw, identify = runIdentify, synthese = runSynthese, evaluation = runEvaluation, pvtcmp = runPvtcmp, rensWorkflow = runRensWorkflow, ragChat = chatStream, ragPurge = purgeCorpus, fetchImpl = fetch }) {
  return async (req, res) => {
    try {
    const url = new URL(req.url, "http://x");
    // Health public (compose / deploy) : pas d'auth, pas de dépendance amont.
    if (url.pathname === "/health" && req.method === "GET") {
      writeJson(res, 200, { data: { ok: true } });
      return;
    }
    // Journal + garde d'accès /api (CF Access et/ou Bearer optionnel — voir httpUtil).
    if (url.pathname.startsWith("/api/")) {
      logRequest(req, url);
      const denied = checkBffAccess(req, url, cfg);
      if (denied) {
        writeJson(res, ERROR_STATUS[denied] ?? 401, { error: denied });
        return;
      }
    }
    const rgpKey = `${req.method} ${url.pathname}`;
    if (rgpKey in RGP_ROUTES) {
      return forwardRgp(req, res, cfg, fetchImpl, RGP_ROUTES[rgpKey], url.search);
    }
    if (url.pathname === "/api/rens/fiches" && req.method === "GET") {
      return forwardRens(req, res, cfg, fetchImpl, "/fiches", url.search);
    }
    if (url.pathname === "/api/rens/fiche" && req.method === "GET") {
      const id = (url.searchParams.get("id") || "").replace(/[^0-9]/g, "");
      if (!id) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "ID_REQUIS" })); return; }
      return forwardRens(req, res, cfg, fetchImpl, "/fiches/" + id, "");
    }
    if (url.pathname === "/api/rens/referentiel" && req.method === "GET") {
      return forwardRens(req, res, cfg, fetchImpl, "/referentiel", "");
    }
    if (url.pathname === "/api/rens/referentiel/communes" && req.method === "GET") {
      return forwardRens(req, res, cfg, fetchImpl, "/referentiel/communes", url.search);
    }
    // Audit qualité GIPASP : forwards purs, la validation des paramètres est faite par
    // rens-api (le BFF ne doit pas dupliquer une règle métier).
    if (url.pathname === "/api/rens/audit/rapport" && req.method === "GET") {
      return forwardRens(req, res, cfg, fetchImpl, "/audit/rapport", url.search);
    }
    if (url.pathname === "/api/rens/audit/fiche" && req.method === "GET") {
      return forwardRens(req, res, cfg, fetchImpl, "/audit/fiche", url.search);
    }
    // Analyse à la demande : 1 à 20 fiches choisies dans le front. Asynchrone, parce que le
    // workflow met une à deux minutes — au-delà de ce que tient une requête HTTP derrière
    // Cloudflare. Le résultat n'est PAS persisté : le run nocturne reste la seule mesure
    // qui fait foi, une analyse interactive ne doit pas peser dans le taux de conformité.
    if (url.pathname === "/api/rens/audit/analyse" && req.method === "POST") {
      try {
        const { frs_ids: ids } = JSON.parse((await readBody(req)) || "{}");
        const propres = Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : [];
        if (!propres.length || propres.length > 20) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "SELECTION_INVALIDE" }));
          return;
        }
        const jobId = createGenericJob();
        runJob(jobId, async () => {
          const headers = {};
          if (cfg.rensApiToken) headers.Authorization = "Bearer " + cfg.rensApiToken;
          const up = await fetchImpl(`${cfg.rensApiUrl || ""}/audit/lot?frs_ids=${propres.join(",")}`, { method: "GET", headers });
          const corps = JSON.parse(await up.text());
          if (!up.ok) throw new Error(corps?.error?.code === "not_found" ? "LOT_INTROUVABLE" : "RENS_UPSTREAM");
          const { fiches, structurels } = corps.data;
          // composerFragment applique la liste blanche : le marqueur de vérité terrain
          // `defaut:` porté par les fiches piégées ne peut pas atteindre le prompt.
          const brut = await rensWorkflow({
            prompt: JSON.stringify(composerFragment(0, fiches)), appId: cfg.qualiteAppId, cfg, fetchImpl,
          });
          // parseSortieAgents jette sur une sortie illisible : le job passe en erreur plutôt
          // que de rendre un rapport « tout conforme » qui serait un mensonge.
          const { ecarts, dcp, rejets } = parseSortieAgents(brut, fiches.map((f) => f.id));
          return construireRapportAnalyse({ fiches, structurels, ecarts, dcp, rejets });
        });
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId }));
      } catch (e) {
        console.error("analyse_error", e?.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
      }
      return;
    }

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

    if (url.pathname === "/api/rens/synthese" && req.method === "POST") {
      try {
        await readBody(req); // corps ignoré : le prompt du zoom dérive de la synthèse
        // Job store (comme /api/query, /api/pvtcmp…) : le pipeline enchaîne DEUX workflows
        // IAka et peut dépasser la limite (~100s) du proxy d'accès. On rend un jobId tout de
        // suite et le front poll /api/job/status — le travail tourne détaché côté serveur.
        const jobId = createGenericJob();
        runJob(jobId, async () => {
          // (1) synthèse quotidienne (AUTONOME). extractSynthese renvoie un markdown non
          // vide ou jette (RENS_INVALIDE) → le job passe alors en erreur.
          const synthese = extractSynthese(await rensWorkflow({ appId: cfg.rensSyntheseAppId, cfg, fetchImpl }));
          // (2) zoom : reçoit la SORTIE de la synthèse en prompt (c'est ce qui fait varier
          // le signal détaillé). Bornée par sécurité (413/dépassement de contexte côté app).
          // BEST-EFFORT : un zoom en échec/vide renvoie la synthèse seule.
          const entreeZoom = synthese.slice(0, 12000);
          let zoom = "";
          try {
            if (cfg.rensZoomAppId) {
              const rZoom = await rensWorkflow({ prompt: entreeZoom, appId: cfg.rensZoomAppId, cfg, fetchImpl });
              zoom = extractSynthese(rZoom);
            }
          } catch { zoom = ""; }
          return { markdown: zoom ? `${synthese}\n\n---\n\n${zoom}` : synthese };
        });
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId }));
      } catch (e) {
        const status = ERROR_STATUS[e.message] ?? 500;
        // FRS à diffusion restreinte : pas de dump du contenu sur erreur connue.
        if (!(e.message in ERROR_STATUS)) console.error(e.message);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
    if (url.pathname === "/api/photo" && (req.method === "POST" || req.method === "GET")) {
      if (req.method === "POST") return handlePhotoUpload(req, res, cfg, fetchImpl);
      return handlePhotoGet(req, res, cfg, fetchImpl, url);
    }
    if (url.pathname === "/api/rgp/chat" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { prompt } = JSON.parse(raw || "{}");
        if (!prompt || typeof prompt !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "PROMPT_REQUIS" }));
          return;
        }
        // L'agent IAka ne connaît pas la date du jour : sans contexte il devine (ex.
        // « cette année » → 2025). On préfixe la date courante pour résoudre les termes
        // relatifs (cette année / ce mois / juin dernier…).
        const today = new Date().toISOString().slice(0, 10);
        const dated = `(Contexte : la date du jour est ${today}. Utilise-la pour interpréter « cette année », « ce mois », « juin », etc.)\n${prompt}`;
        const jobId = createGenericJob();
        runJob(jobId, async () => {
          // L'agent décrit parfois l'appel d'outil au lieu de l'exécuter (variance LLM) :
          // le résultat n'a alors PAS de <tool-output>. Aucun outil exécuté = aucune écriture
          // effectuée → on peut réessayer sans risque de double-action.
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
    if (url.pathname === "/api/evaluation/unas" && req.method === "GET") {
      try {
        const data = await listerUnasEvaluables({ cfg, fetchImpl });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data }));
      } catch (e) {
        const status = ERROR_STATUS[e.message] ?? 500;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
    if (url.pathname === "/api/evaluation" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { una, objetIds } = JSON.parse(raw || "{}");
        if (typeof una !== "string" || !una.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "UNA_REQUIS" }));
          return;
        }
        if (!Array.isArray(objetIds) || objetIds.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "OBJETS_REQUIS" }));
          return;
        }
        const jobId = createGenericJob();
        runJob(jobId, async () => evaluation({ una, objetIds, cfg, fetchImpl }));
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId }));
      } catch (e) {
        const status = ERROR_STATUS[e.message] ?? 500;
        // Les procédures sont à diffusion restreinte : on ne journalise que les
        // codes d'erreur, jamais le corps de la requête ni la réponse.
        if (!(e.message in ERROR_STATUS)) console.error(e.message);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
    if (url.pathname === "/api/synthese" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { files, contexte } = JSON.parse(raw || "{}");
        // Garde-fou de taille : le XML LRPGN observé fait 5 ko.
        const contexteXml = typeof contexte === "string" ? contexte.slice(0, 100_000) : null;
        if (!Array.isArray(files) || files.length === 0 || files.some((f) => !f?.base64)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "FICHIERS_REQUIS" }));
          return;
        }
        const jobId = createGenericJob();
        // worker : réutilise la logique existante, NORMALISE avant de stocker.
        runJob(jobId, async () => ({ texte: await synthese({ files, contexte: contexteXml, cfg, fetchImpl }) }));
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId }));
      } catch (e) {
        const status = ERROR_STATUS[e.message] ?? 500;
        // Pas de console.error(e) sur les erreurs connues : les pièces de procédure
        // sont à diffusion restreinte, on ne veut rien de leur contenu dans les logs.
        if (!(e.message in ERROR_STATUS)) console.error(e.message);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
    if (url.pathname === "/api/job/status" && req.method === "GET") {
      const job = getGenericJob(url.searchParams.get("jobId"));
      if (!job) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "JOB_INCONNU" }));
        return;
      }
      // Vue masquée : le job interne garde l'erreur brute (pour les logs), mais le
      // client ne reçoit jamais un message non whitelisté (cf. ERROR_STATUS).
      const view = {
        status: job.status,
        ...(job.result !== undefined ? { result: job.result } : {}),
        ...(job.error !== undefined
          ? { error: job.error in ERROR_STATUS ? job.error : "INTERNAL_ERROR" }
          : {}),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(view));
      return;
    }
    if (url.pathname === "/api/ariane" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { files } = JSON.parse(raw || "{}");
        if (!Array.isArray(files) || files.length === 0 || files.some((f) => !f?.base64)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "FICHIERS_REQUIS" }));
          return;
        }
        const jobId = createJob();
        // Fire-and-forget : le pipeline tourne en arrière-plan, le front poll /status.
        startJob({ jobId, files, cfg, fetchImpl });
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId }));
      } catch (e) {
        if (!(e.message in ERROR_STATUS)) console.error(e.message);
        res.writeHead(ERROR_STATUS[e.message] ?? 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
    if (url.pathname === "/api/ariane/status" && req.method === "GET") {
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
    // --- Chat RAG sur les pièces de la procédure ---
    // Route distincte du job d'analyse : une défaillance du chat ne doit jamais
    // alimenter le champ `error` d'un job Ariane, les deux sujets sont séparés.
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
      // SSE : l'en-tête part avant le premier octet de réponse du modèle, le front
      // affiche donc immédiatement une bulle vide qui se remplit.
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      try {
        // Capacité de chat incomplète (hôte OpenAI-compatible ou iak absent) : on coupe
        // avant l'appel amont. Sans ce test, l'URL se construirait sur un `undefined` et
        // le TypeError de fetch ressortirait en INTERNAL_ERROR, masquant une simple
        // configuration manquante derrière un code d'anomalie.
        if (!chatActif(cfg)) throw new Error("ARIANE_RAG_INDISPONIBLE");
        await ragChat({
          messages,
          cfg,
          fetchImpl,
          onDelta: (delta) => res.write(`data: ${JSON.stringify({ delta })}\n\n`),
        });
        res.write("data: [DONE]\n\n");
      } catch (e) {
        // Le statut HTTP est déjà parti : l'erreur ne peut plus prendre la forme d'un
        // code, elle passe dans le flux. Le message brut n'est jamais relayé — il peut
        // porter des octets du flux, donc du texte de procédure.
        if (!(e.message in ERROR_STATUS)) console.error("ariane_rag_chat_error");
        const code = e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR";
        res.write(`event: error\ndata: ${JSON.stringify({ error: code })}\n\n`);
      }
      res.end();
      return;
    }
    // DESTRUCTIF : vide entièrement le corpus visé par IAKA_RAG_CORPUS_ID. Le garde-fou
    // est porté par purgeCorpus, qui lève ARIANE_RAG_INDISPONIBLE (503) avant tout appel
    // réseau si aucun corpus n'est configuré — aucune purge ne peut partir « par défaut ».
    if (url.pathname === "/api/ariane/corpus/purge" && req.method === "POST") {
      try {
        const supprimes = await ragPurge({ cfg, fetchImpl });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ supprimes }));
      } catch (e) {
        if (!(e.message in ERROR_STATUS)) console.error("ariane_rag_purge_error");
        res.writeHead(ERROR_STATUS[e.message] ?? 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
    if (url.pathname === "/api/pvtcmp" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { files } = JSON.parse(raw || "{}");
        if (!Array.isArray(files) || files.length === 0 || files.some((f) => !f?.base64)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "FICHIERS_REQUIS" }));
          return;
        }
        const jobId = createGenericJob();
        runJob(jobId, async () => {
          // L'ingestion IAka échoue par intermittence (transitoire, aucune écriture) :
          // on réessaie tout le workflow sur PVTCMP_INGESTION uniquement.
          const maxAttempts = cfg.maxAttempts ?? 3;
          let out, lastErr;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              out = await pvtcmp({ files, cfg, fetchImpl });
              break;
            } catch (e) {
              lastErr = e;
              if (e.message !== "PVTCMP_INGESTION") throw e;
            }
          }
          if (!out) throw lastErr;
          return { texte: out };
        });
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId }));
      } catch (e) {
        const status = ERROR_STATUS[e.message] ?? 500;
        // Notes de terrain à diffusion restreinte : pas de dump du contenu en cas d'erreur connue.
        if (!(e.message in ERROR_STATUS)) console.error(e.message);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
    // --- Identification d'objet par photo (image en pièce jointe) ---
    if (url.pathname === "/api/identify" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { imageBase64, mime, filename } = JSON.parse(raw || "{}");
        if (!imageBase64 || typeof imageBase64 !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "IMAGE_REQUISE" }));
          return;
        }
        const jobId = createGenericJob();
        runJob(jobId, async () => {
          const maxAttempts = cfg.maxAttempts ?? 3;
          let objet, lastErr;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              objet = await identify({ imageBase64, mime, filename, cfg });
              break;
            } catch (e) {
              lastErr = e;
              if (e.message !== "OBJET_INVALID") throw e;
            }
          }
          if (!objet) throw lastErr;
          return objet;
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

    // --- Requête carte (texte → GeoJSON) ---
    if (url.pathname === "/api/query" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { question } = JSON.parse(raw || "{}");
        if (!question || typeof question !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "QUESTION_REQUISE" }));
          return;
        }
        const jobId = createGenericJob();
        runJob(jobId, async () => {
          // Le workflow carte est long (multi-agents) : délai ET intervalle de poll
          // dédiés — sinon on garde l'intervalle court par défaut sur un délai 8× plus
          // grand, soit des centaines de GET inutiles. Dérivé une fois, hors de la
          // boucle de réessai (invariant entre tentatives).
          const carteCfg = { ...cfg, pollTimeoutMs: cfg.cartePollTimeoutMs, pollIntervalMs: cfg.cartePollIntervalMs };
          // Le workflow IAka est intermittent (« Erreur interne module Tools » parfois
          // avant le SQL → pas de GeoJSON). On réessaie sur GEOJSON_INVALID.
          const maxAttempts = cfg.maxAttempts ?? 3;
          let geojson, lastErr;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              geojson = await run({ question, cfg: carteCfg, fetchImpl });
              break;
            } catch (e) {
              lastErr = e;
              if (e.message !== "GEOJSON_INVALID") throw e;
            }
          }
          if (!geojson) throw lastErr;
          return geojson;
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

    // --- Front statique (dist/) : tout ce qui n'est pas /api ---
    if (req.method === "GET" && cfg.staticDir && !url.pathname.startsWith("/api/")) {
      const { readFile } = await import("node:fs/promises");
      const { join, normalize } = await import("node:path");
      const rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
      const candidate = join(cfg.staticDir, rel);
      const filePath = candidate.endsWith("/") ? join(candidate, "index.html") : candidate;
      try {
        const data = await readFile(filePath);
        res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
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

    res.writeHead(404).end();
    } catch (e) {
      // readBody borne : 413 propre même si la route n'a pas de try/catch local.
      if (e?.message === "BODY_TOO_LARGE") return writeBodyTooLarge(res);
      console.error("handler_unhandled", e?.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
      }
    }
  };
}

const STATIC_CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

function contentTypeFor(path) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return STATIC_CONTENT_TYPES[ext] || "application/octet-stream";
}

// Démarrage direct : node --env-file=.env server/proxy.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadCfg(process.env);
  const port = Number(process.env.PROXY_PORT ?? 8787);
  createServer(createHandler({ cfg })).listen(port, () => {
    console.log(`proxy IAka sur http://localhost:${port}`);
  });
}
