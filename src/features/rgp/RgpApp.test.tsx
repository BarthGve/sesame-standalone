import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CunninghamProvider } from "@gouvfr-lasuite/cunningham-react";
import RgpApp from "./RgpApp";
import { clear, snapshotForTest } from "./rgpStore";
import * as api from "./rgpApi";

describe("RgpApp", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Le store est un singleton de module : on repart d'une conversation vide
    // (et d'un sessionStorage propre) à chaque test.
    sessionStorage.clear();
    clear();
  });

  it("envoie le prompt et affiche le résultat", async () => {
    vi.spyOn(api, "sendRgpPrompt").mockResolvedValue({
      text: "", message: "Procédure **15127/126/2026** créée (PVEJ).",
      parsed: { data: { una: "15127/126/2026", type: "PVEJ" } },
    });
    render(<RgpApp />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "crée un PV" } });
    fireEvent.click(screen.getByRole("button", { name: /envoyer/i }));
    await waitFor(() => expect(screen.getByText(/15127\/126\/2026/)).toBeInTheDocument());
    expect(api.sendRgpPrompt).toHaveBeenCalledWith("crée un PV");
  });

  it("affiche une erreur si l'appel échoue", async () => {
    vi.spyOn(api, "sendRgpPrompt").mockRejectedValue(new Error("IAKA_TIMEOUT"));
    render(<RgpApp />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /envoyer/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  // --- Confirmation avant de vider -------------------------------------------
  // La modale s'appuie sur les composants Cunningham, qui exigent le contexte du
  // design system : ces tests montent le même fournisseur que src/App.tsx.
  async function conversationEnCours() {
    vi.spyOn(api, "sendRgpPrompt").mockResolvedValue({
      text: "", message: "Procédure **15127/126/2026** créée (PVEJ).",
      parsed: { data: { una: "15127/126/2026", type: "PVEJ" } },
    });
    render(
      <CunninghamProvider theme="dsfr-light">
        <RgpApp />
      </CunninghamProvider>
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "crée un PV" } });
    fireEvent.click(screen.getByRole("button", { name: /envoyer/i }));
    await waitFor(() => expect(screen.getByText(/15127\/126\/2026/)).toBeInTheDocument());
  }

  it("le clic sur Vider ouvre une confirmation et n'efface rien", async () => {
    await conversationEnCours();
    fireEvent.click(screen.getByRole("button", { name: "Vider" }));
    expect(screen.getByText(/15127\/126\/2026/)).toBeInTheDocument();
    expect(snapshotForTest().echanges).toHaveLength(1);
  });

  it("la confirmation nomme les échanges perdus et rassure sur les procédures créées", async () => {
    await conversationEnCours();
    fireEvent.click(screen.getByRole("button", { name: "Vider" }));
    const message = screen.getByText(/Vider efface/);
    expect(message.textContent).toMatch(/échanges|conversation/i);
    expect(message.textContent).toMatch(/procédures déjà créées/i);
  });

  it("confirmer efface la conversation", async () => {
    await conversationEnCours();
    fireEvent.click(screen.getByRole("button", { name: "Vider" }));
    fireEvent.click(screen.getByRole("button", { name: "Vider la conversation" }));
    expect(screen.queryByText(/15127\/126\/2026/)).not.toBeInTheDocument();
    expect(screen.queryByText(/crée un PV/)).not.toBeInTheDocument();
    expect(snapshotForTest().echanges).toHaveLength(0);
  });

  it("annuler laisse la conversation intacte et referme la confirmation", async () => {
    await conversationEnCours();
    fireEvent.click(screen.getByRole("button", { name: "Vider" }));
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByText(/15127\/126\/2026/)).toBeInTheDocument();
    expect(snapshotForTest().echanges).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Vider la conversation" })).toBeNull();
  });
});
