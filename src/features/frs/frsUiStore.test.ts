import { describe, it, expect, beforeEach } from "vitest";
import {
  estOngletFrs, setOnglet, setContexte, setFocusFrs, naviguerVersFiche, snapshotFrsUi,
} from "./frsUiStore";

describe("frsUiStore", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setOnglet("flux");
    setContexte({ jour: null, ggd: "" });
    setFocusFrs(null);
  });

  it("estOngletFrs accepte les cinq gestes", () => {
    expect(estOngletFrs("flux")).toBe(true);
    expect(estOngletFrs("rediger")).toBe(true);
    expect(estOngletFrs("inconnu")).toBe(false);
  });

  it("persiste onglet, jour et ggd", () => {
    setOnglet("controle");
    setContexte({ jour: "2026-08-07", ggd: "GGD 49" });
    const s = snapshotFrsUi();
    expect(s.onglet).toBe("controle");
    expect(s.jour).toBe("2026-08-07");
    expect(s.ggd).toBe("GGD 49");
    expect(sessionStorage.getItem("frs:ui")).toContain("2026-08-07");
  });

  it("refuse une date mal formée", () => {
    setContexte({ jour: "07/08/2026" });
    expect(snapshotFrsUi().jour).toBeNull();
  });

  it("naviguerVersFiche pose onglet, focus et contexte", () => {
    naviguerVersFiche({
      onglet: "controle",
      frsId: 26305,
      jour: "2026-08-07",
      ggd: "GGD 52",
    });
    const s = snapshotFrsUi();
    expect(s.onglet).toBe("controle");
    expect(s.focusFrsId).toBe(26305);
    expect(s.jour).toBe("2026-08-07");
    expect(s.ggd).toBe("GGD 52");
    // focusFrsId n'est pas persisté
    expect(sessionStorage.getItem("frs:ui")).not.toContain("26305");
  });
});
