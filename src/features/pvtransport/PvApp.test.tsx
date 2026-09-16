import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CunninghamProvider } from "@gouvfr-lasuite/cunningham-react";
import PvApp from "./PvApp";
import { clear, setPieces, run, usePv } from "./pvStore";
import { encodePiece, sendPv } from "./pvApi";

vi.mock("./pvApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pvApi")>()),
  encodePiece: vi.fn(),
  sendPv: vi.fn(),
}));

// Le workflow rend désormais le PV en HTML éditable (plus de .docx).
const RESULTAT = "<h2>Saisine</h2><p>Sur instruction du parquet.</p>";

const PIECE_ENCODEE = { base64: "AA==", mime: "text/plain", filename: "notes.txt" };

const note = () => new File(["notes de terrain"], "notes.txt", { type: "text/plain" });

// La modale s'appuie sur les composants Cunningham, qui exigent le contexte du
// design system : les tests montent le même fournisseur que src/App.tsx.
function rendre() {
  return render(
    <CunninghamProvider theme="dsfr-light">
      <PvApp />
    </CunninghamProvider>
  );
}

// Rejoue la génération jusqu'au PV affiché, seul état où « Vider » existe.
async function pvGenere() {
  vi.mocked(encodePiece).mockResolvedValue(PIECE_ENCODEE);
  vi.mocked(sendPv).mockResolvedValue(RESULTAT);
  setPieces([note()]);
  await run();
  rendre();
  expect(screen.getByText("Projet de PV")).toBeTruthy();
}

// Lecture de l'état hors React : le store n'expose pas d'accesseur direct.
function etat() {
  let lu: ReturnType<typeof usePv> | undefined;
  function Sonde() {
    lu = usePv();
    return null;
  }
  render(<Sonde />);
  return lu!;
}

beforeEach(() => {
  sessionStorage.clear();
  clear();
});

afterEach(() => {
  vi.resetAllMocks();
});

test("le cadre du PV reste masqué tant qu'aucun PV n'est généré", () => {
  rendre();
  expect(screen.queryByText("Projet de PV")).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

test("la barre de progression s'affiche pendant la génération, pas après", async () => {
  // Génération suspendue : on observe l'état intermédiaire.
  let terminer!: (r: string) => void;
  vi.mocked(encodePiece).mockResolvedValue(PIECE_ENCODEE);
  vi.mocked(sendPv).mockReturnValue(new Promise((resoudre) => (terminer = resoudre)));

  rendre();
  setPieces([note()]);
  run();

  await waitFor(() => expect(screen.getByRole("progressbar")).toBeTruthy());
  expect(screen.queryByText("Projet de PV")).toBeNull();

  terminer(RESULTAT);

  await waitFor(() => expect(screen.getByText("Projet de PV")).toBeTruthy());
  expect(screen.queryByRole("progressbar")).toBeNull();
  // La sortie exploitable : éditeur + export PDF (comme la page d'analyse).
  expect(screen.getByRole("button", { name: /Exporter en PDF/ })).toBeTruthy();
});

describe("PvApp — confirmation avant de vider", () => {
  it("le clic sur Vider ouvre une confirmation et n'efface rien", async () => {
    await pvGenere();
    fireEvent.click(screen.getByRole("button", { name: "Vider" }));
    expect(screen.getByText("Projet de PV")).toBeTruthy();
    expect(etat().resultat).toBeTruthy();
  });

  it("la confirmation nomme le projet de PV et les notes perdus", async () => {
    await pvGenere();
    fireEvent.click(screen.getByRole("button", { name: "Vider" }));
    const message = screen.getByText(/Vider efface/);
    expect(message.textContent).toMatch(/procès-verbal|projet de PV/i);
    expect(message.textContent).toMatch(/notes/i);
  });

  it("confirmer efface le projet de PV", async () => {
    await pvGenere();
    fireEvent.click(screen.getByRole("button", { name: "Vider" }));
    fireEvent.click(screen.getByRole("button", { name: "Vider le projet" }));
    expect(screen.queryByText("Projet de PV")).toBeNull();
    expect(etat().resultat).toBeNull();
  });

  it("annuler laisse le projet de PV intact et referme la confirmation", async () => {
    await pvGenere();
    fireEvent.click(screen.getByRole("button", { name: "Vider" }));
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByText("Projet de PV")).toBeTruthy();
    expect(etat().resultat).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vider le projet" })).toBeNull();
  });
});
