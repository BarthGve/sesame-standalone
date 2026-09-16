import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@testing-library/jest-dom/vitest";

vi.mock("../rens/RensApp", () => ({
  default: ({ section }: { section?: string }) => (
    <div data-testid="rens-panel">rens:{section ?? "all"}</div>
  ),
}));

vi.mock("../qualite/QualiteApp", () => ({
  QualiteApp: ({ mode }: { mode?: string }) => (
    <div data-testid="qualite-panel">qualite:{mode ?? "full"}</div>
  ),
}));

import FrsApp from "./FrsApp";
import { setOnglet, setContexte } from "./frsUiStore";

function renderFrs(path = "/app/frs") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/frs" element={<FrsApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FrsApp", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setOnglet("flux");
    setContexte({ jour: null, ggd: "" });
  });

  it("affiche le flux par défaut et le titre unifié", async () => {
    renderFrs();
    expect(screen.getByRole("heading", { name: /Fiches de renseignement/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("rens-panel")).toHaveTextContent("rens:flux"));
  });

  it("bascule vers le contrôle qualité", async () => {
    renderFrs();
    fireEvent.click(screen.getByRole("button", { name: /Contrôle/i }));
    await waitFor(() => expect(screen.getByTestId("qualite-panel")).toHaveTextContent("qualite:controle"));
  });

  it("honore ?onglet=rediger", async () => {
    renderFrs("/app/frs?onglet=rediger");
    await waitFor(() => expect(screen.getByTestId("qualite-panel")).toHaveTextContent("qualite:rediger"));
  });

  it("affiche le contexte partagé jour / GGD", async () => {
    setContexte({ jour: "2026-08-07", ggd: "GGD 49" });
    renderFrs();
    expect(screen.getByText(/Contexte/)).toBeInTheDocument();
    expect(screen.getByText("07/08/2026")).toBeInTheDocument();
    expect(screen.getByText("GGD 49")).toBeInTheDocument();
  });
});
