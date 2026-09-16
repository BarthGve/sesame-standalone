import { expect, test } from "vitest";
import { parseLrpgn } from "./lrpgn";
import XML from "../../fixtures/lrpgn-audition.xml?raw";

test("extrait la personne entendue et son implication", () => {
  const c = parseLrpgn(XML)!;
  expect(c.personnes).toHaveLength(1);
  expect(c.personnes[0]).toMatchObject({
    nom: "BIDULE",
    prenom: "Marc",
    implication: "VICTIME",
    naissanceDate: "21/02/1985",
    naissanceLieu: "LORIGNE",
    nationalite: "FRANÇAISE",
  });
});

test("extrait le fait, sa qualification et sa période", () => {
  const c = parseLrpgn(XML)!;
  expect(c.faits).toHaveLength(1);
  expect(c.faits[0]).toMatchObject({
    libelle: "VOL EN BANDE ORGANISEE",
    natinf: "10832",
    debut: "20/02/2025 à 14:47",
    fin: "21/02/2025 à 14:47",
    localisation: "Rue des Plantes",
    commune: "ATHIS MONS",
    codePostal: "91200",
  });
});

test("extrait l'entête de procédure", () => {
  const c = parseLrpgn(XML)!;
  expect(c.procedure).toMatchObject({
    numero: "00059",
    annee: "2025",
    unite: "COB LE-LION-D-ANGERS",
    typeEnquete: "ENQUÊTE PRÉLIMINAIRE",
    dateActe: "vendredi 21 février 2025",
  });
});

test("ne garde que les enquêteurs nommés", () => {
  const c = parseLrpgn(XML)!;
  expect(c.enqueteurs).toEqual([
    { nom: "Adjudant Julie MALLIETTE", qualite: "Officier de Police Judiciaire" },
  ]);
});

test("XML vide, malformé ou étranger → null", () => {
  expect(parseLrpgn("")).toBeNull();
  expect(parseLrpgn("<Procedure><Entete>")).toBeNull();
  expect(parseLrpgn("<Autre><Personne/></Autre>")).toBeNull();
});

test("procédure sans personnes ni faits → listes vides", () => {
  const c = parseLrpgn("<Procedure><Entete><Unite_L4>COB X</Unite_L4></Entete></Procedure>")!;
  expect(c.personnes).toEqual([]);
  expect(c.faits).toEqual([]);
  expect(c.procedure.unite).toBe("COB X");
  expect(c.procedure.numero).toBe("");
});

test("aucune donnée sensible ne ressort du parsing", () => {
  const contexte = parseLrpgn(XML)!;
  const serialized = JSON.stringify(contexte);

  // Valeurs sensibles présentes dans la fixture XML mais qui ne doivent pas
  // se retrouver dans le résultat du parsing
  const donneesSensibles = [
    "Rue des Acacias", // Personne_Adresse
    "06.00.00.00.00", // Personne_Telephone_Portable
    "+33600000000", // CONS_Tel_Mobile
    "ACTEUR", // Personne_Profession
    "Marié(e)", // Personne_Situation_Familiale
    "2.376761", // Fait_GpsX
    "48.704229", // Fait_GpsY
  ];

  for (const valeur of donneesSensibles) {
    expect(serialized).not.toContain(valeur);
  }
});
