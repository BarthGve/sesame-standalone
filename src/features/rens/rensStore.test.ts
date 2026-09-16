import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("rensStore", () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetModules(); vi.restoreAllMocks(); });
  afterEach(() => sessionStorage.clear());

  it("loadFiches : remplit la liste", async () => {
    vi.doMock("./rensApi", () => ({
      fetchFiches: vi.fn().mockResolvedValue({ fiches: [{ id: 1, titre: "T" }], total: 1 }),
      sendRensPrompt: vi.fn(),
    }));
    const store = await import("./rensStore");
    await store.loadFiches();
    const s = store.snapshotForTest();
    expect(s.fiches).toHaveLength(1);
    expect(s.loadingList).toBe(false);
  });

  it("runSynthese : renseigne markdown, libère pending", async () => {
    vi.doMock("./rensApi", () => ({
      fetchFiches: vi.fn(),
      sendRensPrompt: vi.fn().mockResolvedValue("## Synthèse"),
    }));
    const store = await import("./rensStore");
    store.setPrompt("synthèse du jour");
    await store.runSynthese();
    const s = store.snapshotForTest();
    expect(s.markdown).toBe("## Synthèse");
    expect(s.pending).toBe(false);
  });

  it("runSynthese : erreur mappée", async () => {
    vi.doMock("./rensApi", () => ({
      fetchFiches: vi.fn(),
      sendRensPrompt: vi.fn().mockRejectedValue(new Error("IAKA_TIMEOUT")),
    }));
    const store = await import("./rensStore");
    store.setPrompt("x");
    await store.runSynthese();
    expect(store.snapshotForTest().synthError).toMatch(/dépassé/i);
  });

  it("filtres persistés en sessionStorage", async () => {
    vi.doMock("./rensApi", () => ({ fetchFiches: vi.fn(), sendRensPrompt: vi.fn() }));
    const store = await import("./rensStore");
    store.setFilters({ ggd: "GGD 49" });
    expect(sessionStorage.getItem("rens:etat")).toContain("GGD 49");
  });
});
