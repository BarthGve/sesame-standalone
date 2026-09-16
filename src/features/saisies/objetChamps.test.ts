import { describe, it, expect } from "vitest";
import { recomputeChamps, buildDraftFrom } from "./objetChamps";
import type { Champ, IdentificationResult } from "./types";

describe("recomputeChamps", () => {
  it("reconstruit les champs de la nouvelle catégorie en conservant les valeurs par cle", () => {
    const prev: Champ[] = [
      { cle: "nature", libelle: "Nature", valeur: "Montre", source: "deduit", obligatoire: true },
      { cle: "marque", libelle: "Marque", valeur: "Rolex", source: "deduit", obligatoire: false },
      { cle: "titre", libelle: "Titre", valeur: "750", source: "deduit", obligatoire: false },
    ];
    // HORLOGERIE a: nature, marque, modele, numero, quantite, inscriptions, description, titre, matiere, artiste
    const out = recomputeChamps(prev, "HORLOGERIE");
    const nature = out.find((c) => c.cle === "nature");
    const titre = out.find((c) => c.cle === "titre");
    expect(nature?.valeur).toBe("Montre");     // valeur conservée
    expect(titre?.valeur).toBe("750");         // valeur conservée
    // un champ non présent avant est vide + a_completer
    const matiere = out.find((c) => c.cle === "matiere");
    expect(matiere?.valeur).toBe(null);
    expect(matiere?.source).toBe("a_completer");
  });

  it("marque source=deduit si valeur conservée non vide, a_completer sinon", () => {
    const prev: Champ[] = [{ cle: "nature", libelle: "Nature", valeur: "", source: "a_completer", obligatoire: true }];
    const out = recomputeChamps(prev, "DIVERS");
    const nature = out.find((c) => c.cle === "nature");
    expect(nature?.source).toBe("a_completer"); // valeur vide -> a_completer
  });
});

describe("buildDraftFrom", () => {
  it("construit un ObjetSaisi depuis un résultat d'identification", () => {
    const res: IdentificationResult = {
      categorie: "MULTIMEDIA", confiance: 0.9,
      champs: [{ cle: "imei", libelle: "IMEI", valeur: "123", source: "deduit", obligatoire: false }],
    };
    const o = buildDraftFrom(res, "obj_1");
    expect(o.id).toBe("obj_1");
    expect(o.categorie).toBe("MULTIMEDIA");
    expect(o.numeroScelle).toBe("");
    expect(o.situation).toBe("SAISI_SOUS_SCELLE");
    expect(o.lieu).toBe("");
    expect(o.champs[0].cle).toBe("imei");
  });
});
