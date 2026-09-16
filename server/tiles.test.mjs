import { test } from "node:test";
import assert from "node:assert/strict";
import { tilesUpstreamUrl } from "./tiles.mjs";

test("entiers valides substitués", () => {
  assert.equal(
    tilesUpstreamUrl("http://t/{z}/{x}/{y}.png", "2", "1", "0"),
    "http://t/2/1/0.png"
  );
});

test("non entier → null (pas de SSRF path)", () => {
  assert.equal(tilesUpstreamUrl("http://t/{z}/{x}/{y}", "../", "1", "1"), null);
  assert.equal(tilesUpstreamUrl("http://t/{z}/{x}/{y}", "1", "x", "1"), null);
});

test("template vide → null", () => {
  assert.equal(tilesUpstreamUrl("", "1", "1", "1"), null);
});
