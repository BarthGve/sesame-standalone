import { test } from "node:test";
import assert from "node:assert/strict";
import { probeIaka } from "./ready.mjs";

test("probeIaka : HTTP ok → reachable", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200 });
  const out = await probeIaka({ baseUrl: "http://iaka:1" }, fetchImpl);
  assert.equal(out.reachable, true);
});

test("probeIaka : fetch throw → reachable false", async () => {
  const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
  const out = await probeIaka({ baseUrl: "http://iaka:1" }, fetchImpl);
  assert.equal(out.reachable, false);
});

test("probeIaka : baseUrl vide → reachable false sans fetch", async () => {
  let n = 0;
  const fetchImpl = async () => { n++; };
  const out = await probeIaka({ baseUrl: "" }, fetchImpl);
  assert.equal(out.reachable, false);
  assert.equal(n, 0);
});
