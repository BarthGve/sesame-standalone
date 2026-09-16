import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RapportEntete } from "./RapportEntete";
import type { Rapport } from "./qualiteApi";

const rapport = (over: Partial<Rapport["run"]> = {}): Rapport => ({
  run: { jour: "2026-08-04", statut: "complet", termine_a: "2026-08-05T03:12:44Z",
         total_fiches: 1043, fragments_total: 26, fragments_ok: 26, taille_fragment: 40, ...over },
  methode: { taille_fragment: 40, defauts_plantes: 40, defauts_detectes: 34 },
  synthese: { fiches_non_conformes: 168, taux_conformite: 0.839,
              par_gravite: { bloquant: 11, majeur: 74, mineur: 83 },
              par_critere: [], par_unite: [] },
  fiches: [],
});

describe("RapportEntete", () => {
  it("annonce la couverture avant le résultat", () => {
    render(<RapportEntete rapport={rapport()} />);
    expect(screen.getByText(/1\s?043 fiches contrôlées/)).toBeTruthy();
    expect(screen.getByText(/26\s?\/\s?26 fragments/)).toBeTruthy();
    expect(screen.getByLabelText("83,9 % conformes")).toBeTruthy();
  });

  it("affiche les trois compteurs de gravité", () => {
    render(<RapportEntete rapport={rapport()} />);
    // Chiffre et libellé sont deux nœuds distincts à l'écran, une seule information pour
    // un lecteur d'écran : c'est l'aria-label qui porte le sens.
    expect(screen.getByLabelText("11 bloquants")).toBeTruthy();
    expect(screen.getByLabelText("74 majeurs")).toBeTruthy();
    expect(screen.getByLabelText("83 mineurs")).toBeTruthy();
  });

  it("un run partiel est ANNONCÉ, avec le nombre de fiches non contrôlées", () => {
    render(<RapportEntete rapport={rapport({ statut: "partiel", fragments_ok: 24 })} />);
    const alerte = screen.getByRole("alert");
    expect(alerte.textContent).toMatch(/24\s?\/\s?26/);
    expect(alerte.textContent).toMatch(/80 fiches non contrôlées/);
  });

  it("un run complet n'affiche aucune alerte", () => {
    render(<RapportEntete rapport={rapport()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("n'utilise aucun emoji", () => {
    const { container } = render(<RapportEntete rapport={rapport({ statut: "partiel", fragments_ok: 20 })} />);
    expect(container.textContent || "").not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
