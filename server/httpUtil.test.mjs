import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readBody,
  checkBffAccess,
  writeJson,
  ERROR_STATUS,
} from "./httpUtil.mjs";

test("ERROR_STATUS mappe BODY_TOO_LARGE → 413", () => {
  assert.equal(ERROR_STATUS.BODY_TOO_LARGE, 413);
});

test("readBody rejette BODY_TOO_LARGE au-delà de maxBytes", async () => {
  const chunks = ["aaaa", "bbbb"]; // 8 octets
  const req = {
    on(ev, cb) {
      if (ev === "data") {
        for (const c of chunks) cb(c);
      }
      if (ev === "end") cb();
    },
    destroy() {},
  };
  await assert.rejects(() => readBody(req, 5), { message: "BODY_TOO_LARGE" });
});

test("readBody accepte un corps sous la limite", async () => {
  const req = {
    on(ev, cb) {
      if (ev === "data") cb("ok");
      if (ev === "end") cb();
    },
  };
  assert.equal(await readBody(req, 100), "ok");
});

test("checkBffAccess : sans config, /api ouvert", () => {
  assert.equal(
    checkBffAccess({ headers: {} }, new URL("http://x/api/query"), {}),
    null,
  );
});

test("checkBffAccess : BFF_API_TOKEN exige Bearer", () => {
  const cfg = { bffApiToken: "secret" };
  assert.equal(
    checkBffAccess({ headers: {} }, new URL("http://x/api/query"), cfg),
    "UNAUTHORIZED",
  );
  assert.equal(
    checkBffAccess(
      { headers: { authorization: "Bearer secret" } },
      new URL("http://x/api/query"),
      cfg,
    ),
    null,
  );
  // Static / health hors /api → pas de contrôle
  assert.equal(
    checkBffAccess({ headers: {} }, new URL("http://x/health"), cfg),
    null,
  );
});

test("checkBffAccess : REQUIRE_CF_ACCESS exige l'en-tête CF", () => {
  const cfg = { requireCfAccess: true };
  assert.equal(
    checkBffAccess({ headers: {} }, new URL("http://x/api/rens/fiches"), cfg),
    "UNAUTHORIZED",
  );
  assert.equal(
    checkBffAccess(
      { headers: { "cf-access-jwt-assertion": "jwt…" } },
      new URL("http://x/api/rens/fiches"),
      cfg,
    ),
    null,
  );
});

test("writeJson pose Content-Type application/json", () => {
  let code, headers, body;
  const res = {
    headersSent: false,
    writeHead(c, h) { code = c; headers = h; },
    end(b) { body = b; },
  };
  writeJson(res, 200, { data: { ok: true } });
  assert.equal(code, 200);
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(body), { data: { ok: true } });
});
