import { test } from "node:test";
import assert from "node:assert/strict";
import { listerUnasEvaluables } from "./unasEvaluables.mjs";

const CFG = { rgpApiUrl: "http://rgp", rgpApiToken: "jeton" };

// fetch factice : sert les procédures, puis les perquisitions de chacune.
function stub(procedures, perquisitionsParUna, echecs = {}) {
  const appels = [];
  const fetchImpl = async (url) => {
    appels.push(url);
    if (url.includes("/procedures")) {
      return { ok: true, json: async () => ({ data: procedures }) };
    }
    const una = decodeURIComponent(new URL(url).searchParams.get("una"));
    if (echecs[una]) return { ok: false, status: echecs[una], json: async () => ({ error: { message: "boom" } }) };
    return { ok: true, json: async () => ({ data: perquisitionsParUna[una] ?? [] }) };
  };
  return { fetchImpl, appels };
}

const PROCS = [
  { una: "12345/00042/2026", groupe_libelle: "Groupe 1", synthese: "Cambriolages", urgent: true, sensible: false },
  { una: "12345/00043/2026", groupe_libelle: null, synthese: "Stupéfiants", urgent: false, sensible: true },
  { una: "12345/00044/2026", groupe_libelle: null, synthese: null, urgent: false, sensible: false },
];

test("ne garde que les procedures dont une perquisition porte des objets", async () => {
  const { fetchImpl } = stub(PROCS, {
    "12345/00042/2026": [{ id: 1, nb_objets: 3 }, { id: 2, nb_objets: 0 }],
    "12345/00043/2026": [{ id: 3, nb_objets: 0 }],
    "12345/00044/2026": [],
  });
  const r = await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.equal(r.length, 1);
  assert.equal(r[0].una, "12345/00042/2026");
});

test("remonte les compteurs et les elements d'identification de la procedure", async () => {
  const { fetchImpl } = stub(PROCS, {
    "12345/00042/2026": [{ id: 1, nb_objets: 3 }, { id: 2, nb_objets: 2 }],
    "12345/00043/2026": [],
    "12345/00044/2026": [],
  });
  const [una] = await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.deepEqual(una, {
    una: "12345/00042/2026",
    groupe: "Groupe 1",
    synthese: "Cambriolages",
    urgent: true,
    sensible: false,
    nbPerquisitions: 2,
    nbObjets: 5,
  });
});

test("le nombre de perquisitions ne compte que celles portant des objets", async () => {
  const { fetchImpl } = stub(PROCS, {
    "12345/00042/2026": [{ id: 1, nb_objets: 3 }, { id: 2, nb_objets: 0 }],
    "12345/00043/2026": [],
    "12345/00044/2026": [],
  });
  const [una] = await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.equal(una.nbPerquisitions, 1);
  assert.equal(una.nbObjets, 3);
});

test("une procedure dont les perquisitions sont illisibles est ignoree, les autres passent", async () => {
  const { fetchImpl } = stub(
    PROCS,
    { "12345/00042/2026": [{ id: 1, nb_objets: 3 }], "12345/00044/2026": [] },
    { "12345/00043/2026": 500 }
  );
  const r = await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.deepEqual(r.map((u) => u.una), ["12345/00042/2026"]);
});

test("l'ordre des procedures est conserve", async () => {
  const { fetchImpl } = stub(PROCS, {
    "12345/00042/2026": [{ id: 1, nb_objets: 1 }],
    "12345/00043/2026": [{ id: 2, nb_objets: 1 }],
    "12345/00044/2026": [{ id: 3, nb_objets: 1 }],
  });
  const r = await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.deepEqual(r.map((u) => u.una), PROCS.map((p) => p.una));
});

test("la limite borne le nombre de procedures interrogees", async () => {
  const { fetchImpl, appels } = stub(PROCS, {
    "12345/00042/2026": [{ id: 1, nb_objets: 1 }],
    "12345/00043/2026": [{ id: 2, nb_objets: 1 }],
    "12345/00044/2026": [{ id: 3, nb_objets: 1 }],
  });
  await listerUnasEvaluables({ cfg: CFG, fetchImpl, limite: 2 });
  const appelsPerquisitions = appels.filter((u) => u.includes("/perquisitions"));
  assert.equal(appelsPerquisitions.length, 2);
});

test("le jeton rgp accompagne chaque appel", async () => {
  const entetes = [];
  const fetchImpl = async (url, init) => {
    entetes.push(init?.headers?.Authorization);
    if (url.includes("/procedures")) return { ok: true, json: async () => ({ data: [PROCS[0]] }) };
    return { ok: true, json: async () => ({ data: [{ id: 1, nb_objets: 1 }] }) };
  };
  await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.ok(entetes.length >= 2);
  assert.ok(entetes.every((e) => e === "Bearer jeton"));
});

test("procedures illisibles au premier appel -> erreur explicite", async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, json: async () => ({}) });
  await assert.rejects(listerUnasEvaluables({ cfg: CFG, fetchImpl }), /UNAS_UPSTREAM/);
});
