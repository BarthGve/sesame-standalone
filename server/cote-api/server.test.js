const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_TOKEN = "jeton-de-test";
const { createHandler } = require("./server");

// Réponse factice : capture le code HTTP et le corps JSON.
function reponse() {
  return {
    code: 0,
    entetes: null,
    corps: null,
    writeHead(code, entetes) { this.code = code; this.entetes = entetes; },
    end(texte) { this.corps = JSON.parse(texte); },
  };
}

function appeler(url, entetes = { authorization: "Bearer jeton-de-test" }) {
  const res = reponse();
  createHandler()({ url, method: "GET", headers: entetes }, res);
  return res;
}

test("/health repond sans authentification", () => {
  const res = appeler("/health", {});
  assert.equal(res.code, 200);
  assert.equal(res.corps.data.ok, true);
});

test("sans jeton, /cote est refuse", () => {
  const res = appeler("/cote?marque=RENAULT&modele=CLIO&annee=2018", {});
  assert.equal(res.code, 401);
  assert.equal(res.corps.error.code, "unauthorized");
});

test("avec un mauvais jeton, /cote est refuse", () => {
  const res = appeler("/cote?marque=RENAULT&modele=CLIO&annee=2018", { authorization: "Bearer faux" });
  assert.equal(res.code, 401);
});

test("une cote complete renvoie fourchette, annonces et correspondance", () => {
  const res = appeler("/cote?marque=RENAULT&modele=CLIO&annee=2018&km=90000");
  assert.equal(res.code, 200);
  assert.equal(res.corps.data.correspondance, "exacte");
  assert.ok(res.corps.data.fourchette.moyen > 0);
  assert.ok(res.corps.data.annonces.length >= 3);
});

test("marque, modele ou annee manquants renvoient 400", () => {
  for (const url of [
    "/cote?modele=CLIO&annee=2018",
    "/cote?marque=RENAULT&annee=2018",
    "/cote?marque=RENAULT&modele=CLIO",
  ]) {
    const res = appeler(url);
    assert.equal(res.code, 400, url);
    assert.equal(res.corps.error.code, "bad_request");
  }
});

test("une annee non numerique renvoie 400", () => {
  const res = appeler("/cote?marque=RENAULT&modele=CLIO&annee=abcd");
  assert.equal(res.code, 400);
});

test("un chemin inconnu renvoie 404", () => {
  const res = appeler("/inconnu");
  assert.equal(res.code, 404);
});

test("le modele inconnu passe en repli, sans erreur HTTP", () => {
  const res = appeler("/cote?marque=FANTOME&modele=FANTOME&annee=2018");
  assert.equal(res.code, 200);
  assert.equal(res.corps.data.correspondance, "repli_segment");
});

// Faille : quand API_TOKEN vaut "", la comparaison "Bearer " + TOKEN devient
// "Bearer " et un en-tête Authorization: Bearer  (jeton vide) passe l'authentification.
// Le garde fail-closed au démarrage ne protège pas ce cas car il ne s'exécute
// que sous require.main === module (pas quand le module est simplement require()).
function rechargerServeurSansToken() {
  const precedent = process.env.API_TOKEN;
  process.env.API_TOKEN = "";
  delete require.cache[require.resolve("./server")];
  const { createHandler } = require("./server");
  process.env.API_TOKEN = precedent;
  return createHandler;
}

test("sans jeton configure, un Authorization: Bearer vide est refuse", () => {
  const creerHandlerSansToken = rechargerServeurSansToken();
  const res = reponse();
  creerHandlerSansToken()(
    { url: "/cote?marque=RENAULT&modele=CLIO&annee=2018", method: "GET", headers: { authorization: "Bearer " } },
    res
  );
  assert.equal(res.code, 401);
  assert.equal(res.corps.error.code, "unauthorized");
});

test("sans jeton configure, une requete sans en-tete est refusee", () => {
  const creerHandlerSansToken = rechargerServeurSansToken();
  const res = reponse();
  creerHandlerSansToken()(
    { url: "/cote?marque=RENAULT&modele=CLIO&annee=2018", method: "GET", headers: {} },
    res
  );
  assert.equal(res.code, 401);
  assert.equal(res.corps.error.code, "unauthorized");
});

test("sans jeton configure, /health repond quand meme", () => {
  const creerHandlerSansToken = rechargerServeurSansToken();
  const res = reponse();
  creerHandlerSansToken()({ url: "/health", method: "GET", headers: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(res.corps.data.ok, true);
});
