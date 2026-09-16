import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Le store lit sessionStorage à l'import → on réimporte le module frais dans
// chaque test (vi.resetModules) après avoir préparé le stockage.
describe("rgpStore", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
    vi.restoreAllMocks();
  });
  afterEach(() => sessionStorage.clear());

  it("send : ajoute l'échange, résout la réponse, libère le pending", async () => {
    vi.doMock("./rgpApi", () => ({
      sendRgpPrompt: vi.fn().mockResolvedValue({ text: "", message: "ok", parsed: null }),
    }));
    const store = await import("./rgpStore");
    await store.send("bonjour");
    const s = store.snapshotForTest();
    expect(s.echanges).toHaveLength(1);
    expect(s.echanges[0].reply?.message).toBe("ok");
    expect(s.pendingId).toBeNull();
  });

  it("send : un seul traitement à la fois (2e appel ignoré tant que pending)", async () => {
    let resolve!: (v: unknown) => void;
    const send1 = new Promise((r) => (resolve = r));
    const spy = vi.fn().mockReturnValueOnce(send1);
    vi.doMock("./rgpApi", () => ({ sendRgpPrompt: spy }));
    const store = await import("./rgpStore");
    const p = store.send("un");
    store.send("deux"); // ignoré : pending
    expect(store.snapshotForTest().echanges).toHaveLength(1);
    resolve({ text: "", message: "ok", parsed: null });
    await p;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("clear : vide la conversation et le stockage", async () => {
    vi.doMock("./rgpApi", () => ({
      sendRgpPrompt: vi.fn().mockResolvedValue({ text: "", message: "ok", parsed: null }),
    }));
    const store = await import("./rgpStore");
    await store.send("x");
    store.clear();
    expect(store.snapshotForTest().echanges).toHaveLength(0);
    expect(sessionStorage.getItem("rgp:conversation")).toContain('"echanges":[]');
  });

  it("reload : un échange resté 'en cours' est marqué interrompu", async () => {
    sessionStorage.setItem(
      "rgp:conversation",
      JSON.stringify({ echanges: [{ id: 1, prompt: "en vol" }], draft: "" })
    );
    vi.doMock("./rgpApi", () => ({ sendRgpPrompt: vi.fn() }));
    const store = await import("./rgpStore");
    const s = store.snapshotForTest();
    expect(s.echanges[0].error).toMatch(/interrompu/i);
    expect(s.pendingId).toBeNull();
  });
});
