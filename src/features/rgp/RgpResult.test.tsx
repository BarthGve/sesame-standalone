// src/features/rgp/RgpResult.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RgpResult from "./RgpResult";
import type { RgpParsed } from "./rgpApi";

describe("RgpResult", () => {
  it("erreur métier → alerte", () => {
    render(<RgpResult reply={{ text: "", message: "", parsed: { error: { code: "groupe_inconnu", message: "Groupe X inconnu" } } }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Groupe X inconnu/)).toBeInTheDocument();
  });

  it("appel d'outil décrit mais non exécuté → message clair", () => {
    const p = { call: "modifyProcedure", args: { una: "15127/128/2026" } } as unknown as RgpParsed;
    render(<RgpResult reply={{ text: "", message: "", parsed: p }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/n'a pas exécuté l'action/)).toBeInTheDocument();
  });

  it("réponse markdown (phrase + gras) → texte rendu, sans astérisques", () => {
    render(<RgpResult reply={{ text: "", message: "Procédure **15127/126/2026** créée.", parsed: { data: { una: "15127/126/2026" } } }} />);
    expect(screen.getByText(/Procédure/)).toBeInTheDocument();
    expect(screen.getByText("15127/126/2026")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("réponse markdown = tableau → un vrai <table> avec les valeurs", () => {
    const md = ["Répartition par mois :", "", "| Mois | Nombre |", "| --- | --- |", "| Juin | 4 |", "| Juillet | 3 |"].join("\n");
    render(<RgpResult reply={{ text: "", message: md, parsed: { data: [] } }} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Mois")).toBeInTheDocument();
    expect(screen.getByText("Juin")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("repli : message vide + données → bloc JSON affiché", () => {
    render(<RgpResult reply={{ text: "", message: "", parsed: { data: { una: "15127/126/2026" } } }} />);
    expect(screen.getByText(/15127\/126\/2026/)).toBeInTheDocument();
  });
});
