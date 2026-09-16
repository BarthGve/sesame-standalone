import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import EvaluationApp from "./EvaluationApp";
import { clear, setUna, charger, evaluer, lireEtat } from "./evaluationStore";
import type { ApiObjet } from "../saisies/perquisitionApi";

const objet = (id: number): ApiObjet => ({
  id,
  categorie: "TRANSPORT",
  sous_type: "VEHICULE_TERRESTRE",
  champs: [
    { cle: "marque", libelle: "Marque", valeur: "RENAULT", source: "deduit", obligatoire: false },
    { cle: "modele", libelle: "Modèle", valeur: "Clio", source: "deduit", obligatoire: false },
  ],
  identifiants: [],
});

function fetchFactice(nbVehicules: number, nbAutres = 0) {
  const objets = [
    ...Array.from({ length: nbVehicules }, (_, i) => objet(i + 1)),
    ...Array.from({ length: nbAutres }, (_, i) => ({ ...objet(100 + i), categorie: "ARME", sous_type: null })),
  ];
  return (async (url: string) => {
    if (url.startsWith("/api/perquisitions"))
      return { ok: true, json: async () => ({ data: [{ id: 10, adresse: "3 rue A", created_at: "2026-01-01", nb_objets: objets.length }] }) };
    return { ok: true, json: async () => ({ data: { id: 10, objets } }) };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  clear();
  sessionStorage.clear();
  // L'écran charge la liste des procédures dès le montage : sans ce filet, chaque
  // rendu déclencherait un vrai appel réseau (URL relative, hors jsdom) et
  // entrerait en concurrence avec les appels explicites des tests.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("l'ecran s'ouvre sur la liste des procedures, sans aucun objet coché", () => {
  render(<EvaluationApp />);
  expect(screen.getByText("Évaluation des avoirs")).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

test("apres chargement, les vehicules sont listes et le compte des autres objets affiche", async () => {
  render(<EvaluationApp />);
  act(() => setUna("12345/00042/2026"));
  await act(async () => { await charger(fetchFactice(2, 3)); });
  await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
  expect(screen.getByText(/3 autres objets/)).toBeTruthy();
});

test("le bouton d'evaluation reste inactif tant qu'aucun vehicule n'est coche", async () => {
  render(<EvaluationApp />);
  act(() => setUna("12345/00042/2026"));
  await act(async () => { await charger(fetchFactice(2)); });
  const bouton = screen.getByRole("button", { name: /Évaluer la sélection/ }) as HTMLButtonElement;
  expect(bouton.disabled).toBe(true);
  await act(async () => { screen.getAllByRole("checkbox")[0].click(); });
  expect((screen.getByRole("button", { name: /Évaluer la sélection/ }) as HTMLButtonElement).disabled).toBe(false);
});

test("une erreur de chargement s'affiche sans vider le champ UNA", async () => {
  const impl = (async () => ({ ok: true, json: async () => ({ error: { message: "UNA introuvable" } }) })) as unknown as typeof fetch;
  render(<EvaluationApp />);
  act(() => setUna("12345/00099/2026"));
  await act(async () => { await charger(impl); });
  expect(screen.getByRole("alert").textContent).toMatch(/UNA introuvable/);
  expect(lireEtat().una).toBe("12345/00099/2026");
});

test("la liste des procedures exploitables s'affiche au chargement de l'ecran", async () => {
  const unas = [
    { una: "12345/00042/2026", groupe: "Groupe 1", synthese: "Cambriolages", urgent: false, sensible: false, nbPerquisitions: 1, nbObjets: 3 },
  ];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: unas }) })));
  render(<EvaluationApp />);
  await waitFor(() => expect(screen.getByText(/12345\/00042\/2026/)).toBeTruthy());
  expect(screen.getByText(/Cambriolages/)).toBeTruthy();
});

test("choisir une procedure dans la liste la sélectionne", async () => {
  const unas = [
    { una: "12345/00042/2026", groupe: null, synthese: null, urgent: false, sensible: false, nbPerquisitions: 1, nbObjets: 3 },
  ];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: unas }) })));
  render(<EvaluationApp />);
  await waitFor(() => expect(screen.getByRole("button", { name: /12345\/00042\/2026/ })).toBeTruthy());
  await act(async () => { screen.getByRole("button", { name: /12345\/00042\/2026/ }).click(); });
  expect(lireEtat().una).toBe("12345/00042/2026");
});

test("le bouton lance l'evaluation et la barre d'attente s'affiche", async () => {
  const resultat = {
    evaluations: [{ objet_id: 1, enregistre: true,
      estimation_prix: { prix_bas: 9000, prix_moyen: 10000, prix_haut: 11000, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.7, avertissement: "Simulée." } }],
    non_evalues: [], total: { bas: 9000, moyen: 10000, haut: 11000 }, pv_evaluation: "## PV d'évaluation",
  };
  let i = 0;
  const reponses: unknown[] = [{ jobId: "j" }, { status: "done", result: resultat }];
  const impl = (async (url: string) => {
    if (url.startsWith("/api/evaluation/unas")) return { ok: true, json: async () => ({ data: [] }) };
    if (url.startsWith("/api/perquisitions")) return { ok: true, json: async () => ({ data: [{ id: 10, adresse: "A", created_at: "", nb_objets: 1 }] }) };
    if (url.startsWith("/api/perquisition?")) return { ok: true, json: async () => ({ data: { id: 10, objets: [
      { id: 1, categorie: "TRANSPORT", sous_type: "VEHICULE_TERRESTRE", champs: [], identifiants: [] },
    ] } }) };
    return { ok: true, json: async () => reponses[Math.min(i++, 1)] };
  }) as unknown as typeof fetch;

  render(<EvaluationApp />);
  act(() => setUna("12345/00042/2026"));
  await act(async () => { await charger(impl); });
  await act(async () => { screen.getAllByRole("checkbox")[0].click(); });

  vi.useFakeTimers();
  const p = act(async () => { await evaluer(impl); });
  await vi.advanceTimersByTimeAsync(3000);
  await p;
  vi.useRealTimers();

  expect(screen.getByText(/Total estimé des avoirs/i)).toBeTruthy();
  expect(screen.getByLabelText("Résultat de l'évaluation")).toBeTruthy();
});

// Les engrenages de construction n'existent QUE pendant l'exécution : à vérifier
// en vol, pas après coup.
test("les engrenages s'affichent pendant l'evaluation, puis disparaissent", async () => {
  const resultat = {
    evaluations: [{ objet_id: 1, enregistre: true,
      estimation_prix: { prix_bas: 9000, prix_moyen: 10000, prix_haut: 11000, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.7, avertissement: "Simulée." } }],
    // pv distinct du titre « PV d'évaluation » de l'éditeur : le Markdown est
    // converti en HTML et rendu dans TipTap, un intitulé identique s'y
    // dupliquerait à l'écran.
    non_evalues: [], total: { bas: 9000, moyen: 10000, haut: 11000 }, pv_evaluation: "## Objets évalués",
  };
  let i = 0;
  const reponses: unknown[] = [{ jobId: "j" }, { status: "done", result: resultat }];
  const impl = (async (url: string) => {
    if (url.startsWith("/api/evaluation/unas")) return { ok: true, json: async () => ({ data: [] }) };
    if (url.startsWith("/api/perquisitions")) return { ok: true, json: async () => ({ data: [{ id: 10, adresse: "A", created_at: "", nb_objets: 1 }] }) };
    if (url.startsWith("/api/perquisition?")) return { ok: true, json: async () => ({ data: { id: 10, objets: [
      { id: 1, categorie: "TRANSPORT", sous_type: "VEHICULE_TERRESTRE", champs: [], identifiants: [] },
    ] } }) };
    return { ok: true, json: async () => reponses[Math.min(i++, 1)] };
  }) as unknown as typeof fetch;

  render(<EvaluationApp />);
  act(() => setUna("12345/00042/2026"));
  await act(async () => { await charger(impl); });
  await act(async () => { screen.getAllByRole("checkbox")[0].click(); });

  vi.useFakeTimers();
  const p = act(async () => { await evaluer(impl); });
  // Le job n'a pas encore rendu : les engrenages de construction doivent être à l'écran.
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByLabelText("Évaluation en cours")).toBeTruthy();
  await vi.advanceTimersByTimeAsync(3000);
  await p;
  vi.useRealTimers();

  expect(screen.queryByLabelText("Évaluation en cours")).toBeNull();
  // Éditeur de PV et export : la sortie exploitable de l'écran.
  expect(screen.getByText("PV d'évaluation")).toBeTruthy();
  // Le Markdown du PV est rendu comme HTML dans l'éditeur (titre, pas « ## »).
  expect(screen.getByRole("heading", { name: "Objets évalués" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Exporter le PV en PDF/ })).toBeTruthy();
});

// L'absence de perquisition et l'absence de véhicule sont deux diagnostics
// différents : annoncer le second pour le premier envoie l'enquêteur chercher
// des objets là où aucune opération n'a eu lieu.
test("une procedure sans perquisition le dit explicitement", async () => {
  const impl = (async (url: string) => {
    if (url.startsWith("/api/perquisitions")) return { ok: true, json: async () => ({ data: [] }) };
    return { ok: true, json: async () => ({ data: [] }) };
  }) as unknown as typeof fetch;
  render(<EvaluationApp />);
  act(() => setUna("12345/00099/2026"));
  await act(async () => { await charger(impl); });
  expect(screen.getByText("Aucune perquisition dans cette procédure.")).toBeTruthy();
  expect(screen.queryByText(/Aucun véhicule terrestre/)).toBeNull();
  expect(screen.queryByText(/perquisition\(s\) —/)).toBeNull();
});

// Une évaluation réussie affiche le résultat, ses avertissements obligatoires
// (un véhicule coché mais non traité) et la mention indicative — sans relecture
// de base : dans ce démonstrateur, l'évaluation n'écrit rien.
test("une evaluation reussie affiche le resultat et ses avertissements", async () => {
  // L'agent ne rend que l'objet 1 ; l'objet 2, coché, ressort « non traité ».
  const resultat = {
    evaluations: [{ objet_id: 1,
      estimation_prix: { prix_bas: 9000, prix_moyen: 10000, prix_haut: 11000, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.7, avertissement: "Simulée." } }],
    non_evalues: [], total: { bas: 9000, moyen: 10000, haut: 11000 }, pv_evaluation: "## PV",
  };
  let i = 0;
  const reponses: unknown[] = [{ jobId: "j" }, { status: "done", result: resultat }];
  const impl = (async (url: string) => {
    if (url.startsWith("/api/evaluation/unas")) return { ok: true, json: async () => ({ data: [] }) };
    if (url.startsWith("/api/perquisitions"))
      return { ok: true, json: async () => ({ data: [{ id: 10, adresse: "A", created_at: "", nb_objets: 2 }] }) };
    if (url.startsWith("/api/perquisition?")) return { ok: true, json: async () => ({ data: { id: 10, objets: [
      { id: 1, categorie: "TRANSPORT", sous_type: "VEHICULE_TERRESTRE", champs: [], identifiants: [] },
      { id: 2, categorie: "TRANSPORT", sous_type: "VEHICULE_TERRESTRE", champs: [], identifiants: [] },
    ] } }) };
    return { ok: true, json: async () => reponses[Math.min(i++, 1)] };
  }) as unknown as typeof fetch;

  render(<EvaluationApp />);
  act(() => setUna("12345/00042/2026"));
  await act(async () => { await charger(impl); });
  await act(async () => { screen.getAllByRole("checkbox")[0].click(); });
  await act(async () => { screen.getAllByRole("checkbox")[1].click(); });

  vi.useFakeTimers();
  const p = act(async () => { await evaluer(impl); });
  await vi.advanceTimersByTimeAsync(3000);
  await p;
  vi.useRealTimers();

  // Le résultat s'affiche...
  expect(screen.getByLabelText("Résultat de l'évaluation")).toBeTruthy();
  // ...son avertissement obligatoire aussi (objet 2 jamais traité)...
  expect(screen.getByText(/n'ont pas été traités/i)).toBeTruthy();
  // ...ainsi que la mention indicative « non enregistrée dans la procédure »...
  expect(screen.getByText(/non enregistrée dans la procédure/i)).toBeTruthy();
  // ...et aucun bandeau d'erreur d'évaluation.
  expect(screen.queryByRole("alert")).toBeNull();
});

test("sans resultat, ni le PV ni le total ne s'affichent", async () => {
  render(<EvaluationApp />);
  expect(screen.queryByLabelText("Résultat de l'évaluation")).toBeNull();
  expect(screen.queryByText(/PV d'évaluation/)).toBeNull();
});
