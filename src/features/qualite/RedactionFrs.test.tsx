import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RedactionFrs } from "./RedactionFrs";
import { reinitialiserBrouillon } from "./redactionStore";
import type { RapportAnalyse } from "./analyseApi";
import type { Referentiel, CommuneRef } from "./redactionApi";

const REF: Referentiel = {
  ggd: [{ code: "GGD 49", code_dept: "49", nom_departement: "Maine-et-Loire" }],
  unites: [{ code_ggd: "GGD 49", nom: "COB Segré" }],
  mots_cles: ["rassemblement", "rodéo", "stupéfiants"],
};

const COMMUNES: CommuneRef[] = [
  { code_insee: "49331", nom: "Segré", code_dept: "49" },
  { code_insee: "49007", nom: "Angers", code_dept: "49" },
];

const rapport = (ecarts: string[]): RapportAnalyse => ({
  fiches: [{
    frs_id: 0, titre: "T", unite: "COB Segré", code_ggd: "GGD 49", commune: "Segré",
    date_redaction: "2026-08-07", texte: "Des faits.", porte_dcp: true, hors_perimetre: false,
    conforme: ecarts.length === 0, gravite_max: ecarts.length ? "bloquant" : null,
    ecarts: ecarts.map((critere) => ({
      critere, libelle: "Donnée sensible", gravite: "bloquant" as const,
      fondement: "CSI R. 236-23", source: "llm" as const, extrait: "extrait",
      explication: "…", confiance: "haute" as const,
    })),
    controles: [],
  }],
  resume: { total: 1, conformes: ecarts.length ? 0 : 1, non_conformes: ecarts.length ? 1 : 0, ecarts: ecarts.length, par_gravite: {}, rejets: 0 },
});

async function remplir() {
  fireEvent.change(await screen.findByLabelText(/^Titre$/), { target: { value: "Rassemblement" } });
  fireEvent.change(screen.getByLabelText(/^GGD$/), { target: { value: "GGD 49" } });
  // Unité et commune se chargent après le GGD.
  fireEvent.change(await screen.findByLabelText(/^Unité$/), { target: { value: "COB Segré" } });
  fireEvent.change(await screen.findByLabelText(/^Commune$/), { target: { value: "Segré" } });
  fireEvent.change(screen.getByLabelText(/^Texte$/), { target: { value: "Des faits constatés." } });
}

const propsBase = {
  referentiel: async () => REF,
  communes: async () => COMMUNES,
};

describe("RedactionFrs", () => {
  beforeEach(() => {
    sessionStorage.clear();
    reinitialiserBrouillon();
  });

  it("n'offre pas d'enregistrer avant la première analyse", async () => {
    render(<RedactionFrs analyser={vi.fn()} enregistrer={vi.fn()} {...propsBase} />);
    await screen.findByLabelText(/^Titre$/);
    expect(screen.queryByRole("button", { name: /Enregistrer/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyser/ })).toBeInTheDocument();
  });

  it("propose les unités du GGD choisi et les mots-clés du référentiel", async () => {
    render(<RedactionFrs analyser={vi.fn()} enregistrer={vi.fn()} {...propsBase} />);
    fireEvent.change(await screen.findByLabelText(/^GGD$/), { target: { value: "GGD 49" } });
    expect(await screen.findByRole("option", { name: "COB Segré" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Segré" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "rodéo" })).toBeInTheDocument();
  });

  it("conserve le brouillon après démontage (navigation d'onglet)", async () => {
    const { unmount } = render(<RedactionFrs analyser={vi.fn()} enregistrer={vi.fn()} {...propsBase} />);
    fireEvent.change(await screen.findByLabelText(/^Titre$/), { target: { value: "Brouillon conservé" } });
    fireEvent.change(screen.getByLabelText(/^Texte$/), { target: { value: "Texte en cours de saisie." } });
    unmount();
    render(<RedactionFrs analyser={vi.fn()} enregistrer={vi.fn()} {...propsBase} />);
    expect(await screen.findByLabelText(/^Titre$/)).toHaveValue("Brouillon conservé");
    expect(screen.getByLabelText(/^Texte$/)).toHaveValue("Texte en cours de saisie.");
  });

  it("analyse, montre le verdict, puis enregistre sur confirmation", async () => {
    const analyser = vi.fn().mockResolvedValue(rapport(["B5"]));
    const enregistrer = vi.fn().mockResolvedValue(4213);
    render(<RedactionFrs analyser={analyser} enregistrer={enregistrer} {...propsBase} />);
    await remplir();
    fireEvent.click(screen.getByRole("button", { name: "rodéo" }));
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    expect(await screen.findByText("B5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(enregistrer).toHaveBeenCalledTimes(1));
    expect(enregistrer.mock.calls[0][0].mots_cles).toContain("rodéo");
    expect(enregistrer.mock.calls[0][0].code_ggd).toBe("GGD 49");
    expect(await screen.findByText(/4213/)).toBeInTheDocument();
  });

  it("marque le verdict périmé dès que le texte change", async () => {
    render(<RedactionFrs analyser={vi.fn().mockResolvedValue(rapport(["B5"]))} enregistrer={vi.fn()} {...propsBase} />);
    await remplir();
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    await screen.findByText("B5");
    fireEvent.change(screen.getByLabelText(/^Texte$/), { target: { value: "Des faits constatés. Complément." } });
    expect(screen.getByText(/version antérieure/i)).toBeInTheDocument();
    expect(screen.getByText("B5")).toBeInTheDocument();
  });

  it("laisse enregistrer quand l'analyse est en panne", async () => {
    const enregistrer = vi.fn().mockResolvedValue(7);
    render(<RedactionFrs analyser={vi.fn().mockRejectedValue(new Error("IAKA_TIMEOUT"))} enregistrer={enregistrer} {...propsBase} />);
    await remplir();
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    expect(await screen.findByText(/n'a pas abouti/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(enregistrer).toHaveBeenCalledTimes(1));
  });

  it("conserve le texte quand l'enregistrement échoue", async () => {
    render(<RedactionFrs
      analyser={vi.fn().mockResolvedValue(rapport([]))}
      enregistrer={vi.fn().mockRejectedValue(new Error("Champ « commune » obligatoire"))}
      {...propsBase} />);
    await remplir();
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Enregistrer/ }));
    expect(await screen.findByText(/Champ « commune » obligatoire/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Texte$/)).toHaveValue("Des faits constatés.");
  });

  it("confirme même une fiche conforme", async () => {
    const enregistrer = vi.fn().mockResolvedValue(1);
    render(<RedactionFrs analyser={vi.fn().mockResolvedValue(rapport([]))} enregistrer={enregistrer} {...propsBase} />);
    await remplir();
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    expect(await screen.findByText(/Conforme/)).toBeInTheDocument();
    expect(enregistrer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(enregistrer).toHaveBeenCalledTimes(1));
  });
});
