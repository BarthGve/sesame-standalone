import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCfg, publicConfig, iakaReady, requireWorkflow } from "./config.mjs";

const base = {
  IAKA_BASE_URL: "http://iaka:8080",
  IAKA_JWT: "jwt",
  IAKA_TENANT_ID: "t",
};

test("loadCfg : chemins IAKA par défaut et surchargeables", () => {
  const a = loadCfg(base);
  assert.equal(a.executePath, "/workflows/execute");
  assert.equal(a.statusPath, "/workflows/executions/{id}");
  const b = loadCfg({
    ...base,
    IAKA_EXECUTE_PATH: "/v2/run",
    IAKA_STATUS_PATH: "/v2/jobs/{id}",
  });
  assert.equal(b.executePath, "/v2/run");
  assert.equal(b.statusPath, "/v2/jobs/{id}");
});

test("publicConfig : booléens, pas de JWT ni d'UUID", () => {
  const cfg = loadCfg({
    ...base,
    IAKA_CARTE_APP_ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    IAKA_JWT: "super-secret",
    MAP_TILES_URL: "http://tiles/{z}/{x}/{y}.png",
    BAN_API_URL: "http://addok:7878",
    IAKA_RAG_CORPUS_ID: "corpus-1",
  });
  const p = publicConfig(cfg);
  const dumped = JSON.stringify(p);
  assert.equal(p.tiles, true);
  assert.equal(p.tilesUrl, "/api/tiles/{z}/{x}/{y}");
  assert.equal(p.ban, true);
  assert.equal(p.workflows.carte, true);
  assert.equal(p.workflows.rgp, false);
  assert.equal(p.rag, true);
  assert.ok(!dumped.includes("super-secret"));
  assert.ok(!dumped.includes("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
  assert.ok(!dumped.includes("http://tiles"));
});

test("iakaReady lève IAKA_UNAVAILABLE si URL/JWT/tenant manquent", () => {
  assert.throws(() => iakaReady(loadCfg({})), /IAKA_UNAVAILABLE/);
  assert.doesNotThrow(() => iakaReady(loadCfg(base)));
});

test("requireWorkflow : IAKA_UNAVAILABLE puis WORKFLOW_NON_CONFIGURE", () => {
  const ready = loadCfg(base);
  assert.throws(() => requireWorkflow(loadCfg({}), "app"), /IAKA_UNAVAILABLE/);
  assert.throws(() => requireWorkflow(ready, ""), /WORKFLOW_NON_CONFIGURE/);
  assert.throws(() => requireWorkflow(ready, "  "), /WORKFLOW_NON_CONFIGURE/);
  assert.doesNotThrow(() => requireWorkflow(ready, "app"));
});

test("app_id vide → workflow false", () => {
  const p = publicConfig(loadCfg(base));
  for (const k of Object.keys(p.workflows)) assert.equal(p.workflows[k], false);
});
