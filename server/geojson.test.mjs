import { test } from "node:test";
import assert from "node:assert/strict";
import { extractGeoJSON } from "./geojson.mjs";

const fc = '{"type":"FeatureCollection","features":[]}';

test("parse un GeoJSON brut", () => {
  const out = extractGeoJSON(fc);
  assert.equal(out.type, "FeatureCollection");
});

test("parse un GeoJSON entouré d'un bloc de code", () => {
  const out = extractGeoJSON("```json\n" + fc + "\n```");
  assert.equal(out.type, "FeatureCollection");
});

test("parse avec texte parasite avant/après", () => {
  const out = extractGeoJSON("Voici la réponse:\n" + fc + "\nFin.");
  assert.equal(out.type, "FeatureCollection");
});

test("rejette une string non-JSON", () => {
  assert.throws(() => extractGeoJSON("pas de json ici"), /GEOJSON_INVALID/);
});

test("déballe l'enveloppe { geojson: FeatureCollection }", () => {
  const out = extractGeoJSON(JSON.stringify({ geojson: { type: "FeatureCollection", features: [] } }));
  assert.equal(out.type, "FeatureCollection");
});

test("extrait le GeoJSON d'une trace agent <tool-output>{json_build_object:FC}</tool-output>", () => {
  const fc = { type: "FeatureCollection", features: [] };
  const trace =
    '<tool>execute_sql<tool-input>{"sql":"SELECT json_build_object(...)"}</tool-input>' +
    "<tool-output>" + JSON.stringify({ json_build_object: fc }) + "</tool-output></tool>" +
    "Erreur interne dans le module Tools : ''Internal Server Error''";
  const out = extractGeoJSON(trace);
  assert.equal(out.type, "FeatureCollection");
  assert.ok(Array.isArray(out.features));
});

test("rejette un JSON qui n'est pas une FeatureCollection", () => {
  assert.throws(() => extractGeoJSON('{"type":"Point"}'), /GEOJSON_INVALID/);
});

test("rejette une FeatureCollection sans clé features", () => {
  assert.throws(() => extractGeoJSON('{"type":"FeatureCollection"}'), /GEOJSON_INVALID/);
});

test("rejette une FeatureCollection avec features null", () => {
  assert.throws(() => extractGeoJSON('{"type":"FeatureCollection","features":null}'), /GEOJSON_INVALID/);
});

test("rejette une FeatureCollection avec features objet (non-array)", () => {
  assert.throws(() => extractGeoJSON('{"type":"FeatureCollection","features":{}}'), /GEOJSON_INVALID/);
});

test("extractGeoJSON — FeatureCollection propre entre ```json préserve meta", () => {
  const out = "```json\n" + JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [2, 48] }, properties: { _layer: "eoliennes" } }],
    meta: { layers: [{ id: "eoliennes", label: "Éoliennes", count: 1 }], coverage_note: "Grand Est" },
  }) + "\n```";
  const fc = extractGeoJSON(out);
  assert.equal(fc.type, "FeatureCollection");
  assert.equal(fc.features.length, 1);
  assert.equal(fc.meta.layers[0].id, "eoliennes");
});
