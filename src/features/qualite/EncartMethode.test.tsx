import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EncartMethode } from "./EncartMethode";

describe("EncartMethode", () => {
  it("affiche le taux de détection mesuré, pas une estimation", () => {
    render(<EncartMethode methode={{ taille_fragment: 40, defauts_plantes: 40, defauts_detectes: 34 }} />);
    expect(screen.getByText(/34\s*\/\s*40/)).toBeTruthy();
    expect(screen.getByText(/85\s?%/)).toBeTruthy();
  });

  it("annonce que C10 ne peut pas se déclencher, plutôt que de laisser croire à une conformité", () => {
    render(<EncartMethode methode={{ taille_fragment: 40, defauts_plantes: 40, defauts_detectes: 34 }} />);
    expect(screen.getByText(/C10/)).toBeTruthy();
    expect(screen.getByText(/90 jours/)).toBeTruthy();
  });

  it("sans défaut planté, ne montre pas un taux de 0 % trompeur", () => {
    render(<EncartMethode methode={{ taille_fragment: 40, defauts_plantes: 0, defauts_detectes: 0 }} />);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByText(/aucun défaut planté/i)).toBeTruthy();
  });
});
