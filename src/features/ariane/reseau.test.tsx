import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// react-force-graph dessine sur un <canvas>, non rendu par jsdom : on le remplace
// par un stub qui expose graphData pour vérifier ce qui lui est transmis.
vi.mock("react-force-graph-2d", () => ({
  default: (props: any) => (
    <div data-testid="fg" data-nodes={props.graphData.nodes.length} data-links={props.graphData.links.length} />
  ),
}));

import Reseau from "./Reseau";
import type { Dossier } from "./arianeApi";

const dossier: Dossier = {
  affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: null, fin: null }, nb_cotes: 1 },
  synthese: "s",
  parties: [
    { id: "p1", nom: "DUPONT", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D1" },
    { id: "p2", nom: "MERIDIA", role: "victime", aliases: [], qualite: "", premiere_cote: "D1" },
  ],
  evenements: [], actes: [],
  relations: [{ source: "p2", cible: "p1", type: "victime_de", libelle: "victime", cotes: ["D1"] }],
};

describe("Reseau", () => {
  it("transmet nœuds + liens au graphe et liste les personnes filtrables", () => {
    render(<Reseau dossier={dossier} onSelectCotes={vi.fn()} />);
    const fg = screen.getByTestId("fg");
    expect(fg.getAttribute("data-nodes")).toBe("2");
    expect(fg.getAttribute("data-links")).toBe("1");
    expect(screen.getByLabelText("DUPONT")).toBeTruthy();
    expect(screen.getByLabelText("MERIDIA")).toBeTruthy();
  });

  it("décocher une personne la retire du graphe (et ses liens)", () => {
    render(<Reseau dossier={dossier} onSelectCotes={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("DUPONT"));
    const fg = screen.getByTestId("fg");
    expect(fg.getAttribute("data-nodes")).toBe("1"); // DUPONT masqué
    expect(fg.getAttribute("data-links")).toBe("0"); // le lien qui le touchait aussi
  });
});
