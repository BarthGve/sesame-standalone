import { describe, it, expect, beforeEach, vi } from "vitest";

// Le store persiste via sessionStorage (voir lib/createPersistedStore.ts).
beforeEach(() => { sessionStorage.clear(); vi.resetModules(); });

describe("carteStore — visibilité par couche", () => {
  it("toggle bascule la visibilité d'une couche", async () => {
    const { toggle } = await import("./carteStore");
    // simulate a store snapshot read via getState is internal; on teste toggle via le store
    toggle("eoliennes");
    // après un premier toggle sur couche par défaut visible -> masquée
    // (lecture via le hook n'est pas dispo hors composant ; on vérifie la persistance)
    expect(JSON.parse(sessionStorage.getItem("carte:etat") || "{}").show?.eoliennes).toBe(false);
    toggle("eoliennes");
    expect(JSON.parse(sessionStorage.getItem("carte:etat") || "{}").show?.eoliennes).toBe(true);
  });

  it("visibleLayers rend visibles par défaut les couches inconnues", async () => {
    const { visibleLayers } = await import("./carteStore");
    const data = { type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [2,48] }, properties: { _layer: "eoliennes" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [3,49] }, properties: { _layer: "interv" } },
    ] } as any;
    expect(visibleLayers(data, { interv: false })).toEqual({ eoliennes: true, interv: false });
  });
});
