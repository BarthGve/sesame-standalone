import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QualiteApp } from "./QualiteApp";

afterEach(() => vi.unstubAllGlobals());

const rapport = {
  run: { jour: "2026-08-04", statut: "complet", termine_a: null, total_fiches: 100,
         fragments_total: 3, fragments_ok: 3, taille_fragment: 40 },
  methode: { taille_fragment: 40, defauts_plantes: 0, defauts_detectes: 0 },
  synthese: { fiches_non_conformes: 2, taux_conformite: 0.98,
              par_gravite: { bloquant: 1, majeur: 1 }, par_critere: [],
              par_unite: [{ unite: "COB X", n: 2, bloquant: 1 }] },
  fiches: [
    { frs_id: 1, titre: "A", unite: "COB X", code_ggd: "GGD 49", commune: "C",
      date_redaction: "2026-08-04", n_ecarts: 1, criteres: ["A1"], gravite_max: "bloquant" },
    { frs_id: 2, titre: "B", unite: "COB X", code_ggd: "GGD 49", commune: "C",
      date_redaction: "2026-08-04", n_ecarts: 1, criteres: ["A3"], gravite_max: "majeur" },
  ],
};

const stub = (body: unknown, ok = true, status = 200) =>
  vi.stubGlobal("fetch", async () => ({ ok, status, json: async () => body }) as Response);

describe("QualiteApp", () => {
  it("liste toutes les fiches en écart par défaut, sans obliger à choisir une file", async () => {
    stub({ data: rapport });
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText(/^A —/)).toBeTruthy());
    expect(screen.getByText(/^B —/)).toBeTruthy();
  });

  it("la file « à supprimer » ne garde que les bloquants", async () => {
    stub({ data: rapport });
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText(/^A —/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /À supprimer/ }));
    await waitFor(() => expect(screen.queryByText(/^B —/)).toBeNull());
    expect(screen.getByText(/^A —/)).toBeTruthy();
  });

  it("« aucun audit » est un message explicite, jamais un écran vide", async () => {
    stub({ error: { code: "no_run", message: "Aucun audit" } }, false, 404);
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText(/aucun audit/i)).toBeTruthy());
  });

  it("une erreur technique ne ressemble pas à « tout est conforme »", async () => {
    stub({ error: { code: "db_error", message: "Erreur" } }, false, 500);
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByText(/conformes/)).toBeNull();
  });

  it("un jour sans aucune non-conformité le dit explicitement", async () => {
    stub({ data: { ...rapport, synthese: { ...rapport.synthese, fiches_non_conformes: 0, par_gravite: {} }, fiches: [] } });
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText(/aucune non-conformité/i)).toBeTruthy());
  });

  it("changer de journée recharge le rapport pour ce jour", async () => {
    const spy = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => ({ data: rapport }) }) as Response);
    vi.stubGlobal("fetch", spy);
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText(/^A —/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Journée/), { target: { value: "2026-07-30" } });
    await waitFor(() => expect(spy.mock.calls.some((c) => String(c[0]).includes("jour=2026-07-30"))).toBe(true));
  });

  it("l'analyse à la demande reste accessible même sans run nocturne", async () => {
    stub({ error: { code: "no_run", message: "Aucun audit" } }, false, 404);
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    // Sans cet accès, la seule façon de contrôler des fiches un jour sans batch serait
    // d'attendre la nuit suivante.
    fireEvent.click(screen.getByRole("button", { name: /Analyse à la demande/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Analyser/ })).toBeTruthy());
  });

  it("donne accès à la rédaction, même sans rapport nocturne", async () => {
    // Même raison que pour l'analyse à la demande : un jour sans batch ne doit pas rendre la
    // rédaction inatteignable — ce serait attendre la nuit pour écrire une fiche.
    stub({ error: { code: "no_run", message: "Aucun audit" } }, false, 404);
    render(<QualiteApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Rédiger/ }));
    expect(await screen.findByLabelText(/Titre/)).toBeInTheDocument();
  });

  it("n'utilise aucun emoji", async () => {
    stub({ data: rapport });
    const { container } = render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText(/^A —/)).toBeTruthy());
    expect(container.textContent || "").not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("QualiteApp — rapport macro et liste paginée", () => {
  const beaucoup = {
    ...rapport,
    run: { ...rapport.run, total_fiches: 1058, fragments_total: 27, fragments_ok: 27 },
    synthese: {
      ...rapport.synthese, fiches_non_conformes: 60, taux_conformite: 0.943,
      par_gravite: { bloquant: 12, majeur: 30, mineur: 18 },
    },
    fiches: Array.from({ length: 60 }, (_, i) => ({
      frs_id: i + 1, titre: "Fiche " + (i + 1), unite: "COB X", code_ggd: "GGD 49", commune: "C",
      date_redaction: "2026-08-05", n_ecarts: 2, criteres: ["A1", "D12"],
      gravite_max: i < 12 ? "bloquant" : i < 42 ? "majeur" : "mineur",
    })),
  };

  it("annonce le macro : fiches analysées, fiches en écart, écarts relevés", async () => {
    stub({ data: beaucoup });
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByLabelText("1 058 fiches analysées")).toBeTruthy());
    expect(screen.getByLabelText("60 fiches en écart")).toBeTruthy();
    // 60 fiches × 2 écarts : le total d'écarts n'est pas le nombre de fiches.
    expect(screen.getByLabelText("120 écarts relevés")).toBeTruthy();
  });

  it("liste TOUTES les fiches en écart par défaut, 25 par page", async () => {
    stub({ data: beaucoup });
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText(/Fiche 1 —/)).toBeTruthy());
    expect(screen.getByText(/Fiche 25 —/)).toBeTruthy();
    expect(screen.queryByText(/Fiche 26 —/)).toBeNull();
    expect(screen.getByText(/1\s?–\s?25 sur 60/)).toBeTruthy();
  });

  it("la page suivante montre la suite, sans reprendre au début", async () => {
    stub({ data: beaucoup });
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText(/Fiche 1 —/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Suivant/ }));
    await waitFor(() => expect(screen.getByText(/Fiche 26 —/)).toBeTruthy());
    expect(screen.queryByText(/Fiche 1 —/)).toBeNull();
    expect(screen.getByText(/26\s?–\s?50 sur 60/)).toBeTruthy();
  });

  it("changer de file remet la pagination au début", async () => {
    stub({ data: beaucoup });
    render(<QualiteApp />);
    await waitFor(() => expect(screen.getByText(/Fiche 1 —/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Suivant/ }));
    await waitFor(() => expect(screen.getByText(/Fiche 26 —/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /À supprimer/ }));
    // 12 bloquants : une seule page, et on la voit depuis son premier rang.
    await waitFor(() => expect(screen.getByText(/Fiche 1 —/)).toBeTruthy());
    expect(screen.getByText(/1\s?–\s?12 sur 12/)).toBeTruthy();
  });
});
