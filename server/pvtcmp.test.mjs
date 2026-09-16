import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPv, runPvtcmp } from "./pvtcmp.mjs";

// L'agent de rédaction rend un objet JSON { rubriques_redigees: [{cle, texte}] }, souvent
// entouré de traces d'agent (<tool>…</tool>) ou d'un fence. Ici les rubriques sont en désordre :
// le rendu doit les remettre dans l'ordre canonique de la trame.
const RESULT = [
  '<tool>redaction</tool>\n\n',
  '```json\n',
  JSON.stringify({
    rubriques_redigees: [
      { cle: "cloture", texte: "Procès-verbal clos et transmis." },
      { cle: "saisine", texte: "Sur instruction du CORG. [src: PCE-001/SEG-002]" },
    ],
  }),
  '\n```',
].join("");

test("extractPv : rubriques → HTML, ordre canonique de la trame", () => {
  const html = extractPv(RESULT);
  assert.match(html, /<h2>Saisine<\/h2>/);
  assert.match(html, /<h2>Clôture<\/h2>/);
  assert.match(html, /<p>Sur instruction du CORG\. \[src: PCE-001\/SEG-002\]<\/p>/);
  // Saisine (1re de la trame) doit précéder Clôture (dernière), quel que soit l'ordre reçu.
  assert.ok(html.indexOf("Saisine") < html.indexOf("Clôture"), "ordre canonique respecté");
});

test("extractPv : double saut de ligne → paragraphes distincts", () => {
  const r = JSON.stringify({ rubriques_redigees: [{ cle: "saisine", texte: "Premier bloc.\n\nSecond bloc." }] });
  const html = extractPv(r);
  assert.match(html, /<p>Premier bloc\.<\/p><p>Second bloc\.<\/p>/);
});

test("extractPv : entrée non conforme → PVTCMP_INVALIDE", () => {
  assert.throws(() => extractPv("<tool>rien</tool>"), /PVTCMP_INVALIDE/); // pas de JSON
  assert.throws(() => extractPv('{"autre":1}'), /PVTCMP_INVALIDE/);        // pas de rubriques_redigees
  assert.throws(() => extractPv('{"rubriques_redigees":[]}'), /PVTCMP_INVALIDE/); // tableau vide
  assert.throws(() => extractPv(""), /PVTCMP_INVALIDE/);
  assert.throws(() => extractPv(null), /PVTCMP_INVALIDE/);
});

test("runPvtcmp : execute multipart puis poll jusqu'au SUCCESS → texte HTML", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method });
    if (url.endsWith("/workflows/execute")) {
      assert.equal(init.method, "POST");
      assert.ok(init.body instanceof FormData);
      assert.equal(init.body.get("app_id"), "APP");
      assert.ok(init.body.get("file"), "champ file présent");
      return { ok: true, json: async () => ({ execution_id: "EX1" }) };
    }
    return { ok: true, json: async () => ({ status: "SUCCESS", result: RESULT }) };
  };
  const cfg = { baseUrl: "http://x", jwt: "j", tenantId: "t", pvtcmpAppId: "APP", pollIntervalMs: 1, pollTimeoutMs: 1000 };
  const out = await runPvtcmp({ files: [{ base64: "AA==", mime: "text/markdown", filename: "notes.md" }], cfg, fetchImpl, sleep: async () => {} });
  assert.match(out, /<h2>Saisine<\/h2>/);
  assert.ok(calls[0].url.endsWith("/workflows/execute"));
});

test("runPvtcmp : ERROR d'ingestion → PVTCMP_INGESTION (réessayable)", async () => {
  const fetchImpl = async (url) =>
    url.endsWith("/workflows/execute")
      ? { ok: true, json: async () => ({ execution_id: "EX1" }) }
      : { ok: true, json: async () => ({ status: "ERROR", error: "Ingestion not completed after 10 attempts of 5 seconds." }) };
  const cfg = { baseUrl: "http://x", jwt: "j", tenantId: "t", pvtcmpAppId: "APP", pollIntervalMs: 1, pollTimeoutMs: 1000 };
  await assert.rejects(
    runPvtcmp({ files: [{ base64: "AA==" }], cfg, fetchImpl, sleep: async () => {} }),
    /PVTCMP_INGESTION/
  );
});

test("runPvtcmp : status ERROR → PVTCMP_UPSTREAM", async () => {
  const fetchImpl = async (url) =>
    url.endsWith("/workflows/execute")
      ? { ok: true, json: async () => ({ execution_id: "EX1" }) }
      : { ok: true, json: async () => ({ status: "ERROR" }) };
  const cfg = { baseUrl: "http://x", jwt: "j", tenantId: "t", pvtcmpAppId: "APP", pollIntervalMs: 1, pollTimeoutMs: 1000 };
  await assert.rejects(
    runPvtcmp({ files: [{ base64: "AA==" }], cfg, fetchImpl, sleep: async () => {} }),
    /PVTCMP_UPSTREAM/
  );
});
