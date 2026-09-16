import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPersistedStore } from "./createPersistedStore";

type S = { n: number; label: string };

describe("createPersistedStore", () => {
  beforeEach(() => sessionStorage.clear());

  it("set fusionne le patch et notifie les abonnés", () => {
    const store = createPersistedStore<S>({ n: 0, label: "" });
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.get().n));
    store.set({ n: 1 });
    store.set({ label: "x" });
    expect(store.get()).toEqual({ n: 1, label: "x" });
    expect(seen).toEqual([1, 1]);
  });

  it("persiste seulement sur une clé surveillée", () => {
    const store = createPersistedStore<S>(
      { n: 0, label: "" },
      { key: "k", keys: ["n"], read: (r) => ({ n: Number(r) }), write: (s) => String(s.n) }
    );
    store.set({ label: "ignoré" });
    expect(sessionStorage.getItem("k")).toBeNull(); // label non surveillé → pas d'écriture
    store.set({ n: 7 });
    expect(sessionStorage.getItem("k")).toBe("7");
  });

  it("write renvoyant null retire la clé", () => {
    const store = createPersistedStore<S>(
      { n: 0, label: "" },
      { key: "k", keys: ["n"], read: (r) => ({ n: Number(r) }), write: (s) => (s.n ? String(s.n) : null) }
    );
    store.set({ n: 5 });
    expect(sessionStorage.getItem("k")).toBe("5");
    store.set({ n: 0 });
    expect(sessionStorage.getItem("k")).toBeNull();
  });

  it("réhydrate l'état initial depuis le stockage", () => {
    sessionStorage.setItem("k", "42");
    const store = createPersistedStore<S>(
      { n: 0, label: "def" },
      { key: "k", keys: ["n"], read: (r) => ({ n: Number(r) }), write: (s) => String(s.n) }
    );
    expect(store.get()).toEqual({ n: 42, label: "def" });
  });

  it("stockage indisponible → set ne jette pas", () => {
    const store = createPersistedStore<S>(
      { n: 0, label: "" },
      { key: "k", keys: ["n"], read: (r) => ({ n: Number(r) }), write: (s) => String(s.n) }
    );
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => store.set({ n: 1 })).not.toThrow();
    expect(store.get().n).toBe(1);
    spy.mockRestore();
  });

  it("subscribe renvoie un désabonnement", () => {
    const store = createPersistedStore<S>({ n: 0, label: "" });
    let hits = 0;
    const off = store.subscribe(() => hits++);
    store.set({ n: 1 });
    off();
    store.set({ n: 2 });
    expect(hits).toBe(1);
  });
});
