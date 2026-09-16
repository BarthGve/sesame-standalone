import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTexte, runSynthese } from "./synthese.mjs";

test("retire la trace d'agent <tool>…</tool>", () => {
  const result =
    "<tool>lire_piece<tool-output>{...}</tool-output></tool>\n\nSynthèse : les faits se sont produits le 3 mars.";
  assert.equal(extractTexte(result), "Synthèse : les faits se sont produits le 3 mars.");
});

test("déballe une fence markdown", () => {
  const result = "```markdown\n## Faits\n\nLe 3 mars, cambriolage.\n```";
  assert.equal(extractTexte(result), "## Faits\n\nLe 3 mars, cambriolage.");
});

test("texte nu conservé tel quel", () => {
  assert.equal(extractTexte("  Synthèse libre.  "), "Synthèse libre.");
});

test("result vide ou non textuel → SYNTHESE_INVALIDE", () => {
  assert.throws(() => extractTexte(""), /SYNTHESE_INVALIDE/);
  assert.throws(() => extractTexte(null), /SYNTHESE_INVALIDE/);
  assert.throws(() => extractTexte("<tool>x</tool>"), /SYNTHESE_INVALIDE/);
});

const CFG = {
  jwt: "j",
  baseUrl: "https://iaka.test",
  syntheseAppId: "app",
  tenantId: "t",
  pollIntervalMs: 1,
  pollTimeoutMs: 1000,
};
const FILES = [{ base64: "AAAA", mime: "application/pdf", filename: "pv.pdf" }];
const SUCCES = { ok: true, json: async () => ({ status: "SUCCESS", result: "## Analyse" }) };

// Enregistre chaque POST d'exécution et sa valeur du champ `prompt`.
function stub(reponsesExec) {
  const prompts = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    if (init?.method === "POST") {
      prompts.push(init.body.get("prompt"));
      const r = reponsesExec[Math.min(i++, reponsesExec.length - 1)];
      return r.ok
        ? { ok: true, status: 200, json: async () => ({ execution_id: "e" }) }
        : { ok: false, status: r.status, json: async () => ({}) };
    }
    return SUCCES;
  };
  return { fetchImpl, prompts };
}

test("le contexte part en champ prompt", async () => {
  const { fetchImpl, prompts } = stub([{ ok: true }]);
  const texte = await runSynthese({
    files: FILES,
    contexte: "<Procedure/>",
    cfg: CFG,
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(texte, "## Analyse");
  assert.deepEqual(prompts, ["<contexte_procedure>\n<Procedure/>\n</contexte_procedure>"]);
});

test("un refus 422 déclenche un second envoi sans contexte", async () => {
  const { fetchImpl, prompts } = stub([{ ok: false, status: 422 }, { ok: true }]);
  const texte = await runSynthese({
    files: FILES,
    contexte: "<Procedure/>",
    cfg: CFG,
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(texte, "## Analyse");
  assert.deepEqual(prompts, ["<contexte_procedure>\n<Procedure/>\n</contexte_procedure>", null]);
});

test("sans contexte, un seul envoi", async () => {
  const { fetchImpl, prompts } = stub([{ ok: true }]);
  await runSynthese({ files: FILES, cfg: CFG, fetchImpl, sleep: async () => {} });
  assert.deepEqual(prompts, [null]);
});

test("une panne 500 ne déclenche pas de rejeu", async () => {
  const { fetchImpl, prompts } = stub([{ ok: false, status: 500 }]);
  await assert.rejects(
    runSynthese({
      files: FILES,
      contexte: "<Procedure/>",
      cfg: CFG,
      fetchImpl,
      sleep: async () => {},
    }),
    /SYNTHESE_UPSTREAM/
  );
  assert.equal(prompts.length, 1);
});

test("sans IAKA_BASE_URL → IAKA_UNAVAILABLE avant tout fetch", async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(
    runSynthese({
      files: FILES,
      cfg: { jwt: "j", tenantId: "t", syntheseAppId: "app", pollTimeoutMs: 10, pollIntervalMs: 1 },
      fetchImpl,
      sleep: async () => {},
    }),
    /IAKA_UNAVAILABLE/,
  );
  assert.equal(called, 0);
});

test("app_id vide → WORKFLOW_NON_CONFIGURE avant tout fetch", async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(
    runSynthese({
      files: FILES,
      cfg: { baseUrl: "https://iaka.test", jwt: "j", tenantId: "t", syntheseAppId: "", pollTimeoutMs: 10, pollIntervalMs: 1 },
      fetchImpl,
      sleep: async () => {},
    }),
    /WORKFLOW_NON_CONFIGURE/,
  );
  assert.equal(called, 0);
});

test("le XML est delimite comme donnee, jamais colle brut au prompt", async () => {
  const { fetchImpl, prompts } = stub([{ ok: true }]);
  await runSynthese({
    files: FILES,
    contexte: "<Procedure><Personne_Nom>BIDULE</Personne_Nom></Procedure>",
    cfg: CFG,
    fetchImpl,
    sleep: async () => {},
  });
  // Le workflow porte son instruction figee : le champ prompt ne transporte que
  // la donnee, encadree pour qu'elle ne puisse pas se lire comme une consigne.
  assert.match(prompts[0], /^<contexte_procedure>\n/);
  assert.match(prompts[0], /\n<\/contexte_procedure>$/);
  assert.ok(prompts[0].includes("BIDULE"));
});
