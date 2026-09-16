import { describe, it, expect } from "vitest";
import { formatPvDate, situationLabel, objetEntete, objetChamps, groupByLieu, PLACEHOLDER } from "./pv";
import type { ApiObjet } from "./perquisitionApi";

describe("formatPvDate", () => {
  it("formate une date ISO en français", () => {
    const d = formatPvDate("2026-02-12T15:45:00");
    expect(d.courte).toBe("12 février 2026");
    expect(d.heure).toBe("15 heures 45 minutes");
    expect(d.longue).toBe("jeudi 12 février 2026"); // jour + date, sans article
    expect(d.longue.startsWith("le ")).toBe(false); // l'article vient du gabarit ("Le {longue}")
  });
  it("renvoie des placeholders si absent/invalide", () => {
    expect(formatPvDate(undefined).courte).toBe(PLACEHOLDER);
    expect(formatPvDate("pas une date").heure).toBe(PLACEHOLDER);
  });
});

describe("situationLabel", () => {
  it("mappe les situations", () => {
    expect(situationLabel("SAISI_SOUS_SCELLE")).toBe("Saisi sous scellé");
    expect(situationLabel("SAISI_NON_SCELLE")).toBe("Saisi non scellé");
    expect(situationLabel(null)).toBe("Saisi");
  });
});

describe("objetEntete", () => {
  it("rend « Catégorie · situation »", () => {
    const o = { id: 1, categorie: "ARME", situation: "SAISI_SOUS_SCELLE", lieu: "Garage", champs: [], identifiants: [] } as ApiObjet;
    expect(objetEntete(o)).toBe("Arme · Saisi sous scellé");
  });
});

describe("objetChamps", () => {
  it("liste les champs à valeur non vide (libellé/valeur)", () => {
    const o = {
      id: 1, categorie: "ARME", situation: "SAISI_SOUS_SCELLE", lieu: "Garage",
      champs: [
        { cle: "nature", libelle: "Nature", valeur: "ARME A FEU", source: "deduit", obligatoire: true },
        { cle: "marque", libelle: "Marque", valeur: "", source: "a_completer", obligatoire: false },
        { cle: "calibre", libelle: "Calibre", valeur: "9MM", source: "deduit", obligatoire: true },
      ],
      identifiants: [],
    } as ApiObjet;
    const champs = objetChamps(o);
    expect(champs).toEqual([
      { libelle: "Nature", valeur: "ARME A FEU" },
      { libelle: "Calibre", valeur: "9MM" }, // Marque (vide) filtrée
    ]);
  });
  it("ajoute le sous-type transport en tête", () => {
    const o = { id: 2, categorie: "TRANSPORT", sous_type: "VEHICULE_TERRESTRE", situation: "SAISI_NON_SCELLE", lieu: "", champs: [], identifiants: [] } as ApiObjet;
    expect(objetChamps(o)[0]).toEqual({ libelle: "Type de moyen", valeur: "Véhicule terrestre" });
  });
});

describe("groupByLieu", () => {
  it("regroupe par lieu dans l'ordre d'apparition, vide -> Lieu non précisé", () => {
    const objets = [
      { id: 1, categorie: "ARME", lieu: "Garage", champs: [], identifiants: [] },
      { id: 2, categorie: "BIJOU", lieu: "", champs: [], identifiants: [] },
      { id: 3, categorie: "DROGUE", lieu: "Garage", champs: [], identifiants: [] },
    ] as ApiObjet[];
    const g = groupByLieu(objets);
    expect(g.map((x) => x.lieu)).toEqual(["Garage", "Lieu non précisé"]);
    expect(g[0].objets.length).toBe(2);
  });
});
