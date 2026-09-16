import { test } from "node:test";
import assert from "node:assert/strict";
import { searchAdresses } from "./adresses.mjs";

test("q < 3 → [] sans fetch", async () => {
  let n = 0;
  const out = await searchAdresses("ab", { banApiUrl: "http://ban" }, async () => { n++; });
  assert.deepEqual(out, []);
  assert.equal(n, 0);
});

test("BAN_API_URL vide → [] sans fetch", async () => {
  let n = 0;
  const out = await searchAdresses("rue victor", { banApiUrl: "" }, async () => { n++; });
  assert.deepEqual(out, []);
  assert.equal(n, 0);
});

test("Addok/BAN GeoJSON → suggestions", async () => {
  const fetchImpl = async (url) => {
    assert.ok(url.includes("q=rue"));
    return {
      ok: true,
      json: async () => ({
        features: [{ properties: { label: "12 Rue X, 75001 Paris", name: "12 Rue X", city: "Paris", postcode: "75001", citycode: "75101" } }],
      }),
    };
  };
  const out = await searchAdresses("rue xxxx", { banApiUrl: "http://addok:7878" }, fetchImpl);
  assert.equal(out[0].commune, "Paris");
  assert.equal(out[0].insee, "75101");
});

test("amont ko → [] (saisie libre)", async () => {
  const out = await searchAdresses("rue x", { banApiUrl: "http://addok" }, async () => ({ ok: false, status: 502 }));
  assert.deepEqual(out, []);
});
