import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FicheDetailVue } from "./FicheDetailVue";
import type { FicheDetail } from "./qualiteApi";

const fiche: FicheDetail = {
  frs_id: 12, titre: "Camping", unite: "COB X", code_ggd: "GGD 49", commune: "Segré",
  date_redaction: "2026-08-04",
  texte: "Trouble à la tranquillité publique dans un camping. Les jeunes ont obtempéré.",
  ecarts: [{ critere: "A3", libelle: "Motif incohérent avec les faits", gravite: "majeur",
             source: "llm", fondement: "CSI R. 236-22, 4°",
             extrait: "Les jeunes ont obtempéré", explication: "Motif sans rapport.", confiance: "haute" }],
};

describe("FicheDetailVue", () => {
  it("montre le texte INTÉGRAL, pas seulement l'extrait", () => {
    render(<FicheDetailVue fiche={fiche} />);
    expect(screen.getByText(/Trouble à la tranquillité publique dans un camping/)).toBeTruthy();
  });

  it("surligne l'extrait incriminé à l'intérieur du texte", () => {
    const { container } = render(<FicheDetailVue fiche={fiche} />);
    const marque = container.querySelector("mark");
    expect(marque?.textContent).toBe("Les jeunes ont obtempéré");
  });

  it("met le fondement juridique en avant : c'est ce qui rend l'écart opposable", () => {
    render(<FicheDetailVue fiche={fiche} />);
    expect(screen.getByText("CSI R. 236-22, 4°")).toBeTruthy();
  });

  it("signale une confiance moyenne comme appelant une relecture", () => {
    const f = { ...fiche, ecarts: [{ ...fiche.ecarts[0], confiance: "moyenne" as const }] };
    render(<FicheDetailVue fiche={f} />);
    expect(screen.getByText(/relecture/i)).toBeTruthy();
  });

  it("propose le lien vers le flux quand demandé", () => {
    render(<FicheDetailVue fiche={fiche} lienFlux />);
    expect(screen.getByRole("button", { name: /Voir dans le flux/i })).toBeTruthy();
  });

  it("un extrait absent n'empêche pas l'affichage du texte", () => {
    const f = { ...fiche, ecarts: [{ ...fiche.ecarts[0], extrait: null }] };
    const { container } = render(<FicheDetailVue fiche={f} />);
    expect(container.querySelector("mark")).toBeNull();
    expect(screen.getByText(/camping/)).toBeTruthy();
  });
});
