// Utilitaires HTTP partagés du BFF : corps borné, codes d'erreur stables, journal
// d'exploitation sans données de procédure.

export const ERROR_STATUS = {
  IAKA_TIMEOUT: 504,
  IAKA_UPSTREAM: 502,
  GEOJSON_INVALID: 502,
  IDENTIFY_TIMEOUT: 504,
  IDENTIFY_UPSTREAM: 502,
  OBJET_INVALID: 502,
  SYNTHESE_TIMEOUT: 504,
  SYNTHESE_UPSTREAM: 502,
  SYNTHESE_INVALIDE: 502,
  PVTCMP_TIMEOUT: 504,
  PVTCMP_UPSTREAM: 502,
  PVTCMP_INVALIDE: 502,
  PVTCMP_INGESTION: 503,
  RENS_UPSTREAM: 502,
  RENS_INVALIDE: 502,
  ARIANE_UPSTREAM: 502,
  ARIANE_TIMEOUT: 504,
  ARIANE_INVALIDE: 502,
  ARIANE_RAG_PURGE: 502,
  ARIANE_RAG_INGEST: 502,
  ARIANE_RAG_CHAT: 502,
  ARIANE_RAG_INDISPONIBLE: 503,
  UNAS_UPSTREAM: 502,
  EVALUATION_TIMEOUT: 504,
  EVALUATION_UPSTREAM: 502,
  EVALUATION_INVALIDE: 502,
  OBJETS_REQUIS: 400,
  UNA_REQUIS: 400,
  BODY_TOO_LARGE: 413,
  UNAUTHORIZED: 401,
};

// Borne anti-DoS mémoire : photos base64 + PDF multi-pièces Ariane. Défaut 15 Mo.
export const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 15 * 1024 * 1024);

export function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        if (typeof req.destroy === "function") req.destroy();
        reject(new Error("BODY_TOO_LARGE"));
        return;
      }
      data += c;
    });
    req.on("end", () => resolve(data));
    req.on("error", (e) => reject(e));
  });
}

export function writeJson(res, code, obj) {
  if (res.headersSent) return;
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

export function writeBodyTooLarge(res) {
  writeJson(res, 413, { error: "BODY_TOO_LARGE" });
}

export function writeError(res, codeOrMessage) {
  const msg = typeof codeOrMessage === "string" ? codeOrMessage : "INTERNAL_ERROR";
  const status = ERROR_STATUS[msg] ?? 500;
  writeJson(res, status, { error: msg in ERROR_STATUS ? msg : "INTERNAL_ERROR" });
}

// Journal d'exploitation SANS query ni body : méthode, route, présence d'auth.
// Suffit à diagnostiquer sans exposer de données de procédure dans docker logs.
export function logRequest(req, url) {
  console.log(JSON.stringify({
    t: new Date().toISOString(),
    m: req.method,
    p: url.pathname,
    auth: Boolean(req.headers?.authorization || req.headers?.["cf-access-jwt-assertion"]),
  }));
}

/**
 * Auth applicative optionnelle du BFF.
 *
 * Modèle de confiance :
 * - Prod : Cloudflare Access protège l'origine (SPA + /api). Pas de Bearer dans le
 *   navigateur (token embarqué = secret public).
 * - Defense-in-depth : si BFF_API_TOKEN est défini, TOUTES les routes /api/* exigent
 *   `Authorization: Bearer <token>` (utile pour appels machine-to-machine / tests).
 *   /health et le static restent publics.
 * - Si BFF_REQUIRE_CF_ACCESS=1, les /api/* exigent l'en-tête Cloudflare Access
 *   `Cf-Access-Jwt-Assertion` (posé par le proxy ; on ne vérifie pas la signature
 *   ici — la validation crypto est faite par Cloudflare avant d'atteindre le BFF).
 *
 * @returns {string|null} code d'erreur (UNAUTHORIZED) ou null si OK
 */
export function checkBffAccess(req, url, cfg = {}) {
  if (!url.pathname.startsWith("/api/")) return null;

  if (cfg.requireCfAccess) {
    if (!req.headers?.["cf-access-jwt-assertion"]) return "UNAUTHORIZED";
  }

  const token = cfg.bffApiToken || "";
  if (token) {
    if ((req.headers?.authorization || "") !== "Bearer " + token) return "UNAUTHORIZED";
  }

  return null;
}
