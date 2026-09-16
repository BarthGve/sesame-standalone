import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AnalyseDemande } from "./AnalyseDemande";

afterEach(() => vi.unstubAllGlobals());

const fiches = [
  { id: 1, date_redaction: "2026-08-05", titre: "Rodéos motorisés", unite: "COB Segré", code_ggd: "GGD 49",
    departement: "Maine-et-Loire", commune: "Segré", mots_cles: ["rodéo"], texte: "Faits constatés." },
  { id: 2, date_redaction: "2026-08-05", titre: "Attroupement", unite: "BTA Cholet", code_ggd: "GGD 49",
    departement: "Maine-et-Loire", commune: "Cholet", mots_cles: [], texte: "Autres faits." },
];

const controles = (ecart?: string) =>
  ["A1", "A4", "B5", "B6", "B7", "C9", "C10", "D11", "D12"].map((c) => ({
    critere: c, libelle: "libellé " + c, fondement: "CSI R. 236-2X",
    source: c === "C10" ? "sql" : "llm",
    statut: c === ecart ? "ecart" : "ok",
  }));

const rapport = {
  fiches: [
    { frs_id: 1, titre: "Rodéos motorisés", unite: "COB Segré", code_ggd: "GGD 49", commune: "Segré",
      date_redaction: "2026-08-05", texte: "Faits constatés.", conforme: true, gravite_max: null,
      ecarts: [], controles: controles() },
    { frs_id: 2, titre: "Attroupement", unite: "BTA Cholet", code_ggd: "GGD 49", commune: "Cholet",
      date_redaction: "2026-08-05",
      texte: "Autres faits narrés ici.", conforme: false, gravite_max: "mineur",
      ecarts: [{ critere: "C10", libelle: "Fiche au-delà de dix ans de conservation", gravite: "mineur",
                 fondement: "CSI R. 236-24", source: "sql", extrait: null, explication: null, confiance: null },
               { critere: "D12", libelle: "Défaut de factualité", gravite: "mineur", fondement: "CSI R. 236-30",
                 source: "llm", extrait: "Autres faits", explication: "Jugement de valeur.", confiance: "haute" }],
      controles: controles("C10") },
  ],
  resume: { total: 2, conformes: 1, non_conformes: 1, ecarts: 2, par_gravite: { mineur: 2 }, rejets: 0 },
};

/** Stub API : respecte limit/offset comme le flux journalier (PAGE_SIZE = 10). */
function stubListe(toutes: typeof fiches = fiches) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/referentiel") && !u.includes("communes")) {
      return {
        ok: true, status: 200,
        json: async () => ({ data: { ggd: [], unites: [], mots_cles: [] } }),
      } as Response;
    }
    const qs = new URL(u, "http://x").searchParams;
    const limit = Number(qs.get("limit") || 10);
    const offset = Number(qs.get("offset") || 0);
    const slice = toutes.slice(offset, offset + limit);
    return {
      ok: true, status: 200,
      json: async () => ({ data: slice, total: toutes.length }),
    } as Response;
  }));
}

describe("AnalyseDemande — sélection", () => {
  it("liste les fiches de la base avec une case par fiche", async () => {
    stubListe();
    render(<AnalyseDemande />);
    await waitFor(() => expect(screen.getByLabelText(/Rodéos motorisés/)).toBeTruthy());
    expect(screen.getAllByRole("checkbox").length).toBe(2);
  });

  it("le compteur suit la sélection et le bouton reste inerte à zéro", async () => {
    stubListe();
    render(<AnalyseDemande />);
    await waitFor(() => expect(screen.getByLabelText(/Rodéos motorisés/)).toBeTruthy());
    expect((screen.getByRole("button", { name: /Analyser/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Rodéos motorisés/));
    expect(screen.getByLabelText("1 sur 20 fiches sélectionnées")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Analyser/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("pagine le flux comme l'onglet Flux (10 par page)", async () => {
    const vingtCinq = Array.from({ length: 25 }, (_, i) => ({
      ...fiches[0], id: i + 1, titre: "Fiche " + (i + 1),
    }));
    stubListe(vingtCinq);
    render(<AnalyseDemande />);
    await waitFor(() => expect(screen.getByLabelText(/Fiche 1 —/)).toBeTruthy());
    expect(screen.getAllByRole("checkbox").length).toBe(10);
    expect(screen.getByText("1–10 sur 25")).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Page suivante/ }));
    await waitFor(() => expect(screen.getByLabelText(/Fiche 11 —/)).toBeTruthy());
    expect(screen.getByText("11–20 sur 25")).toBeTruthy();
  });

  it("au-delà de 20 fiches, la sélection est refusée et annoncée", async () => {
    const vingtCinq = Array.from({ length: 25 }, (_, i) => ({
      ...fiches[0], id: i + 1, titre: "Fiche " + (i + 1),
    }));
    stubListe(vingtCinq);
    render(<AnalyseDemande />);
    await waitFor(() => expect(screen.getByLabelText(/Fiche 1 —/)).toBeTruthy());
    // Page 1 : 10 fiches
    for (let i = 1; i <= 10; i++) fireEvent.click(screen.getByLabelText(new RegExp(`Fiche ${i} —`)));
    fireEvent.click(screen.getByRole("button", { name: /Page suivante/ }));
    await waitFor(() => expect(screen.getByLabelText(/Fiche 11 —/)).toBeTruthy());
    // Page 2 : 10 de plus → 20
    for (let i = 11; i <= 20; i++) fireEvent.click(screen.getByLabelText(new RegExp(`Fiche ${i} —`)));
    fireEvent.click(screen.getByRole("button", { name: /Page suivante/ }));
    await waitFor(() => expect(screen.getByLabelText(/Fiche 21 —/)).toBeTruthy());
    // 21e refusée
    fireEvent.click(screen.getByLabelText(/Fiche 21 —/));
    expect(screen.getByLabelText("20 sur 20 fiches sélectionnées")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/20 fiches/);
  });
});

describe("AnalyseDemande — rapport", () => {
  const lancer = async () => {
    stubListe();
    render(<AnalyseDemande lancer={async () => rapport as never} />);
    await waitFor(() => expect(screen.getByLabelText(/Rodéos motorisés/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Rodéos motorisés/));
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
  };

  it("dit ce qui a été contrôlé pour une fiche CONFORME, pas seulement qu'elle l'est", async () => {
    await lancer();
    await waitFor(() => expect(screen.getByText(/— Conforme$/)).toBeTruthy());
    // La grille complète est affichée : sans elle, « conforme » ne dit pas sur quoi.
    expect(screen.getAllByText(/9 contrôles/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/libellé A1/).length).toBeGreaterThan(0);
  });

  it("détaille chaque écart avec son fondement et son origine", async () => {
    await lancer();
    await waitFor(() => expect(screen.getByText(/— Non conforme$/)).toBeTruthy());
    expect(screen.getAllByText("CSI R. 236-24").length).toBeGreaterThan(0);
    expect(screen.getByText(/Relevé par contrôle automatique/)).toBeTruthy();
    expect(screen.getByText(/Jugement de valeur\./)).toBeTruthy();
  });

  it("surligne l'extrait incriminé dans le texte intégral", async () => {
    await lancer();
    await waitFor(() => expect(screen.getByText(/— Non conforme$/)).toBeTruthy());
    const marque = document.body.querySelector("mark");
    expect(marque?.textContent).toBe("Autres faits");
  });

  it("annonce le résumé : combien de fiches, combien de conformes", async () => {
    await lancer();
    await waitFor(() => expect(screen.getByLabelText("1 conforme")).toBeTruthy());
    expect(screen.getByLabelText("1 non conforme")).toBeTruthy();
    expect(screen.getByLabelText("2 fiches contrôlées")).toBeTruthy();
  });

  it("une analyse en échec est annoncée, jamais confondue avec « tout conforme »", async () => {
    stubListe();
    render(<AnalyseDemande lancer={async () => { throw new Error("SORTIE_ILLISIBLE"); }} />);
    await waitFor(() => expect(screen.getByLabelText(/Rodéos motorisés/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Rodéos motorisés/));
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/résultat exploitable/i));
    expect(screen.queryByText(/— Conforme$/)).toBeNull();
  });

  it("n'utilise aucun emoji", async () => {
    await lancer();
    await waitFor(() => expect(screen.getByText(/— Non conforme$/)).toBeTruthy());
    expect(document.body.textContent || "").not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("TexteAvecExtraits", () => {
  it("surligne TOUS les extraits d'une fiche, pas seulement le premier", async () => {
    const troisEcarts = {
      ...rapport,
      fiches: [{ ...rapport.fiches[1], texte: "Alpha bravo charlie delta echo foxtrot.",
        ecarts: [
          { ...rapport.fiches[1].ecarts[0], critere: "C9", extrait: "bravo" },
          { ...rapport.fiches[1].ecarts[1], critere: "D11", extrait: "delta" },
          { ...rapport.fiches[1].ecarts[1], critere: "D12", extrait: "foxtrot" },
        ] }],
    };
    stubListe();
    render(<AnalyseDemande lancer={async () => troisEcarts as never} />);
    await waitFor(() => expect(screen.getByLabelText(/Rodéos motorisés/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Rodéos motorisés/));
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    await waitFor(() => expect(document.body.querySelectorAll("mark").length).toBe(3));
    expect([...document.body.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["bravo", "delta", "foxtrot"]);
  });

  it("un extrait absent du texte n'écrase pas les autres", async () => {
    const melange = {
      ...rapport,
      fiches: [{ ...rapport.fiches[1], texte: "Alpha bravo charlie.",
        ecarts: [
          { ...rapport.fiches[1].ecarts[0], critere: "C9", extrait: "reformulé par le modèle" },
          { ...rapport.fiches[1].ecarts[1], critere: "D11", extrait: "bravo" },
        ] }],
    };
    stubListe();
    render(<AnalyseDemande lancer={async () => melange as never} />);
    await waitFor(() => expect(screen.getByLabelText(/Rodéos motorisés/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Rodéos motorisés/));
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    await waitFor(() => expect(document.body.querySelector("mark")?.textContent).toBe("bravo"));
    expect(document.body.querySelectorAll("mark").length).toBe(1);
  });
});

it("un extrait recopié avec une autre casse est quand même surligné", async () => {
  const casse = {
    ...rapport,
    fiches: [{ ...rapport.fiches[1], texte: "Un élève de sixième a tenu des propos hostiles.",
      ecarts: [{ ...rapport.fiches[1].ecarts[0], critere: "C9", extrait: "un élève de sixième" }] }],
  };
  stubListe();
  render(<AnalyseDemande lancer={async () => casse as never} />);
  await waitFor(() => expect(screen.getByLabelText(/Rodéos motorisés/)).toBeTruthy());
  fireEvent.click(screen.getByLabelText(/Rodéos motorisés/));
  fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
  // Le surlignage porte le texte ORIGINAL, pas la casse rendue par l'agent.
  await waitFor(() => expect(document.body.querySelector("mark")?.textContent).toBe("Un élève de sixième"));
});

describe("fiche hors périmètre", () => {
  const horsPerimetre = {
    ...rapport,
    fiches: [{ ...rapport.fiches[0], hors_perimetre: true, porte_dcp: false, ecarts: [], conforme: true,
      texte: "Des dégradations ont été constatées sur du mobilier urbain." }],
    resume: { ...rapport.resume, total: 1, conformes: 1, non_conformes: 0, ecarts: 0, hors_perimetre: 1 },
  };

  it("dit POURQUOI la fiche est valide : aucune donnée à caractère personnel", async () => {
    stubListe();
    render(<AnalyseDemande lancer={async () => horsPerimetre as never} />);
    await waitFor(() => expect(screen.getByLabelText(/Rodéos motorisés/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Rodéos motorisés/));
    fireEvent.click(screen.getByRole("button", { name: /Analyser/ }));
    // Deux endroits le disent : le bandeau de résumé et la fiche elle-même. C'est voulu —
    // le premier compte, la seconde explique.
    await waitFor(() => expect(screen.getAllByText(/aucune donnée à caractère personnel/i).length).toBe(2));
    expect(screen.getByText(/Hors du champ du décret/)).toBeTruthy();
    // Le décret n'a rien à dire d'une fiche qui ne vise personne : la grille des douze
    // contrôles n'a pas de sens ici, on ne l'affiche pas comme si elle avait tourné.
    expect(screen.queryByText(/contrôles passés sur/)).toBeNull();
  });
});
