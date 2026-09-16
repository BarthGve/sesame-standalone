import { describe, it, expect } from "vitest";
import { formatCote } from "./cotes";

describe("formatCote", () => {
  it("cote LRPGN complète → date et type lisibles, sans le nom", () => {
    // Le nom et le role figurent deja sur la fiche de la personne : les repeter
    // dans la cote noie l'information utile, qui est la date et la nature de l'acte.
    expect(formatCote("20260210_1645_PVGardeAVue_MEC_FERREIRA_ANTHONY"))
      .toEqual({ date: "10/02/2026", libelle: "Garde à vue" });
  });

  it("type connu traduit, type inconnu rendu tel quel", () => {
    expect(formatCote("20260210_0930_PVPlainte_VIC_X_Y").libelle).toBe("Plainte");
    expect(formatCote("20260210_1105_PVAudition_TEM_X_Y").libelle).toBe("Audition");
    // Jamais de traduction inventee : un type non releve reste affiche brut.
    expect(formatCote("20260210_0700_PVTransportConstatations").libelle).toBe("PVTransportConstatations");
  });

  it("cote sans date → libellé brut, pas de date", () => {
    expect(formatCote("BORDEREAU_D_ENVOI_JUDICIAIRE"))
      .toEqual({ date: null, libelle: "BORDEREAU_D_ENVOI_JUDICIAIRE" });
    expect(formatCote("01_Synthese")).toEqual({ date: null, libelle: "01_Synthese" });
  });

  it("chaîne vide → libellé vide, jamais une exception", () => {
    expect(formatCote("")).toEqual({ date: null, libelle: "" });
  });
});
