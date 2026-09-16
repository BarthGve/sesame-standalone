// Auth fail-closed de rens-api (aligné cote-api / rgp-api).
// pg n'est pas installé en CI (tests microservices purs) : on mocke le Pool
// avant de charger server.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "pg") {
    return {
      Pool: class {
        query() {
          return Promise.resolve({ rows: [{ agregats: {}, total: 0 }] });
        }
      },
    };
  }
  return origRequire.apply(this, arguments);
};

process.env.API_TOKEN = "jeton-de-test";
const { createHandler } = require("./server");

function appeler(handler, url, entetes = {}) {
  let status, body;
  const res = {
    writeHead(code) { status = code; return this; },
    end(s) { body = s ? JSON.parse(s) : null; },
  };
  return Promise.resolve(handler({ url, method: "GET", headers: entetes }, res)).then(() => ({ status, body }));
}

test("/health répond sans authentification", async () => {
  const r = await appeler(createHandler(), "/health", {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { data: { ok: true } });
});

test("route métier sans Bearer → 401", async () => {
  const r = await appeler(createHandler(), "/fiches", {});
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, "unauthorized");
});

test("route métier avec mauvais Bearer → 401", async () => {
  const r = await appeler(createHandler(), "/fiches", { authorization: "Bearer faux" });
  assert.equal(r.status, 401);
});

// Faille historique : `if (TOKEN && …)` ouvrait l'API quand API_TOKEN était vide.
// On recharge le module avec TOKEN="" pour vérifier le fail-closed.
function creerHandlerSansToken() {
  const precedent = process.env.API_TOKEN;
  process.env.API_TOKEN = "";
  delete require.cache[require.resolve("./server")];
  const { createHandler: ch } = require("./server");
  process.env.API_TOKEN = precedent;
  return ch;
}

test("sans jeton configuré, toute route métier reste 401", async () => {
  const r = await appeler(
    creerHandlerSansToken()(),
    "/fiches",
    { authorization: "Bearer " }
  );
  assert.equal(r.status, 401);
});

test("sans jeton configuré, /health répond quand même", async () => {
  const r = await appeler(creerHandlerSansToken()(), "/health", {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { data: { ok: true } });
});
