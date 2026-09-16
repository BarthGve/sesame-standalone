import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const FICHE = {
  id: 1, date_redaction: "2026-03-04", titre: "Rodéos", unite: "COB Segré-en-Anjou Bleu",
  code_ggd: "GGD 49", departement: "Maine-et-Loire", commune: "Cholet", mots_cles: ["rodéo"], texte: "…",
};

describe("RensApp", () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetModules(); vi.restoreAllMocks(); });

  it("charge les fiches au montage et les affiche", async () => {
    vi.doMock("./rensApi", () => ({
      fetchFiches: vi.fn().mockResolvedValue({
        fiches: [
          { id: 1, date_redaction: "2026-03-04", titre: "Rodéos", unite: "COB Segré-en-Anjou Bleu", code_ggd: "GGD 49", departement: "Maine-et-Loire", commune: "Cholet", mots_cles: ["rodéo"], texte: "…" },
        ],
        total: 1,
      }),
      fetchReferentielListes: vi.fn().mockResolvedValue({
        ggd: [{ code: "GGD 49", code_dept: "49", nom_departement: "Maine-et-Loire" }],
        mots_cles: ["rodéo", "deal"],
      }),
      fetchCommunes: vi.fn().mockResolvedValue([]),
      sendRensPrompt: vi.fn().mockResolvedValue("## Synthèse\nRAS."),
    }));
    const { default: RensApp } = await import("./RensApp");
    render(<RensApp />);
    await waitFor(() => expect(screen.getByText("Rodéos")).toBeInTheDocument());
    expect(screen.getByText(/1 fiche/)).toBeInTheDocument();
    // Select GGD + mots-clés peuplés depuis le référentiel.
    await waitFor(() => expect(screen.getByRole("option", { name: /GGD 49/ })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "rodéo" })).toBeInTheDocument();
  });

  it("génère la synthèse dans une vue dédiée, puis revient au flux avec un bouton « Voir »", async () => {
    let resolveSynth: (v: string) => void = () => {};
    vi.doMock("./rensApi", () => ({
      fetchFiches: vi.fn().mockResolvedValue({ fiches: [FICHE], total: 1 }),
      fetchReferentielListes: vi.fn().mockResolvedValue({ ggd: [], mots_cles: [] }),
      fetchCommunes: vi.fn().mockResolvedValue([]),
      sendRensPrompt: vi.fn().mockReturnValue(new Promise<string>((r) => { resolveSynth = r; })),
    }));
    const { default: RensApp } = await import("./RensApp");
    render(<RensApp />);
    await waitFor(() => expect(screen.getByText("Rodéos")).toBeInTheDocument());

    // Clic « Générer » → bascule en vue synthèse : engrenages de construction, flux masqué.
    fireEvent.click(screen.getByRole("button", { name: /Générer la synthèse/ }));
    expect(screen.getByLabelText("Construction de la synthèse en cours")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retour au flux/ })).toBeInTheDocument();
    expect(screen.queryByText("Rodéos")).not.toBeInTheDocument();
    // Pas d'export tant que la synthèse n'est pas prête.
    expect(screen.queryByRole("button", { name: /Export PDF/ })).not.toBeInTheDocument();

    // La synthèse arrive → remplace les engrenages, l'export PDF apparaît.
    resolveSynth("## Synthèse\nRAS.");
    await waitFor(() => expect(screen.getByText("RAS.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Construction de la synthèse en cours")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export PDF/ })).toBeInTheDocument();

    // Retour au flux → la liste réapparaît et le bouton propose « Voir la synthèse ».
    fireEvent.click(screen.getByRole("button", { name: /Retour au flux/ }));
    await waitFor(() => expect(screen.getByText("Rodéos")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Voir la synthèse/ })).toBeInTheDocument();

    // « Voir » rouvre la synthèse SANS relancer l'analyse (pas d'engrenages).
    fireEvent.click(screen.getByRole("button", { name: /Voir la synthèse/ }));
    expect(screen.getByText("RAS.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Construction de la synthèse en cours")).not.toBeInTheDocument();
  });
});
