import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ObjetsSelection from "./ObjetsSelection";
import type { ObjetEvaluable } from "./evaluationApi";
import type { ApiObjet } from "../saisies/perquisitionApi";

const vehicule = (id: number, marque: string, modele: string): ObjetEvaluable => ({
  perquisitionId: 10,
  adresse: "3 rue des Acacias",
  objet: {
    id,
    categorie: "TRANSPORT",
    sous_type: "VEHICULE_TERRESTRE",
    numero_scelle: `SC-${id}`,
    champs: [
      { cle: "marque", libelle: "Marque", valeur: marque, source: "deduit", obligatoire: false },
      { cle: "modele", libelle: "Modèle", valeur: modele, source: "deduit", obligatoire: false },
      { cle: "date_mec", libelle: "Date 1ʳᵉ mise en circulation", valeur: "12/03/2016", source: "deduit", obligatoire: true },
      { cle: "kilometrage", libelle: "Kilométrage", valeur: "120000", source: "a_completer", obligatoire: true },
    ],
    identifiants: [],
  } as ApiObjet,
});

test("affiche chaque vehicule avec ses elements de cote", () => {
  render(
    <ObjetsSelection vehicules={[vehicule(1, "VOLKSWAGEN", "Scirocco")]} nonEligibles={0} selection={[]} onBasculer={() => {}} />
  );
  expect(screen.getByText(/VOLKSWAGEN/)).toBeTruthy();
  expect(screen.getByText(/Scirocco/)).toBeTruthy();
  expect(screen.getByText(/120000/)).toBeTruthy();
  expect(screen.getByText(/3 rue des Acacias/)).toBeTruthy();
});

test("cocher une case remonte l'identifiant de l'objet", () => {
  const onBasculer = vi.fn();
  render(
    <ObjetsSelection vehicules={[vehicule(7, "RENAULT", "Clio")]} nonEligibles={0} selection={[]} onBasculer={onBasculer} />
  );
  screen.getByRole("checkbox").click();
  expect(onBasculer).toHaveBeenCalledWith(7);
});

test("les vehicules selectionnes sont coches", () => {
  render(
    <ObjetsSelection vehicules={[vehicule(1, "RENAULT", "Clio"), vehicule(2, "PEUGEOT", "208")]} nonEligibles={0} selection={[2]} onBasculer={() => {}} />
  );
  const cases = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(cases[0].checked).toBe(false);
  expect(cases[1].checked).toBe(true);
});

test("le nombre d'objets hors perimetre est annonce", () => {
  render(<ObjetsSelection vehicules={[vehicule(1, "RENAULT", "Clio")]} nonEligibles={4} selection={[]} onBasculer={() => {}} />);
  expect(screen.getByText(/4 autres objets/)).toBeTruthy();
});

test("aucun objet hors perimetre : pas de mention", () => {
  render(<ObjetsSelection vehicules={[vehicule(1, "RENAULT", "Clio")]} nonEligibles={0} selection={[]} onBasculer={() => {}} />);
  expect(screen.queryByText(/autres objets/)).toBeNull();
});

test("aucun vehicule : message explicite plutot qu'une liste vide", () => {
  render(<ObjetsSelection vehicules={[]} nonEligibles={3} selection={[]} onBasculer={() => {}} />);
  expect(screen.getByText(/Aucun véhicule terrestre/)).toBeTruthy();
});

test("vehicule sans marque, modele, date, kilometrage ni scelle : aucun paragraphe vide", () => {
  const sansDetails: ObjetEvaluable = {
    perquisitionId: 10,
    adresse: "3 rue des Acacias",
    objet: {
      id: 12,
      categorie: "TRANSPORT",
      sous_type: "VEHICULE_TERRESTRE",
      numero_scelle: "",
      champs: [
        { cle: "marque", libelle: "Marque", valeur: "", source: "deduit", obligatoire: false },
        { cle: "modele", libelle: "Modèle", valeur: "", source: "deduit", obligatoire: false },
        { cle: "date_mec", libelle: "Date 1ʳᵉ mise en circulation", valeur: "", source: "deduit", obligatoire: true },
        { cle: "kilometrage", libelle: "Kilométrage", valeur: "", source: "a_completer", obligatoire: true },
      ],
      identifiants: [],
    } as ApiObjet,
  };
  const { container } = render(
    <ObjetsSelection vehicules={[sansDetails]} nonEligibles={0} selection={[]} onBasculer={() => {}} />
  );
  expect(screen.getByRole("checkbox")).toBeTruthy();
  expect(screen.getByText(/3 rue des Acacias/)).toBeTruthy();
  expect(screen.getByText("Objet 12")).toBeTruthy();
  expect(screen.getByLabelText("Évaluer Objet 12")).toBeTruthy();
  const paragraphesVides = Array.from(container.querySelectorAll("p")).filter(
    (p) => p.textContent === ""
  );
  expect(paragraphesVides).toHaveLength(0);
});

test("un vehicule sans marque, modele ou date de mise en circulation est signale, sans etre decoche", () => {
  const sansDetails: ObjetEvaluable = {
    perquisitionId: 10,
    adresse: "3 rue des Acacias",
    objet: {
      id: 12,
      categorie: "TRANSPORT",
      sous_type: "VEHICULE_TERRESTRE",
      numero_scelle: "",
      champs: [
        { cle: "marque", libelle: "Marque", valeur: "", source: "deduit", obligatoire: false },
        { cle: "modele", libelle: "Modèle", valeur: "", source: "deduit", obligatoire: false },
        { cle: "date_mec", libelle: "Date 1ʳᵉ mise en circulation", valeur: "", source: "deduit", obligatoire: true },
        { cle: "kilometrage", libelle: "Kilométrage", valeur: "", source: "a_completer", obligatoire: true },
      ],
      identifiants: [],
    } as ApiObjet,
  };
  render(
    <ObjetsSelection vehicules={[sansDetails]} nonEligibles={0} selection={[]} onBasculer={() => {}} />
  );
  const cases = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(cases).toHaveLength(1);
  expect(cases[0].disabled).toBe(false);
  expect(screen.getByText(/donn[ée]es incompl[èe]tes/i)).toBeTruthy();
});

test("un vehicule complet n'affiche aucun avertissement", () => {
  render(
    <ObjetsSelection vehicules={[vehicule(1, "VOLKSWAGEN", "Scirocco")]} nonEligibles={0} selection={[]} onBasculer={() => {}} />
  );
  expect(screen.queryByText(/donn[ée]es incompl[èe]tes/i)).toBeNull();
});
