import { describe, it, expect } from "vitest";
import { groupByRole, buildForceData, evenementsToEntries, actesToEntries, ROLE_ORDER, REL_LABELS } from "./graph";
import type { Dossier } from "./arianeApi";

const dossier: Dossier = {
  affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: "2026-03-04", fin: "2026-03-06" }, nb_cotes: 2 },
  synthese: "s",
  parties: [
    { id: "p1", nom: "DUPONT", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D1" },
    { id: "p2", nom: "MERIDIA", role: "victime", aliases: [], qualite: "", premiere_cote: "D1" },
    { id: "p3", nom: "MARTIN", role: "enqueteur", aliases: [], qualite: "", premiere_cote: "D1" },
  ],
  evenements: [
    { id: "e1", date: "2026-03-06", precision: "jour", libelle: "fait tardif", cote_source: "D2", parties: ["p1"] },
    { id: "e2", date: "2026-03-04", precision: "jour", libelle: "fait initial", cote_source: "D1", parties: ["p1", "p2"] },
  ],
  actes: [
    { id: "a1", date: "2026-03-05", type: "audition", cote: "D2", libelle: "audition", redacteur: "p3", concernes: ["p1"] },
  ],
  relations: [
    { source: "p2", cible: "p1", type: "victime_de", libelle: "victime", cotes: ["D1"] },
    { source: "p1", cible: "p3", type: "entendu_par", libelle: "entendu par", cotes: ["D2"] },
  ],
};

describe("graph helpers", () => {
  it("groupByRole ordonne selon ROLE_ORDER et omet les rôles vides", () => {
    const groups = groupByRole(dossier.parties);
    expect(groups.map((g) => g.role)).toEqual(["mis_en_cause", "victime", "enqueteur"]);
    expect(groups[0].parties[0].nom).toBe("DUPONT");
    expect(ROLE_ORDER[0]).toBe("mis_en_cause");
  });

  it("buildForceData produit nœuds + liens", () => {
    const { nodes, links } = buildForceData(dossier);
    expect(nodes).toHaveLength(3);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ source: "p2", target: "p1", cotes: ["D1"] });
    expect(nodes[0]).toMatchObject({ id: "p1", nom: "DUPONT", role: "mis_en_cause" });
  });

  it("buildForceData écarte les liens vers un id de partie inconnu", () => {
    const orphelin: Dossier = { ...dossier, relations: [
      { source: "p1", cible: "pX", type: "connait", libelle: "connaît", cotes: ["D1"] },
    ] };
    expect(buildForceData(orphelin).links).toHaveLength(0);
  });

  it("réoriente un victime_de mis à l'envers (source=auteur) selon les rôles", () => {
    // p1 = mis_en_cause, p2 = victime. Le LLM a émis source=p1(auteur), cible=p2(victime)
    // avec type victime_de → flèche à contresens. On la remet victime → auteur.
    const inverse: Dossier = { ...dossier, relations: [
      { source: "p1", cible: "p2", type: "victime_de", libelle: "victime", cotes: ["D1"] },
    ] };
    const link = buildForceData(inverse).links[0];
    expect(link).toMatchObject({ source: "p2", target: "p1", label: "victime de" });
  });

  it("ne touche pas un victime_de déjà dans le bon sens", () => {
    const bon: Dossier = { ...dossier, relations: [
      { source: "p2", cible: "p1", type: "victime_de", libelle: "victime", cotes: ["D1"] },
    ] };
    expect(buildForceData(bon).links[0]).toMatchObject({ source: "p2", target: "p1" });
  });

  it("ne réoriente pas un type symétrique (connait)", () => {
    const sym: Dossier = { ...dossier, relations: [
      { source: "p1", cible: "p2", type: "connait", libelle: "connaît", cotes: ["D1"] },
    ] };
    expect(buildForceData(sym).links[0]).toMatchObject({ source: "p1", target: "p2" });
  });

  it("auteur_victime a un libellé et n'apparaît pas comme type brut sur le lien", () => {
    expect(REL_LABELS.auteur_victime).toBe("auteur sur victime");
    const avecAuteur: Dossier = { ...dossier, relations: [
      { source: "p1", cible: "p2", type: "auteur_victime", libelle: "a commis des actes sexuels sur", cotes: ["D1"] },
    ] };
    const link = buildForceData(avecAuteur).links[0];
    // La direction n'est pas inversée : l'auteur reste la source du lien.
    expect(link).toMatchObject({ source: "p1", target: "p2", label: "auteur sur victime" });
  });

  it("evenementsToEntries triées par date (cote_source)", () => {
    const entries = evenementsToEntries(dossier);
    expect(entries.map((e) => e.libelle)).toEqual(["fait initial", "fait tardif"]);
    expect(entries[0].cote).toBe("D1");
  });

  it("actesToEntries : cote + tag=type", () => {
    const entries = actesToEntries(dossier);
    expect(entries[0]).toMatchObject({ cote: "D2", tag: "audition" });
  });
});

// Un bordereau d'envoi judiciaire ne relate aucun fait : il enumere les pieces
// transmises. Les « faits » qu'un modele en tire ne sont que des references aux
// autres pieces, et polluent la chronologie sans rien lui apprendre.
it("la chronologie des faits ecarte les evenements issus d'un bordereau d'envoi", () => {
  const dossier = {
    affaire: { reference: "r", nature: "n", service: "s", periode: { debut: null, fin: null }, nb_cotes: 3 },
    synthese: "", parties: [], actes: [], relations: [],
    evenements: [
      { id: "e1", date: "2026-02-10", precision: "jour", libelle: "vol", cote_source: "20260210_0930_PVPlainte_VIC_X_Y", parties: [] },
      { id: "e2", date: "2026-02-11", precision: "jour", libelle: "transmission", cote_source: "BORDEREAU_D_ENVOI_JUDICIAIRE", parties: [] },
      { id: "e3", date: "2026-02-12", precision: "jour", libelle: "transmission", cote_source: "BEJ_Bordereau", parties: [] },
    ],
  };
  const entries = evenementsToEntries(dossier as never);
  expect(entries.map((e) => e.id)).toEqual(["e1"]);
});

// Le bordereau est ecarte des DEUX chronologies : ce qu'il enumere est deja
// present par sa source reelle, et l'y laisser dedoublerait chaque piece.
it("la chronologie des actes ecarte aussi le bordereau d'envoi", () => {
  const dossier = {
    affaire: { reference: "r", nature: "n", service: "s", periode: { debut: null, fin: null }, nb_cotes: 1 },
    synthese: "", parties: [], evenements: [], relations: [],
    actes: [
      { id: "a1", date: "2026-02-11", type: "autre", cote: "BORDEREAU_D_ENVOI_JUDICIAIRE", libelle: "envoi", redacteur: null, concernes: [] },
      { id: "a2", date: "2026-02-10", type: "audition", cote: "20260210_1105_PVAudition_TEM_X_Y", libelle: "audition", redacteur: null, concernes: [] },
    ],
  };
  expect(actesToEntries(dossier as never).map((a) => a.id)).toEqual(["a2"]);
});
