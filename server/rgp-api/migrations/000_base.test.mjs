import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("000_base crée una et communes", () => {
  const sql = readFileSync(new URL("./000_base.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? una\b/);
  assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? communes\b/);
});

test("seed minimal : une UNA fictive, pas d'IMEI", () => {
  const sql = readFileSync(new URL("../seed/minimal.sql", import.meta.url), "utf8");
  assert.match(sql, /12345\/1\/2026|unite.*12345/i);
  assert.doesNotMatch(sql, /\b\d{15}\b/); // pas d'IMEI 15 chiffres
});
