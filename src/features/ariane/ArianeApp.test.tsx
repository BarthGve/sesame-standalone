import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RagEtat } from "./arianeApi";

vi.mock("cytoscape", () => ({ default: vi.fn(() => ({ on: vi.fn(), destroy: vi.fn() })) }));

const DOSSIER = {
  affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: null, fin: null }, nb_cotes: 1 },
  synthese: "Synthese consolidee du dossier", parties: [], evenements: [], actes: [], relations: [],
};

// Rejoue le pipeline jusqu'au dossier affiche, avec l'etat RAG voulu.
function mockApi(rag: RagEtat) {
  vi.doMock("./arianeApi", () => ({
    ACCEPT_ATTR: ".pdf", TAILLE_MAX_OCTETS: 20 * 1024 * 1024,
    encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
    startAnalyse: vi.fn().mockResolvedValue("j1"),
    fetchStatus: vi.fn().mockResolvedValue({ status: "done", progress: { done: 1, total: 1 }, result: DOSSIER, rag }),
  }));
}

describe("ArianeApp", () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetModules(); });

  it("état initial : titre + zone de dépôt, pas de vues", async () => {
    const { default: ArianeApp } = await import("./ArianeApp");
    render(<ArianeApp />);
    expect(screen.getByRole("heading", { name: /Analyse de procédure|Ariane/i })).toBeTruthy();
    expect(screen.getByLabelText(/pièces|procédure/i)).toBeTruthy();
  });

  it("avertit quand des pièces ont été écartées de l'analyse", async () => {
    const dossier = { affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: null, fin: null }, nb_cotes: 1 }, synthese: "s", parties: [], evenements: [], actes: [], relations: [] };
    vi.doMock("./arianeApi", () => ({
      ACCEPT_ATTR: ".pdf", TAILLE_MAX_OCTETS: 20 * 1024 * 1024,
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn().mockResolvedValue({
        status: "done", progress: { done: 2, total: 2 }, result: dossier,
        pieces_ignorees: [{ cote: "D2", raison: "ARIANE_TIMEOUT" }],
      }),
    }));
    const store = await import("./arianeStore");
    const { default: ArianeApp } = await import("./ArianeApp");
    store.setPieces([new File([new Uint8Array([1])], "D1.pdf", { type: "application/pdf" }),
                     new File([new Uint8Array([1])], "D2.pdf", { type: "application/pdf" })]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    render(<ArianeApp />);
    const alerte = screen.getByRole("alert");
    expect(alerte.textContent).toMatch(/D2/);
    expect(alerte.textContent).toMatch(/1 pièce sur 2/i);
  });

  it("affiche les avertissements de métadonnées dans le bandeau", async () => {
    const dossier = { affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: null, fin: null }, nb_cotes: 1 }, synthese: "s", parties: [], evenements: [], actes: [], relations: [] };
    vi.doMock("./arianeApi", () => ({
      ACCEPT_ATTR: ".pdf", TAILLE_MAX_OCTETS: 20 * 1024 * 1024,
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn().mockResolvedValue({
        status: "done", progress: { done: 1, total: 1 }, result: dossier,
        avertissements: ["Type de piece inconnu : PVInconnu"],
      }),
    }));
    const store = await import("./arianeStore");
    const { default: ArianeApp } = await import("./ArianeApp");
    store.setPieces([new File([new Uint8Array([1])], "D1.pdf", { type: "application/pdf" })]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    render(<ArianeApp />);
    expect(screen.getByRole("alert").textContent).toMatch(/PVInconnu/);
  });

  it("grise l'onglet Questions tant qu'aucune piece n'est indexee", async () => {
    mockApi({ indexees: 0, total: 1, erreur: "ARIANE_RAG_INDISPONIBLE" });
    const store = await import("./arianeStore");
    const { default: ArianeApp } = await import("./ArianeApp");
    store.setPieces([new File([new Uint8Array([1])], "D1.pdf", { type: "application/pdf" })]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    render(<ArianeApp />);
    expect(screen.getByRole("button", { name: /Questions/i }).hasAttribute("disabled")).toBe(true);
  });

  it("active l'onglet Questions des qu'une piece est indexee et ouvre le chat", async () => {
    mockApi({ indexees: 1, total: 1, erreur: null });
    const store = await import("./arianeStore");
    const { default: ArianeApp } = await import("./ArianeApp");
    store.setPieces([new File([new Uint8Array([1])], "D1.pdf", { type: "application/pdf" })]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    render(<ArianeApp />);
    const onglet = screen.getByRole("button", { name: /Questions/i });
    expect(onglet.hasAttribute("disabled")).toBe(false);
    fireEvent.click(onglet);
    expect(screen.getByLabelText(/question/i)).toBeTruthy();
  });

  // --- Confirmation avant de vider -------------------------------------------
  // Rejoue le pipeline jusqu'au dossier affiche, avec la purge du corpus voulue.
  // Le fournisseur Cunningham (exige par la modale) est importe dynamiquement :
  // apres `vi.resetModules()`, un import statique donnerait une autre instance du
  // module, donc un autre contexte React, et la modale ne le trouverait pas.
  async function dossierAffiche(purge: () => Promise<unknown>) {
    vi.doMock("./arianeChatApi", () => ({ streamChat: vi.fn(), purgeCorpusApi: vi.fn(purge) }));
    mockApi({ indexees: 1, total: 1, erreur: null });
    const store = await import("./arianeStore");
    const { default: ArianeApp } = await import("./ArianeApp");
    const { CunninghamProvider } = await import("@gouvfr-lasuite/cunningham-react");
    store.setPieces([new File([new Uint8Array([1])], "D1.pdf", { type: "application/pdf" })]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    render(
      <CunninghamProvider theme="dsfr-light">
        <ArianeApp />
      </CunninghamProvider>
    );
    return store;
  }

  it("Vider : le clic ouvre une confirmation, ne purge rien et n'efface rien", async () => {
    const purgeCorpusApi = vi.fn().mockResolvedValue(1);
    const store = await dossierAffiche(purgeCorpusApi);

    fireEvent.click(screen.getByRole("button", { name: "Vider" }));

    expect(purgeCorpusApi).not.toHaveBeenCalled();
    expect(screen.getByText(/Synthese consolidee du dossier/)).toBeTruthy();
    expect(store.snapshotForTest().dossier).toBeTruthy();
  });

  it("Vider : la confirmation annonce la purge irreversible du corpus cote serveur", async () => {
    await dossierAffiche(() => Promise.resolve(1));

    fireEvent.click(screen.getByRole("button", { name: "Vider" }));

    const message = screen.getByText(/Vider efface/);
    expect(message.textContent).toMatch(/corpus/i);
    expect(message.textContent).toMatch(/irr[ée]versible/i);
    expect(message.textContent).toMatch(/serveur/i);
  });

  it("Vider : annuler laisse le dossier et le corpus intacts", async () => {
    const purgeCorpusApi = vi.fn().mockResolvedValue(1);
    const store = await dossierAffiche(purgeCorpusApi);

    fireEvent.click(screen.getByRole("button", { name: "Vider" }));
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));

    expect(purgeCorpusApi).not.toHaveBeenCalled();
    expect(screen.getByText(/Synthese consolidee du dossier/)).toBeTruthy();
    expect(store.snapshotForTest().dossier).toBeTruthy();
    expect(store.snapshotForTest().rag.total).toBe(1);
    expect(screen.queryByRole("button", { name: "Vider et purger" })).toBeNull();
  });

  it("Vider : si la purge du corpus echoue, rien n'est reinitialise et l'utilisateur est averti", async () => {
    const store = await dossierAffiche(() => Promise.reject(new Error("ARIANE_RAG_PURGE")));

    fireEvent.click(screen.getByRole("button", { name: "Vider" }));
    fireEvent.click(screen.getByRole("button", { name: "Vider et purger" }));

    // L'utilisateur est averti que les pieces sont restees dans le corpus.
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toMatch(/corpus/i);
    // Et l'ecran n'a pas ete nettoye : le dossier et l'etat RAG sont intacts.
    expect(screen.getByText(/Synthese consolidee du dossier/)).toBeTruthy();
    const etat = store.snapshotForTest();
    expect(etat.dossier).toBeTruthy();
    expect(etat.rag.total).toBe(1);
    expect(etat.pieces.length).toBe(1);
  });

  it("Vider : purge reussie, le dossier disparait", async () => {
    const store = await dossierAffiche(() => Promise.resolve(1));

    fireEvent.click(screen.getByRole("button", { name: "Vider" }));
    fireEvent.click(screen.getByRole("button", { name: "Vider et purger" }));

    await vi.waitFor(() => expect(store.snapshotForTest().dossier).toBeUndefined());
    expect(screen.queryByText(/Synthese consolidee du dossier/)).toBeNull();
    expect(store.snapshotForTest().rag.total).toBe(0);
  });
});
