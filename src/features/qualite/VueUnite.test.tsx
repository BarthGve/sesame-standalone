import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VueUnite } from "./VueUnite";

const unites = [
  { unite: "COB Segré", n: 9, bloquant: 3 },
  { unite: "BTA Cholet", n: 12, bloquant: 0 },
];

describe("VueUnite", () => {
  it("classe les unités porteuses de bloquants en premier, même avec moins d'écarts", () => {
    render(<VueUnite unites={unites} />);
    const lignes = screen.getAllByRole("row").slice(1);
    expect(lignes[0].textContent).toContain("COB Segré");
  });

  it("affiche le volume et le nombre de bloquants par unité", () => {
    render(<VueUnite unites={unites} />);
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("liste vide : message explicite, pas de tableau fantôme", () => {
    render(<VueUnite unites={[]} />);
    expect(screen.getByText(/aucune unité/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
