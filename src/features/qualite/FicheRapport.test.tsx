import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FicheRapport } from "./FicheRapport";
import type { FicheAnalysee } from "./analyseApi";

const fiche: FicheAnalysee = {
  frs_id: 0, titre: "Rassemblement", unite: "COB Segré", code_ggd: "GGD 49",
  commune: "Segré", date_redaction: "2026-08-07", texte: "Des faits constatés.",
  porte_dcp: true, hors_perimetre: false, conforme: false, gravite_max: "bloquant",
  ecarts: [{
    critere: "B5", libelle: "Donnée sensible", gravite: "bloquant",
    fondement: "CSI R. 236-23", source: "llm", extrait: "de confession musulmane",
    explication: "Croyance.", confiance: "haute",
  }],
  controles: [],
};

describe("FicheRapport", () => {
  it("rend le verdict et ses écarts", () => {
    render(<FicheRapport fiche={fiche} />);
    expect(screen.getByText(/Non conforme/)).toBeInTheDocument();
    expect(screen.getByText("B5")).toBeInTheDocument();
    expect(screen.getByText(/R. 236-23/)).toBeInTheDocument();
  });

  it("tait l'identité de la fiche quand on le lui demande", () => {
    // Un brouillon n'a pas d'identifiant : afficher « Fiche 0 » serait un mensonge, et
    // laisserait croire que la fiche est déjà en base.
    render(<FicheRapport fiche={fiche} montrerIdentite={false} />);
    expect(screen.queryByText(/Fiche 0/)).not.toBeInTheDocument();
    expect(screen.getByText("B5")).toBeInTheDocument();
  });
});
