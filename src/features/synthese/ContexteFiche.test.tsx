import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import ContexteFiche from "./ContexteFiche";
import type { ContexteProcedure } from "../../lib/lrpgn/lrpgn";

const CONTEXTE: ContexteProcedure = {
  personnes: [
    {
      nom: "BIDULE",
      prenom: "Marc",
      naissanceDate: "21/02/1985",
      naissanceLieu: "LORIGNE",
      implication: "VICTIME",
      nationalite: "FRANÇAISE",
    },
  ],
  faits: [
    {
      libelle: "VOL EN BANDE ORGANISEE",
      natinf: "10832",
      debut: "20/02/2025 à 14:47",
      fin: "21/02/2025 à 14:47",
      localisation: "Rue des Plantes",
      commune: "ATHIS MONS",
      codePostal: "91200",
    },
  ],
  procedure: {
    numero: "00059",
    annee: "2025",
    unite: "COB LE-LION-D-ANGERS",
    typeEnquete: "ENQUÊTE PRÉLIMINAIRE",
    dateActe: "vendredi 21 février 2025",
  },
  enqueteurs: [{ nom: "Adjudant Julie MALLIETTE", qualite: "Officier de Police Judiciaire" }],
};

test("affiche la personne, son rôle, le fait et sa qualification", () => {
  render(<ContexteFiche contexte={CONTEXTE} />);
  expect(screen.getByText(/BIDULE Marc/)).toBeTruthy();
  expect(screen.getByText("VICTIME")).toBeTruthy();
  expect(screen.getByText(/VOL EN BANDE ORGANISEE/)).toBeTruthy();
  expect(screen.getByText(/10832/)).toBeTruthy();
  expect(screen.getByText(/COB LE-LION-D-ANGERS/)).toBeTruthy();
});

test("un champ absent ne produit pas de ligne vide", () => {
  const sansEnqueteur: ContexteProcedure = { ...CONTEXTE, enqueteurs: [] };
  render(<ContexteFiche contexte={sansEnqueteur} />);
  expect(screen.queryByText("Enquêteur")).toBeNull();
});

test("personnes ne contenant qu'une entrée totalement vide : le titre ne s'affiche pas seul", () => {
  const personneVide = {
    nom: "",
    prenom: "",
    naissanceDate: "",
    naissanceLieu: "",
    implication: "",
    nationalite: "",
  };
  render(<ContexteFiche contexte={{ ...CONTEXTE, personnes: [personneVide] }} />);
  expect(screen.queryByText("Personne entendue")).toBeNull();
});

test("faits ne contenant qu'une entrée totalement vide : le titre ne s'affiche pas seul", () => {
  const faitVide = { libelle: "", natinf: "", debut: "", fin: "", localisation: "", commune: "", codePostal: "" };
  render(<ContexteFiche contexte={{ ...CONTEXTE, faits: [faitVide] }} />);
  expect(screen.queryByText("Faits")).toBeNull();
});

test("enqueteurs ne contenant qu'une entrée totalement vide : le titre ne s'affiche pas seul", () => {
  const enqueteurVide = { nom: "", qualite: "" };
  render(<ContexteFiche contexte={{ ...CONTEXTE, enqueteurs: [enqueteurVide] }} />);
  expect(screen.queryByText("Enquêteur")).toBeNull();
});

test("contexte sans personne ni fait : la fiche reste lisible", () => {
  render(<ContexteFiche contexte={{ ...CONTEXTE, personnes: [], faits: [] }} />);
  expect(screen.queryByText("Personne entendue")).toBeNull();
  expect(screen.getByText(/COB LE-LION-D-ANGERS/)).toBeTruthy();
});

test("fait avec localisation vide : pas de virgule orpheline devant la commune", () => {
  const fait = { ...CONTEXTE.faits[0], localisation: "" };
  render(<ContexteFiche contexte={{ ...CONTEXTE, faits: [fait] }} />);
  const paragraphe = screen.getByText(/VOL EN BANDE ORGANISEE/).closest("p");
  expect(paragraphe?.textContent).toContain("ATHIS MONS (91200)");
  expect(paragraphe?.textContent).not.toMatch(/,\s*ATHIS MONS/);
});

test("fait avec début vide : la fin ne s'affiche pas comme un « au » orphelin", () => {
  const fait = { ...CONTEXTE.faits[0], debut: "" };
  render(<ContexteFiche contexte={{ ...CONTEXTE, faits: [fait] }} />);
  const paragraphe = screen.getByText(/VOL EN BANDE ORGANISEE/).closest("p");
  expect(paragraphe?.textContent).toContain("jusqu'au 21/02/2025 à 14:47");
  expect(paragraphe?.textContent).not.toMatch(/\)\s+au\s/);
});

test("type d'enquête vide avec date d'acte renseignée : pas de tiret orphelin", () => {
  const procedure = { ...CONTEXTE.procedure, typeEnquete: "" };
  render(<ContexteFiche contexte={{ ...CONTEXTE, procedure }} />);
  const titre = screen.getByText("Procédure");
  const paragraphes = Array.from(titre.closest("div")?.querySelectorAll("p") || []);
  const ligneDate = paragraphes.find((p) => p.textContent?.includes("vendredi 21 février 2025"));
  expect(ligneDate?.textContent).toBe("vendredi 21 février 2025");
});

test("fait sans libellé ni natinf : la période ne commence pas par un tiret orphelin", () => {
  const fait = { ...CONTEXTE.faits[0], libelle: "", natinf: "" };
  render(<ContexteFiche contexte={{ ...CONTEXTE, faits: [fait] }} />);
  const paragraphe = screen.getByText(/ATHIS MONS/).closest("p");
  expect(paragraphe?.textContent).toBe(
    "du 20/02/2025 à 14:47 au 21/02/2025 à 14:47 — Rue des Plantes, ATHIS MONS (91200)"
  );
});

test("procédure entièrement vide : le titre ne s'affiche pas seul", () => {
  const procedure = { numero: "", annee: "", unite: "", typeEnquete: "", dateActe: "" };
  render(<ContexteFiche contexte={{ ...CONTEXTE, procedure }} />);
  expect(screen.queryByText("Procédure")).toBeNull();
});

test("enquêteur sans nom : pas de tiret orphelin devant la qualité", () => {
  const enqueteurs = [{ nom: "", qualite: "Officier de Police Judiciaire" }];
  render(<ContexteFiche contexte={{ ...CONTEXTE, enqueteurs }} />);
  const paragraphe = screen.getByText("Officier de Police Judiciaire").closest("p");
  expect(paragraphe?.textContent).toBe("Officier de Police Judiciaire");
});

test("personne totalement vide : aucun paragraphe vide n'est rendu", () => {
  const personneVide = {
    nom: "",
    prenom: "",
    naissanceDate: "",
    naissanceLieu: "",
    implication: "",
    nationalite: "",
  };
  render(<ContexteFiche contexte={{ ...CONTEXTE, personnes: [CONTEXTE.personnes[0], personneVide] }} />);
  const titre = screen.getByText("Personne entendue");
  const paragraphes = Array.from(titre.closest("div")?.querySelectorAll("p") || []);
  const vides = paragraphes.filter((p) => !p.textContent?.trim());
  expect(vides.length).toBe(0);
});

test("personne avec date de naissance vide mais lieu renseigné : le lieu n'est pas orphelin", () => {
  const personne = { ...CONTEXTE.personnes[0], naissanceDate: "" };
  render(<ContexteFiche contexte={{ ...CONTEXTE, personnes: [personne] }} />);
  const paragraphe = screen.getByText("VICTIME").closest("p");
  expect(paragraphe?.textContent).toContain("né(e)");
  expect(paragraphe?.textContent).toContain("LORIGNE");
  expect(paragraphe?.textContent).not.toMatch(/^[^—]*\sà LORIGNE/);
});

test("personne sans nom ni prénom : pas d'espace parasite avant le rôle", () => {
  const personne = { ...CONTEXTE.personnes[0], nom: "", prenom: "" };
  render(<ContexteFiche contexte={{ ...CONTEXTE, personnes: [personne] }} />);
  const paragraphe = screen.getByText("VICTIME").closest("p");
  expect(paragraphe?.textContent?.startsWith(" ")).toBe(false);
});

test("numéro vide avec année renseignée : pas de slash orphelin", () => {
  const procedure = { ...CONTEXTE.procedure, numero: "" };
  render(<ContexteFiche contexte={{ ...CONTEXTE, procedure }} />);
  const titre = screen.getByText("Procédure");
  const paragraphes = titre.closest("div")?.querySelectorAll("p") || [];
  const refProcedure = Array.from(paragraphes).find((p) => p.textContent?.includes("2025"));
  expect(refProcedure?.textContent).toContain("2025");
  expect(refProcedure?.textContent).toContain("COB LE-LION-D-ANGERS");
  expect(refProcedure?.textContent).not.toMatch(/^\s*\/\s/);
});
