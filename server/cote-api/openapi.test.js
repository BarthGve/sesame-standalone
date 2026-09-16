const { test } = require("node:test");
const assert = require("node:assert/strict");
const spec = require("./openapi.json");

process.env.API_TOKEN = "jeton-de-test";
const { createHandler } = require("./server");
const { coter } = require("./cote");

// Réponse factice : capture le code HTTP et le corps JSON (repris de server.test.js).
function reponse() {
  return {
    code: 0,
    entetes: null,
    corps: null,
    writeHead(code, entetes) { this.code = code; this.entetes = entetes; },
    end(texte) { this.corps = JSON.parse(texte); },
  };
}

test("servers pointe vers le DNS Docker cote-api", () => {
  assert.equal(spec.servers[0].url, "http://cote-api:8082");
});

test("le contrat decrit la route /cote en GET", () => {
  assert.ok(spec.paths["/cote"].get);
  assert.equal(spec.paths["/cote"].get.operationId, "getCote");
});

test("les parametres obligatoires sont declares obligatoires", () => {
  const params = spec.paths["/cote"].get.parameters;
  const obligatoires = params.filter((p) => p.required).map((p) => p.name).sort();
  assert.deepEqual(obligatoires, ["annee", "marque", "modele"]);
});

test("les parametres optionnels km et carrosserie sont declares", () => {
  const noms = spec.paths["/cote"].get.parameters.map((p) => p.name);
  assert.ok(noms.includes("km"));
  assert.ok(noms.includes("carrosserie"));
});

test("le champ correspondance est enumere et explique — c'est lui qui pilote la reprise de l'agent", () => {
  const champ = spec.components.schemas.Cote.properties.correspondance;
  assert.deepEqual(champ.enum, ["exacte", "approchante", "repli_segment"]);
  assert.match(champ.description, /repli|retent|reformul/i);
});

test("le schema de reponse porte fourchette, annonces et avertissement", () => {
  const props = spec.components.schemas.Cote.properties;
  for (const cle of ["reference", "fourchette", "annonces", "correspondance", "methode", "avertissement"]) {
    assert.ok(props[cle], `champ ${cle} manquant`);
  }
});

test("la description previent que les donnees sont simulees", () => {
  assert.match(spec.info.description, /simul/i);
});

// À partir d'ici, les tests confrontent le contrat au comportement réel du
// service (createHandler, coter) : ils échouent si le code change sans le
// contrat, ou l'inverse.

test("les parametres obligatoires du contrat sont bien ceux que le serveur exige", () => {
  const obligatoires = spec.paths["/cote"].get.parameters.filter((p) => p.required);
  for (const p of obligatoires) {
    const q = new URLSearchParams({ marque: "RENAULT", modele: "CLIO", annee: "2018" });
    q.delete(p.name);
    const res = reponse();
    createHandler()(
      { url: `/cote?${q}`, method: "GET", headers: { authorization: "Bearer jeton-de-test" } },
      res
    );
    assert.equal(res.code, 400, `${p.name} declare obligatoire mais accepte absent`);
  }
});

test("l'enum correspondance est exactement l'ensemble des valeurs que le code peut produire", () => {
  const enumere = spec.components.schemas.Cote.properties.correspondance.enum;
  const produites = new Set([
    coter({ marque: "RENAULT", modele: "CLIO", annee: 2018 }).correspondance, // exacte
    coter({ marque: "RENAULT", modele: "CLIO 1.2", annee: 2018 }).correspondance, // approchante
    coter({ marque: "FANTOME", modele: "FANTOME", annee: 2018 }).correspondance, // repli_segment
  ]);
  assert.deepEqual([...produites].sort(), [...enumere].sort());
});

test("le schema Cote decrit toutes les cles reellement renvoyees", () => {
  const reel = Object.keys(coter({ marque: "RENAULT", modele: "CLIO", annee: 2018 }));
  const decrites = Object.keys(spec.components.schemas.Cote.properties);
  assert.deepEqual(reel.sort(), decrites.sort());
});
