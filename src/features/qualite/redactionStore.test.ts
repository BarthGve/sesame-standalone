import { describe, it, expect, beforeEach } from "vitest";
import {
  modifierBrouillon, reinitialiserBrouillon, snapshotBrouillon, BROUILLON_VIDE,
} from "./redactionStore";

describe("redactionStore", () => {
  beforeEach(() => {
    sessionStorage.clear();
    reinitialiserBrouillon();
  });

  it("persiste un brouillon partiel en sessionStorage", () => {
    modifierBrouillon({ titre: "Rodéos", texte: "Faits constatés le 3 août." });
    const s = snapshotBrouillon();
    expect(s.titre).toBe("Rodéos");
    expect(s.texte).toContain("Faits");
    const raw = sessionStorage.getItem("frs:brouillon");
    expect(raw).toContain("Rodéos");
  });

  it("ne persiste pas un brouillon entièrement vide", () => {
    modifierBrouillon({ titre: "X" });
    reinitialiserBrouillon();
    expect(snapshotBrouillon()).toEqual(BROUILLON_VIDE);
    expect(sessionStorage.getItem("frs:brouillon")).toBeNull();
  });

  it("borne titre et texte aux plafonds de rédaction", () => {
    modifierBrouillon({ titre: "T".repeat(300), texte: "x".repeat(10000) });
    const s = snapshotBrouillon();
    expect(s.titre.length).toBe(200);
    expect(s.texte.length).toBe(8000);
  });

  it("fusionne les champs sans écraser le reste", () => {
    modifierBrouillon({ titre: "A", code_ggd: "GGD 49" });
    modifierBrouillon({ unite: "COB Angers" });
    const s = snapshotBrouillon();
    expect(s.titre).toBe("A");
    expect(s.code_ggd).toBe("GGD 49");
    expect(s.unite).toBe("COB Angers");
  });
});
