import { test } from "node:test";
import assert from "node:assert/strict";
import { extraireEvaluation, runEvaluation } from "./evaluationWorkflow.mjs";

const REPONSE = {
  evaluations: [
    {
      objet_id: 42,
      estimation_prix: {
        prix_bas: 8500, prix_moyen: 10200, prix_haut: 11800, devise: "EUR",
        hypotheses: ["Kilométrage déclaré 120 000 km"],
        sources: [{ site: "LaCentrale", url: "https://cote.local/a/1", prix: 10490 }],
        confiance: 0.7,
        avertissement: "Source simulée, non contractuelle.",
      },
      enregistre: true,
    },
  ],
  non_evalues: [{ objet_id: 57, raison: "Année de mise en circulation absente" }],
  total: { bas: 8500, moyen: 10200, haut: 11800 },
  pv_evaluation: "## Objets évalués\n…",
};

test("extrait la reponse JSON du workflow", () => {
  const r = extraireEvaluation(JSON.stringify(REPONSE));
  assert.equal(r.evaluations[0].objet_id, 42);
  assert.equal(r.pv_evaluation.startsWith("## Objets"), true);
});

test("retire la trace d'agent et deballe une fence", () => {
  const brut = "<tool>lire_objets<tool-output>{}</tool-output></tool>\n```json\n" + JSON.stringify(REPONSE) + "\n```";
  assert.equal(extraireEvaluation(brut).evaluations.length, 1);
});

test("une reponse sans evaluations ni non_evalues est invalide", () => {
  assert.throws(() => extraireEvaluation(JSON.stringify({ pv_evaluation: "x" })), /EVALUATION_INVALIDE/);
});

test("une reponse sans PV est invalide", () => {
  assert.throws(
    () => extraireEvaluation(JSON.stringify({ evaluations: [], non_evalues: [] })),
    /EVALUATION_INVALIDE/
  );
});

test("une reponse non JSON est invalide", () => {
  assert.throws(() => extraireEvaluation("désolé, je n'ai pas pu"), /EVALUATION_INVALIDE/);
  assert.throws(() => extraireEvaluation(null), /EVALUATION_INVALIDE/);
});

test("les listes absentes deviennent des listes vides, pas undefined", () => {
  const r = extraireEvaluation(JSON.stringify({ evaluations: [], pv_evaluation: "x" }));
  assert.deepEqual(r.non_evalues, []);
  assert.deepEqual(r.evaluations, []);
});

// Une entrée sans identifiant d'objet ne se rattache à aucun véhicule : elle ne
// peut ni s'afficher, ni être confrontée à la base. Elle est écartée ici, avant
// d'atteindre le front.
test("les entrees sans identifiant d'objet exploitable sont ecartees", () => {
  const r = extraireEvaluation(
    JSON.stringify({
      evaluations: [
        { objet_id: 42, estimation_prix: { prix_moyen: 100 } },
        { objet_id: null, estimation_prix: { prix_moyen: 100 } },
        { estimation_prix: { prix_moyen: 100 } },
        "pas un objet",
        null,
      ],
      non_evalues: [{ objet_id: 57, raison: "x" }, { raison: "sans identifiant" }],
      pv_evaluation: "x",
    })
  );
  assert.deepEqual(
    r.evaluations.map((e) => e.objet_id),
    [42]
  );
  assert.deepEqual(
    r.non_evalues.map((n) => n.objet_id),
    [57]
  );
});

test("un total de forme inattendue est ramene a null", () => {
  const avecNombre = extraireEvaluation(
    JSON.stringify({ evaluations: [], total: 18000, pv_evaluation: "x" })
  );
  assert.equal(avecNombre.total, null);
  const avecObjet = extraireEvaluation(
    JSON.stringify({ evaluations: [], total: { bas: 1, moyen: 2, haut: 3 }, pv_evaluation: "x" })
  );
  assert.deepEqual(avecObjet.total, { bas: 1, moyen: 2, haut: 3 });
});

// Stub IAka : POST d'exécution puis interrogations du statut.
function stubIaka(resultat, { statutsAvant = 0 } = {}) {
  const appels = [];
  let restants = statutsAvant;
  const fetchImpl = async (url, init) => {
    appels.push({ url, method: init?.method ?? "GET", body: init?.body });
    if (init?.method === "POST") return { ok: true, json: async () => ({ execution_id: "exec-1" }) };
    if (restants-- > 0) return { ok: true, json: async () => ({ status: "RUNNING" }) };
    return { ok: true, json: async () => ({ status: "SUCCESS", result: JSON.stringify(resultat) }) };
  };
  return { fetchImpl, appels };
}

const CFG = {
  jwt: "j", baseUrl: "https://iaka.test", evaluationAppId: "app-eval", tenantId: "t",
  pollIntervalMs: 1, pollTimeoutMs: 1000,
};

test("transmet una et objetIds au workflow, et rend sa reponse", async () => {
  const { fetchImpl, appels } = stubIaka(REPONSE);
  const r = await runEvaluation({
    una: "12345/00042/2026", objetIds: [42, 57], cfg: CFG, fetchImpl, sleep: async () => {},
  });
  assert.equal(r.evaluations[0].objet_id, 42);
  const envoye = JSON.parse(appels[0].body);
  assert.equal(envoye.app_id, "app-eval");
  const prompt = JSON.parse(envoye.prompt);
  assert.equal(prompt.una, "12345/00042/2026");
  assert.deepEqual(prompt.objetIds, [42, 57]);
});

test("attend la fin de l'execution avant de rendre", async () => {
  const { fetchImpl, appels } = stubIaka(REPONSE, { statutsAvant: 2 });
  await runEvaluation({ una: "u", objetIds: [1], cfg: CFG, fetchImpl, sleep: async () => {} });
  assert.ok(appels.filter((a) => a.method === "GET").length >= 3);
});

test("statut ERROR -> EVALUATION_UPSTREAM", async () => {
  const fetchImpl = async (url, init) =>
    init?.method === "POST"
      ? { ok: true, json: async () => ({ execution_id: "e" }) }
      : { ok: true, json: async () => ({ status: "ERROR" }) };
  await assert.rejects(
    runEvaluation({ una: "u", objetIds: [1], cfg: CFG, fetchImpl, sleep: async () => {} }),
    /EVALUATION_UPSTREAM/
  );
});

test("delai depasse -> EVALUATION_TIMEOUT", async () => {
  const fetchImpl = async (url, init) =>
    init?.method === "POST"
      ? { ok: true, json: async () => ({ execution_id: "e" }) }
      : { ok: true, json: async () => ({ status: "RUNNING" }) };
  await assert.rejects(
    runEvaluation({
      una: "u", objetIds: [1], cfg: { ...CFG, pollTimeoutMs: 0 }, fetchImpl, sleep: async () => {},
    }),
    /EVALUATION_TIMEOUT/
  );
});

test("sans objetIds -> OBJETS_REQUIS, sans appeler le workflow", async () => {
  let appele = false;
  const fetchImpl = async () => { appele = true; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(
    runEvaluation({ una: "u", objetIds: [], cfg: CFG, fetchImpl, sleep: async () => {} }),
    /OBJETS_REQUIS/
  );
  assert.equal(appele, false);
});

test("fetchImpl qui rejette (reseau coupe) -> EVALUATION_UPSTREAM", async () => {
  const fetchImpl = async () => { throw new Error("network down"); };
  await assert.rejects(
    runEvaluation({ una: "u", objetIds: [1], cfg: CFG, fetchImpl, sleep: async () => {} }),
    /EVALUATION_UPSTREAM/
  );
});

test("reponse dont .json() leve (corps non-JSON) -> EVALUATION_UPSTREAM", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => { throw new SyntaxError("Unexpected token"); },
  });
  await assert.rejects(
    runEvaluation({ una: "u", objetIds: [1], cfg: CFG, fetchImpl, sleep: async () => {} }),
    /EVALUATION_UPSTREAM/
  );
});

test("statut poll avec corps JSON non-objet (null) -> EVALUATION_UPSTREAM", async () => {
  const fetchImpl = async (url, init) =>
    init?.method === "POST"
      ? { ok: true, json: async () => ({ execution_id: "e" }) }
      : { ok: true, json: async () => null };
  await assert.rejects(
    runEvaluation({ una: "u", objetIds: [1], cfg: CFG, fetchImpl, sleep: async () => {} }),
    /EVALUATION_UPSTREAM/
  );
});

test("une fence decoy suivie de la vraie reponse -> on garde la derniere fence", () => {
  const decoy = "```json\n" + JSON.stringify({ evaluations: [], pv_evaluation: "brouillon" }) + "\n```";
  const brut = decoy + "\nVoici ma reponse finale :\n```json\n" + JSON.stringify(REPONSE) + "\n```";
  const r = extraireEvaluation(brut);
  assert.equal(r.evaluations[0].objet_id, 42);
  assert.equal(r.pv_evaluation.startsWith("## Objets"), true);
});

test("statut SUCCESS avec result illisible -> EVALUATION_INVALIDE (pas EVALUATION_UPSTREAM)", async () => {
  const fetchImpl = async (url, init) =>
    init?.method === "POST"
      ? { ok: true, json: async () => ({ execution_id: "e" }) }
      : { ok: true, json: async () => ({ status: "SUCCESS", result: "désolé, je n'ai pas pu" }) };
  await assert.rejects(
    runEvaluation({ una: "u", objetIds: [1], cfg: CFG, fetchImpl, sleep: async () => {} }),
    /EVALUATION_INVALIDE/
  );
});
