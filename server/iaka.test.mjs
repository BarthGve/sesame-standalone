import { test } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow, runWorkflowRaw } from "./iaka.mjs";

const cfg = {
  baseUrl: "http://iaka.test",
  jwt: "jwt",
  appId: "app",
  tenantId: "tenant",
  pollIntervalMs: 0,
  pollTimeoutMs: 1000,
};
const noSleep = () => Promise.resolve();
const fc = { type: "FeatureCollection", features: [] };

function makeFetch(steps) {
  let i = 0;
  return async (url, opts) => {
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    return {
      ok: step.ok ?? true,
      status: step.status ?? 200,
      json: async () => step.body,
    };
  };
}

test("execute puis SUCCESS renvoie le GeoJSON", async () => {
  const fetchImpl = makeFetch([
    { body: { execution_id: "e1", status: "PENDING" } },      // execute
    { body: { status: "RUNNING" } },                          // poll 1
    { body: { status: "SUCCESS", result: JSON.stringify(fc) } }, // poll 2
  ]);
  const out = await runWorkflow({ question: "q", cfg, fetchImpl, sleep: noSleep });
  assert.equal(out.type, "FeatureCollection");
});

test("statut ERROR lève IAKA_UPSTREAM", async () => {
  const fetchImpl = makeFetch([
    { body: { execution_id: "e1", status: "PENDING" } },
    { body: { status: "ERROR", error: "boom" } },
  ]);
  await assert.rejects(
    runWorkflow({ question: "q", cfg, fetchImpl, sleep: noSleep }),
    /IAKA_UPSTREAM/
  );
});

test("timeout de polling lève IAKA_TIMEOUT", async () => {
  const fetchImpl = makeFetch([
    { body: { execution_id: "e1", status: "PENDING" } },
    { body: { status: "RUNNING" } }, // reste RUNNING indéfiniment
  ]);
  const fastTimeout = { ...cfg, pollTimeoutMs: 5, pollIntervalMs: 1 };
  await assert.rejects(
    runWorkflow({ question: "q", cfg: fastTimeout, fetchImpl, sleep: noSleep }),
    /IAKA_TIMEOUT/
  );
});

test("HTTP non-ok sur execute lève IAKA_UPSTREAM", async () => {
  const fetchImpl = makeFetch([{ ok: false, status: 502, body: {} }]);
  await assert.rejects(
    runWorkflow({ question: "q", cfg, fetchImpl, sleep: noSleep }),
    /IAKA_UPSTREAM/
  );
});

test("runWorkflowRaw renvoie le result brut et envoie l'app_id RGP", async () => {
  const cfg = { baseUrl: "http://x", jwt: "j", tenantId: "t", rgpAppId: "app", pollIntervalMs: 0, pollTimeoutMs: 100 };
  let execBody;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/workflows/execute")) {
      execBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ execution_id: "e1" }) };
    }
    return { ok: true, json: async () => ({ status: "SUCCESS", result: '<tool-output>{"data":[]}</tool-output>' }) };
  };
  const out = await runWorkflowRaw({ prompt: "liste", cfg, fetchImpl, sleep: async () => {} });
  assert.equal(out, '<tool-output>{"data":[]}</tool-output>');
  assert.equal(execBody.app_id, "app");
  assert.equal(execBody.prompt, "liste");
});

test("cfg sans baseUrl lève IAKA_UNAVAILABLE avant tout fetch", async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(
    runWorkflow({ question: "q", cfg: { jwt: "j", tenantId: "t", appId: "a", pollTimeoutMs: 10, pollIntervalMs: 1 }, fetchImpl, sleep: noSleep }),
    /IAKA_UNAVAILABLE/
  );
  assert.equal(called, 0);
});

test("executePath / statusPath custom sont utilisés", async () => {
  const urls = [];
  const cfg = { baseUrl: "http://iaka", jwt: "j", tenantId: "t", appId: "a", executePath: "/v2/run", statusPath: "/v2/jobs/{id}", pollIntervalMs: 0, pollTimeoutMs: 100 };
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/v2/run")) return { ok: true, json: async () => ({ execution_id: "e1" }) };
    return { ok: true, json: async () => ({ status: "SUCCESS", result: JSON.stringify(fc) }) };
  };
  await runWorkflow({ question: "q", cfg, fetchImpl, sleep: noSleep });
  assert.equal(urls[0], "http://iaka/v2/run");
  assert.ok(urls[1].startsWith("http://iaka/v2/jobs/e1"));
});
