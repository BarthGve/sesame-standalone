const APP_IDS = {
  carte: "IAKA_CARTE_APP_ID",
  identify: "IAKA_IDENTIFY_APP_ID",
  rgp: "IAKA_RGP_APP_ID",
  synthese: "IAKA_SYNTHESE_APP_ID",
  evaluation: "IAKA_EVALUATION_APP_ID",
  pvtcmp: "IAKA_PVTCMP_APP_ID",
  arianeExtraction: "IAKA_ARIANE_EXTRACTION_APP_ID",
  arianeConsolidation: "IAKA_ARIANE_CONSOLIDATION_APP_ID",
  rensSynthese: "IAKA_RENS_SYNTHESE_APP_ID",
  rensZoom: "IAKA_RENS_ZOOM_APP_ID",
  qualite: "IAKA_QUALITE_APP_ID",
};

function filled(v) {
  return Boolean(v && String(v).trim());
}

export function loadCfg(env = process.env) {
  const e = env;
  const carteApp = e.IAKA_CARTE_APP_ID || e.IAKA_APP_ID;
  return {
    baseUrl: e.IAKA_BASE_URL || "",
    jwt: e.IAKA_JWT || "",
    tenantId: e.IAKA_TENANT_ID || "",
    executePath: e.IAKA_EXECUTE_PATH || "/workflows/execute",
    statusPath: e.IAKA_STATUS_PATH || "/workflows/executions/{id}",
    appId: carteApp || "",
    identifyAppId: e.IAKA_IDENTIFY_APP_ID || "",
    rgpAppId: e.IAKA_RGP_APP_ID || "",
    syntheseAppId: e.IAKA_SYNTHESE_APP_ID || "",
    evaluationAppId: e.IAKA_EVALUATION_APP_ID || "",
    pvtcmpAppId: e.IAKA_PVTCMP_APP_ID || "",
    arianeExtractionAppId: e.IAKA_ARIANE_EXTRACTION_APP_ID || "",
    arianeConsolidationAppId: e.IAKA_ARIANE_CONSOLIDATION_APP_ID || "",
    rensSyntheseAppId: e.IAKA_RENS_SYNTHESE_APP_ID || "",
    rensZoomAppId: e.IAKA_RENS_ZOOM_APP_ID || "",
    qualiteAppId: e.IAKA_QUALITE_APP_ID || "",
    mapConcurrency: Number(e.ARIANE_MAP_CONCURRENCY ?? 4),
    ragBaseUrl: e.IAKA_RAG_BASE_URL || "",
    ragCorpusId: e.IAKA_RAG_CORPUS_ID || "",
    ragIakId: e.IAKA_RAG_IAK_ID || "",
    ragModel: e.IAKA_RAG_MODEL || "",
    ragMaxTokens: Number(e.IAKA_RAG_MAX_TOKENS ?? 28000),
    imageField: e.IAKA_IMAGE_FIELD || "file",
    syntheseFileField: e.IAKA_SYNTHESE_FILE_FIELD,
    pvtcmpFileField: e.IAKA_PVTCMP_FILE_FIELD,
    pollIntervalMs: Number(e.POLL_INTERVAL_MS ?? 1500),
    pollTimeoutMs: Number(e.POLL_TIMEOUT_MS ?? 60000),
    cartePollTimeoutMs: Number(e.CARTE_POLL_TIMEOUT_MS ?? 480000),
    cartePollIntervalMs: Number(e.CARTE_POLL_INTERVAL_MS ?? 4000),
    rgpApiUrl: e.RGP_API_URL || "http://rgp-api:8080",
    rgpApiToken: e.RGP_API_TOKEN || "",
    rensApiUrl: e.RENS_API_URL || "http://rens-api:8080",
    rensApiToken: e.RENS_API_TOKEN || "",
    mapTilesUrl: e.MAP_TILES_URL || "",
    banApiUrl: e.BAN_API_URL || "",
    staticDir: e.STATIC_DIR || null,
    bffApiToken: e.BFF_API_TOKEN || "",
    auditNightly: e.AUDIT_NIGHTLY === "1",
  };
}

export function publicConfig(cfg) {
  const tiles = filled(cfg.mapTilesUrl);
  return {
    tiles,
    tilesUrl: tiles ? "/api/tiles/{z}/{x}/{y}" : null,
    ban: filled(cfg.banApiUrl),
    workflows: {
      carte: filled(cfg.appId),
      identify: filled(cfg.identifyAppId),
      rgp: filled(cfg.rgpAppId),
      synthese: filled(cfg.syntheseAppId),
      evaluation: filled(cfg.evaluationAppId),
      pvtcmp: filled(cfg.pvtcmpAppId),
      arianeExtraction: filled(cfg.arianeExtractionAppId),
      arianeConsolidation: filled(cfg.arianeConsolidationAppId),
      rensSynthese: filled(cfg.rensSyntheseAppId),
      rensZoom: filled(cfg.rensZoomAppId),
      qualite: filled(cfg.qualiteAppId),
    },
    rag: filled(cfg.ragCorpusId),
  };
}

export function iakaReady(cfg) {
  if (!filled(cfg.baseUrl) || !filled(cfg.jwt) || !filled(cfg.tenantId)) {
    throw new Error("IAKA_UNAVAILABLE");
  }
}

export function requireWorkflow(cfg, appId) {
  iakaReady(cfg);
  if (!filled(appId)) throw new Error("WORKFLOW_NON_CONFIGURE");
}

export { APP_IDS };
