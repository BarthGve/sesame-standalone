import { describe, it, expect } from "vitest";
import { contexteVersMeta, contexteVersMetaDocument } from "./metaXml";
import type { ContexteProcedure } from "../../lib/lrpgn/lrpgn";

function contexte(personnes: ContexteProcedure["personnes"]): ContexteProcedure {
  return { personnes, faits: [], procedure: { numero: "", annee: "", unite: "", typeEnquete: "", dateActe: "" }, enqueteurs: [] };
}

function personne(nom: string, prenom: string, implication = "TEMOIN"): ContexteProcedure["personnes"][number] {
  return { nom, prenom, naissanceDate: "", naissanceLieu: "", implication, nationalite: "" };
}

// Contexte calque sur la fixture reelle src/fixtures/lrpgn-audition.xml.
function contexteComplet(): ContexteProcedure {
  return {
    personnes: [personne("DUVAL", "Patrick")],
    faits: [{ libelle: "VOL EN BANDE ORGANISEE", natinf: "10832", debut: "", fin: "", localisation: "", commune: "", codePostal: "" }],
    procedure: { numero: "00059", annee: "2025", unite: "COB LE-LION-D-ANGERS", typeEnquete: "ENQUÊTE PRÉLIMINAIRE", dateActe: "mardi 10 février 2026" },
    enqueteurs: [{ nom: "Adjudant Julie MALLIETTE", qualite: "Officier de Police Judiciaire" }],
  };
}

describe("contexteVersMeta", () => {
  it("convertit une personne et normalise la date en ISO", () => {
    const m = contexteVersMeta(contexte([
      { nom: "BIDULE", prenom: "Marc", naissanceDate: "21/02/1985", naissanceLieu: "LORIGNE", implication: "VICTIME", nationalite: "FRANÇAISE" },
    ]))!;
    expect(m.personnes).toEqual([{ nom: "BIDULE", prenom: "Marc", naissance: "1985-02-21", role: "victime" }]);
    expect(m.avertissements).toEqual([]);
  });

  it("vocabulaire LRPGN releve en production, accents et casse indifferents", () => {
    const cas: [string, string][] = [
      ["VICTIME", "victime"],
      ["TÉMOIN", "temoin"],
      ["TEMOIN", "temoin"],
      ["Témoin", "temoin"],
      ["MIS EN CAUSE", "mis_en_cause"],
      ["MIS(E) EN CAUSE", "mis_en_cause"],
      ["Mis(e) en cause", "mis_en_cause"],
      ["Mis en cause", "mis_en_cause"],
    ];
    for (const [code, attendu] of cas) {
      const m = contexteVersMeta(contexte([
        { nom: "A", prenom: "B", naissanceDate: "", naissanceLieu: "", implication: code, nationalite: "" },
      ]))!;
      expect(m.personnes[0].role, code).toBe(attendu);
      expect(m.avertissements, code).toEqual([]);
    }
  });

  it("l'avertissement cite le code tel qu'il est ecrit dans le XML", () => {
    const m = contexteVersMeta(contexte([
      { nom: "A", prenom: "B", naissanceDate: "", naissanceLieu: "", implication: "Éducateur", nationalite: "" },
    ]))!;
    expect(m.avertissements).toEqual(["Implication inconnue : Éducateur"]);
  });

  it("implication inconnue → autre + avertissement nommant le code", () => {
    const m = contexteVersMeta(contexte([
      { nom: "X", prenom: "Y", naissanceDate: "", naissanceLieu: "", implication: "GREFFIER", nationalite: "" },
    ]))!;
    expect(m.personnes[0].role).toBe("autre");
    expect(m.avertissements).toEqual(["Implication inconnue : GREFFIER"]);
  });

  it("date absente ou non reconnue → naissance vide, jamais une date inventee", () => {
    const m = contexteVersMeta(contexte([
      { nom: "A", prenom: "B", naissanceDate: "", naissanceLieu: "", implication: "VICTIME", nationalite: "" },
      { nom: "C", prenom: "D", naissanceDate: "le 3 mars", naissanceLieu: "", implication: "VICTIME", nationalite: "" },
    ]))!;
    expect(m.personnes[0].naissance).toBe("");
    expect(m.personnes[1].naissance).toBe("");
  });

  it("une personne sans nom exploitable est ecartee", () => {
    const m = contexteVersMeta(contexte([
      { nom: "", prenom: "", naissanceDate: "01/01/1980", naissanceLieu: "", implication: "VICTIME", nationalite: "" },
    ]))!;
    expect(m.personnes).toEqual([]);
  });

  it("contexte nul ou sans personne → null", () => {
    expect(contexteVersMeta(null)).toBeNull();
    expect(contexteVersMeta(contexte([]))).toBeNull();
  });

  it("le meme code inconnu deux fois ne produit qu'un avertissement", () => {
    const m = contexteVersMeta(contexte([
      { nom: "A", prenom: "B", naissanceDate: "", naissanceLieu: "", implication: "GREFFIER", nationalite: "" },
      { nom: "C", prenom: "D", naissanceDate: "", naissanceLieu: "", implication: "GREFFIER", nationalite: "" },
    ]))!;
    expect(m.avertissements).toEqual(["Implication inconnue : GREFFIER"]);
  });
});

describe("contexteVersMetaDocument", () => {
  const NOM_FICHIER = "20260210_1105_PVAudition_TEM_DUVAL_PATRICK.pdf";

  it("un contexte complet produit les huit champs", () => {
    expect(contexteVersMetaDocument(contexteComplet(), NOM_FICHIER)).toEqual({
      type_piece: "Audition",
      date_acte: "mardi 10 février 2026",
      redacteur: "Adjudant Julie MALLIETTE",
      unite: "COB LE-LION-D-ANGERS",
      procedure: "00059/2025",
      nature_fait: "VOL EN BANDE ORGANISEE",
      natinf: "10832",
      personne_concernee: "Patrick DUVAL",
    });
  });

  // Un champ vide est ABSENT, jamais present a vide : une metadonnee vide se
  // retrouverait telle quelle dans la reponse du modele.
  it("un champ dont la source est vide est absent de l'objet", () => {
    const c = contexteComplet();
    c.procedure.unite = "";
    c.procedure.dateActe = "   ";
    c.enqueteurs = [];
    c.faits = [];
    const doc = contexteVersMetaDocument(c, NOM_FICHIER)!;
    expect(Object.keys(doc).sort()).toEqual(["personne_concernee", "procedure", "type_piece"]);
  });

  it("sans contexte XML, aucune metadonnee de document", () => {
    expect(contexteVersMetaDocument(null, NOM_FICHIER)).toBeNull();
  });

  // Le libelle de formatCote n'est fiable que si le nom de fichier suit la
  // convention LRPGN ; sinon il rend le nom de fichier brut, qu'on n'emet pas.
  it("un nom de fichier hors convention n'alimente pas type_piece", () => {
    const doc = contexteVersMetaDocument(contexteComplet(), "scan-042.pdf")!;
    expect(doc.type_piece).toBeUndefined();
    expect(doc.natinf).toBe("10832");
  });

  it("le type d'acte non traduit est repris tel quel", () => {
    const doc = contexteVersMetaDocument(contexteComplet(), "20260210_1105_PVConstatation_TEM_DUVAL_PATRICK.pdf")!;
    expect(doc.type_piece).toBe("PVConstatation");
  });

  // L'ordre du XML est celui de la piece : il est conserve, jamais trie.
  it("l'ordre des personnes concernees est celui du XML, deterministe", () => {
    const c = contexteComplet();
    c.personnes = [personne("ZAMORA", "Alice"), personne("ABADIE", "Bernard"), personne("", "")];
    const doc = contexteVersMetaDocument(c, NOM_FICHIER)!;
    expect(doc.personne_concernee).toBe("Alice ZAMORA, Bernard ABADIE");
    expect(contexteVersMetaDocument(c, NOM_FICHIER)!.personne_concernee).toBe(doc.personne_concernee);
  });

  it("sans personne nommee, personne_concernee est absent", () => {
    const c = contexteComplet();
    c.personnes = [personne("", "")];
    expect(contexteVersMetaDocument(c, NOM_FICHIER)!.personne_concernee).toBeUndefined();
  });

  it("procedure sans annee se reduit au numero", () => {
    const c = contexteComplet();
    c.procedure.annee = "";
    expect(contexteVersMetaDocument(c, NOM_FICHIER)!.procedure).toBe("00059");
  });

  // Un XML present mais vide de bout en bout ne doit pas produire d'objet vide.
  it("un contexte sans aucune source exploitable rend null", () => {
    const vide = contexte([]);
    expect(contexteVersMetaDocument(vide, "scan-042.pdf")).toBeNull();
  });
});
