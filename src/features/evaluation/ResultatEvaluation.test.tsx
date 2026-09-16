import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultatEvaluation from "./ResultatEvaluation";
import type { ResultatEvaluation as TResultat } from "./evaluationApi";
import type { ObjetEvaluable } from "./evaluationApi";

// prixMoyen (l'estimation du véhicule), prix (la source) et le total recalculé
// doivent rester des valeurs distinctes : ce sont trois affichages séparés à
// l'écran, et un regex ambigu ferait échouer getByText avec "Found multiple
// elements" si deux d'entre eux coïncidaient.
const estimation = (moyen: number) => ({
  prixBas: moyen - 1000, prixMoyen: moyen, prixHaut: moyen + 1000, devise: "EUR",
  hypotheses: ["Kilométrage déclaré 120 000 km"],
  sources: [{ site: "LaCentrale", url: "https://cote.local/a/1", prix: moyen - 200 }],
  confiance: 0.7, avertissement: "Source simulée, non contractuelle.",
});

const vehicule = (id: number): ObjetEvaluable => ({
  perquisitionId: 10,
  adresse: "3 rue des Acacias",
  objet: {
    id, categorie: "TRANSPORT", sous_type: "VEHICULE_TERRESTRE",
    champs: [
      { cle: "marque", libelle: "Marque", valeur: "RENAULT", source: "deduit", obligatoire: false },
      { cle: "modele", libelle: "Modèle", valeur: "Clio", source: "deduit", obligatoire: false },
    ],
    identifiants: [],
  },
});

// Dans ce démonstrateur, l'évaluation n'écrit rien : l'écran montre les montants
// ANNONCÉS par l'analyse, à titre indicatif, sans relecture de base.
const base: TResultat = {
  objetIds: [1],
  evaluations: [{ objetId: 1, estimation: estimation(10000) }],
  nonEvalues: [],
  totalAnnonce: { bas: 17800, moyen: 19500, haut: 21200 },
  totalRecalcule: { bas: 17800, moyen: 19500, haut: 21200 },
  manquants: [],
  horsSelection: [],
  pv: "## PV",
};

test("affiche la fourchette et le vehicule concerne", () => {
  render(<ResultatEvaluation resultat={base} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/RENAULT/)).toBeTruthy();
  expect(screen.getByText(/9 000/)).toBeTruthy();
  expect(screen.getByText(/11 000/)).toBeTruthy();
});

test("affiche l'avertissement de source simulee", () => {
  render(<ResultatEvaluation resultat={base} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/simulée/i)).toBeTruthy();
});

// Le montant affiché est le total recalculé à partir des estimations annoncées.
test("affiche le total estime (recalcule)", () => {
  const divergent: TResultat = {
    ...base,
    totalAnnonce: { bas: 1, moyen: 2, haut: 3 },
    totalRecalcule: { bas: 17800, moyen: 19500, haut: 21200 },
  };
  render(<ResultatEvaluation resultat={divergent} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/Total estimé des avoirs/i)).toBeTruthy();
  expect(screen.getByText(/17 800/)).toBeTruthy();
  expect(screen.getByText(/21 200/)).toBeTruthy();
  expect(screen.getByText(/19 500/)).toBeTruthy();
});

// Le total affiché est explicitement présenté comme indicatif et non enregistré :
// c'est le cœur de la demande (démonstrateur, pas d'écriture en base).
test("dit que l'estimation est indicative et non enregistree", () => {
  render(<ResultatEvaluation resultat={base} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/non enregistrée dans la procédure/i)).toBeTruthy();
});

test("signale un ecart entre le total annonce et le total recalcule", () => {
  const faux: TResultat = { ...base, totalAnnonce: { bas: 9000, moyen: 42000, haut: 11000 } };
  render(<ResultatEvaluation resultat={faux} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/écart/i)).toBeTruthy();
});

test("aucun ecart signale quand les totaux concordent", () => {
  render(<ResultatEvaluation resultat={base} vehicules={[vehicule(1)]} />);
  expect(screen.queryByText(/écart/i)).toBeNull();
});

// Aucune évaluation n'a passé la validation : le total ne doit pas afficher
// « 0 € à 0 € », qui se lirait comme un montant, mais l'absence en toutes lettres.
test("aucun montant exploitable ne s'affiche jamais en zero euro", () => {
  const rienAnnonce: TResultat = {
    ...base, evaluations: [], totalAnnonce: null, totalRecalcule: null,
    nonEvalues: [{ objetId: 1, raison: "Estimation inexploitable" }],
  };
  render(<ResultatEvaluation resultat={rienAnnonce} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/n'a annoncé aucun montant exploitable/i)).toBeTruthy();
  expect(screen.queryByText(/0\s*€/)).toBeNull();
});

test("liste les vehicules non evalues avec leur raison", () => {
  const avecNonEvalues: TResultat = {
    ...base, nonEvalues: [{ objetId: 2, raison: "Année de mise en circulation absente" }],
  };
  render(<ResultatEvaluation resultat={avecNonEvalues} vehicules={[vehicule(1), vehicule(2)]} />);
  expect(screen.getByText(/Année de mise en circulation absente/)).toBeTruthy();
});

test("signale les objets envoyes mais absents du resultat", () => {
  const avecManquants: TResultat = { ...base, manquants: [3] };
  render(<ResultatEvaluation resultat={avecManquants} vehicules={[vehicule(1), vehicule(3)]} />);
  expect(screen.getByText(/n'ont pas été traités/i)).toBeTruthy();
});

// L'analyse annonce un total alors qu'aucune de ses estimations n'était
// exploitable : le montant qu'elle avance ne peut être recoupé par rien, mais le
// taire priverait l'enquêteur d'un chiffre que l'agent a bel et bien produit —
// et qui pourrait remonter ailleurs (le PV, par exemple).
test("un total annonce sans aucune estimation exploitable reste affiche", () => {
  const invérifiable: TResultat = {
    ...base,
    evaluations: [],
    totalAnnonce: { bas: 9000, moyen: 42000, haut: 11000 },
    totalRecalcule: null,
    nonEvalues: [{ objetId: 1, raison: "Estimation inexploitable" }],
  };
  render(<ResultatEvaluation resultat={invérifiable} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/42 000/)).toBeTruthy();
  expect(screen.getByText(/n'a pu être recoupé par aucune estimation/i)).toBeTruthy();
});

// Un objet écarté parce qu'il n'était pas dans la sélection ne pèse sur aucun
// chiffre : encore faut-il que l'enquêteur sache que l'agent est sorti du
// périmètre qu'on lui avait fixé.
test("un objet rendu hors selection est signale a l'ecran", () => {
  const horsPerimetre: TResultat = { ...base, horsSelection: [999] };
  render(<ResultatEvaluation resultat={horsPerimetre} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/hors de la sélection/i)).toBeTruthy();
  expect(screen.getByText(/999/)).toBeTruthy();
});

test("n'affiche pas de fourchette cassee quand une borne est absente", () => {
  const borneAbsente: TResultat = {
    ...base,
    evaluations: [{ objetId: 1, estimation: { ...estimation(10000), prixBas: null } }],
  };
  render(<ResultatEvaluation resultat={borneAbsente} vehicules={[vehicule(1)]} />);
  // Pas de segment "Fourchette" mal formé (bornes vides) : ni "Fourchette  à ..."
  // ni un simple "à" fantôme ne doivent apparaître.
  expect(screen.queryByText(/Fourchette/)).toBeNull();
  // L'estimation moyenne, elle, reste affichée.
  expect(screen.getByText(/10 000/)).toBeTruthy();
});
