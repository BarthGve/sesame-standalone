import { describe, it, expect } from "vitest";
import { computeBounds, listCategories, colorForCategory, listLayers, splitByLayer, colorForLayer } from "./geo";
import sample from "../fixtures/sample.geojson";
import type { FeatureCollection } from "./geo";

const fc = sample as FeatureCollection;

describe("geo", () => {
  it("computeBounds encadre tous les points", () => {
    const b = computeBounds(fc);
    expect(b).toEqual([[-4.763028, 45.696232], [3.33267, 48.482431]]);
  });

  it("computeBounds renvoie null si vide", () => {
    expect(computeBounds({ type: "FeatureCollection", features: [] })).toBeNull();
  });

  it("listCategories renvoie les catégories triées distinctes", () => {
    expect(listCategories(fc)).toEqual(["découverte - cadavre", "suicide"]);
  });

  it("colorForCategory est stable et distinct", () => {
    const cats = listCategories(fc);
    const c1 = colorForCategory("suicide", cats);
    const c2 = colorForCategory("découverte - cadavre", cats);
    expect(c1).toMatch(/^#/);
    expect(c1).not.toEqual(c2);
    expect(colorForCategory("suicide", cats)).toEqual(c1);
  });
});

const fcLayers = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [2, 48] }, properties: { _layer: "eoliennes" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [3, 49] }, properties: { _layer: "interv" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [3, 49] }, properties: { _layer: "eoliennes" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [1, 47] }, properties: {} },
  ],
} as any;

describe("_layer helpers", () => {
  it("listLayers renvoie les couches dans l'ordre d'apparition", () => {
    expect(listLayers(fcLayers)).toEqual(["eoliennes", "interv"]);
  });
  it("splitByLayer groupe par _layer, clé '_' si absent", () => {
    const g = splitByLayer(fcLayers);
    expect(g.eoliennes).toHaveLength(2);
    expect(g.interv).toHaveLength(1);
    expect(g._).toHaveLength(1);
  });
  it("colorForLayer est stable par nom, indépendant de l'ordre/liste", () => {
    // Couleur dérivée du NOM : même nom → même couleur, quelle que soit la liste
    // passée (2ᵉ argument ignoré). Deux noms distincts donnent (ici) deux couleurs.
    expect(colorForLayer("eoliennes", ["eoliennes", "interv"])).toBe(colorForLayer("eoliennes"));
    expect(colorForLayer("barrage", ["barrage"])).toBe(colorForLayer("barrage", ["eoliennes", "barrage"]));
    expect(colorForLayer("eoliennes")).not.toBe(colorForLayer("interv"));
  });
});
