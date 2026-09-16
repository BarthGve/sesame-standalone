import { describe, it, expect } from "vitest";
import { formatDateFr } from "./dates";

describe("formatDateFr", () => {
  it("date ISO complète → jj/mm/aaaa", () => {
    expect(formatDateFr("2012-12-01")).toBe("01/12/2012");
  });

  it("mois seul → mm/aaaa, année seule → aaaa", () => {
    expect(formatDateFr("2012-12")).toBe("12/2012");
    expect(formatDateFr("2012")).toBe("2012");
  });

  it("toute autre forme est rendue telle quelle, jamais mutilée", () => {
    // Le MAP peut produire une date partielle ou inattendue : mieux vaut l'afficher
    // brute qu'un "undefined/undefined/2012".
    expect(formatDateFr("vers 2012")).toBe("vers 2012");
    expect(formatDateFr("")).toBe("");
    expect(formatDateFr("2012-13-45")).toBe("2012-13-45");
  });
});
