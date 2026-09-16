import { describe, it, expect } from "vitest";
import { filtrerParFile, page, nombrePages, PAR_PAGE } from "./qualiteStore";

import type { FicheLigne } from "./qualiteApi";

const f = (frs_id: number, gravite_max: FicheLigne["gravite_max"]): FicheLigne => ({
  frs_id, titre: "T", unite: "COB X", code_ggd: "GGD 49", commune: "C",
  date_redaction: "2026-08-04", n_ecarts: 1, criteres: ["A1"], gravite_max,
});

describe("filtrerParFile", () => {
  const lot = [f(1, "bloquant"), f(2, "majeur"), f(3, "mineur"), f(4, "bloquant")];

  it("« à supprimer » ne contient que les bloquants", () => {
    expect(filtrerParFile(lot, "supprimer").map((x) => x.frs_id)).toEqual([1, 4]);
  });

  it("« à corriger » exclut les fiches déjà bloquantes, pour ne pas les traiter deux fois", () => {
    expect(filtrerParFile(lot, "corriger").map((x) => x.frs_id)).toEqual([2]);
  });

  it("« à surveiller » ne garde que les fiches sans écart plus grave", () => {
    expect(filtrerParFile(lot, "surveiller").map((x) => x.frs_id)).toEqual([3]);
  });

  it("les trois files partitionnent le lot : aucune fiche perdue, aucune comptée deux fois", () => {
    const total = (["supprimer", "corriger", "surveiller"] as const)
      .flatMap((file) => filtrerParFile(lot, file).map((x) => x.frs_id));
    expect(total.sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("file « toutes »", () => {
  const lot = [f(1, "bloquant"), f(2, "majeur"), f(3, "mineur"), f(4, "bloquant")];

  it("rend le lot entier, dans l'ordre reçu", () => {
    expect(filtrerParFile(lot, "toutes").map((x) => x.frs_id)).toEqual([1, 2, 3, 4]);
  });

  it("les trois files spécialisées partitionnent toujours ce que « toutes » contient", () => {
    const parties = (["supprimer", "corriger", "surveiller"] as const)
      .flatMap((file) => filtrerParFile(lot, file).map((x) => x.frs_id));
    expect(parties.sort()).toEqual(filtrerParFile(lot, "toutes").map((x) => x.frs_id).sort());
  });
});

describe("pagination", () => {
  const lot = Array.from({ length: 57 }, (_, i) => f(i + 1, "majeur"));

  it("découpe en pages de 25 et rend la dernière page incomplète", () => {
    expect(page(lot, 0).length).toBe(25);
    expect(page(lot, 2).length).toBe(7);
    expect(page(lot, 2)[0].frs_id).toBe(51);
  });

  it("une page au-delà du dernier rang est vide, pas une erreur", () => {
    expect(page(lot, 9)).toEqual([]);
  });

  it("la taille de page est celle que la vue applique", () => {
    expect(PAR_PAGE).toBe(25);
  });

  it("nombrePages : au moins une page, même sans fiche", () => {
    expect(nombrePages(0)).toBe(1);
    expect(nombrePages(57)).toBe(3);
    expect(nombrePages(25)).toBe(1);
  });
});
