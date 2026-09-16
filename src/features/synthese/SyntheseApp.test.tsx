import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CunninghamProvider } from "@gouvfr-lasuite/cunningham-react";
import SyntheseApp from "./SyntheseApp";
import { setPieces, setHtml, clear, lireEtat } from "./syntheseStore";
import { pdfAvecXml, pdfSansPieceJointe } from "../../test/pdfAvecXml";
import XML_LRPGN from "../../fixtures/lrpgn-audition.xml?raw";

beforeEach(() => {
  clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("badge et fiche apparaissent quand la pièce porte un XML LRPGN", async () => {
  render(<SyntheseApp />);
  setPieces([await pdfAvecXml(XML_LRPGN)]);
  await vi.waitFor(() => {
    expect(screen.getByText(/Données LRPGN détectées/)).toBeTruthy();
  });
  expect(screen.getByText(/BIDULE Marc/)).toBeTruthy();
  expect(screen.getByText("VICTIME")).toBeTruthy();
});

test("pièce sans XML : ni badge ni fiche, écran inchangé", async () => {
  render(<SyntheseApp />);
  setPieces([await pdfSansPieceJointe()]);
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText(/Données LRPGN détectées/)).toBeNull();
  expect(screen.queryByLabelText("Contexte de la procédure")).toBeNull();
  expect(screen.getByRole("button", { name: /Analyser/ })).toBeTruthy();
});

test("XML LRPGN sans contenu exploitable : contexte vide, ni badge ni fiche", async () => {
  render(<SyntheseApp />);
  const xmlVide = '<?xml version="1.0" encoding="UTF-8"?><Procedure></Procedure>';
  setPieces([await pdfAvecXml(xmlVide)]);
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText(/Données LRPGN détectées/)).toBeNull();
  expect(screen.queryByLabelText("Contexte de la procédure")).toBeNull();
});

test("XML LRPGN avec une personne aux champs tous vides : ni badge ni fiche", async () => {
  render(<SyntheseApp />);
  const xmlPersonneVide =
    '<?xml version="1.0" encoding="UTF-8"?><Procedure><Personnes_Physiques><Personne></Personne></Personnes_Physiques></Procedure>';
  setPieces([await pdfAvecXml(xmlPersonneVide)]);
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText(/Données LRPGN détectées/)).toBeNull();
  expect(screen.queryByLabelText("Contexte de la procédure")).toBeNull();
});

test("le cadre Proposition n'apparaît qu'une fois l'analyse rendue", () => {
  render(<SyntheseApp />);
  expect(screen.queryByText("Proposition")).toBeNull();
  act(() => setHtml("<h2>Faits</h2>"));
  expect(screen.getByText("Proposition")).toBeTruthy();
});

// Intercepte pdfmake : on vérifie ce qui part dans le PDF et sous quel nom,
// sans produire de binaire.
const documentsPdf: { def: any; nom: string }[] = [];

vi.mock("pdfmake/build/pdfmake", () => ({
  default: {
    addVirtualFileSystem: () => {},
    fonts: {},
    createPdf: (def: any) => ({
      download: (nom: string) => documentsPdf.push({ def, nom }),
    }),
  },
}));
vi.mock("pdfmake/build/vfs_fonts", () => ({ default: {} }));

// Texte de tous les blocs du document, à plat.
const texteDuPdf = (def: any) => JSON.stringify(def.content);

test("l'export PDF telecharge un document reprenant contexte et proposition", async () => {
  documentsPdf.length = 0;
  render(<SyntheseApp />);
  setPieces([await pdfAvecXml(XML_LRPGN)]);
  await vi.waitFor(() => expect(screen.getByText(/Données LRPGN détectées/)).toBeTruthy());
  act(() => setHtml("<h2>Faits</h2><p>Le témoin déclare.</p>"));

  screen.getByRole("button", { name: /Exporter en PDF/ }).click();
  await vi.waitFor(() => expect(documentsPdf).toHaveLength(1));

  const contenu = texteDuPdf(documentsPdf[0].def);
  expect(contenu).toContain("BIDULE");
  expect(contenu).toContain("Le témoin déclare.");
  // Le contexte précède la proposition rédigée.
  expect(contenu.indexOf("BIDULE")).toBeLessThan(contenu.indexOf("Le témoin déclare."));
  // Le nom de fichier reprend la personne entendue.
  expect(documentsPdf[0].nom).toBe("analyse-audition-BIDULE-Marc.pdf");
});

// Capture ce qui part au presse-papier, sans dépendre de l'API réelle
// (ClipboardItem n'existe pas sous jsdom).
function pressePapierFactice() {
  const items: Record<string, Blob>[] = [];
  vi.stubGlobal(
    "ClipboardItem",
    class {
      constructor(parts: Record<string, Blob>) {
        items.push(parts);
      }
    }
  );
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: { write: vi.fn(async () => {}), writeText: vi.fn() },
  });
  return items;
}

// jsdom ne lit pas ses propres Blob via Response : on passe par FileReader.
const lire = (blob: Blob) =>
  new Promise<string>((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(String(lecteur.result));
    lecteur.onerror = () => rejeter(lecteur.error);
    lecteur.readAsText(blob);
  });

test("la copie presse-papier reprend le cartouche de contexte", async () => {
  render(<SyntheseApp />);
  setPieces([await pdfAvecXml(XML_LRPGN)]);
  await vi.waitFor(() => expect(screen.getByText(/Données LRPGN détectées/)).toBeTruthy());
  act(() => setHtml("<p>Le témoin déclare.</p>"));

  const items = pressePapierFactice();
  screen.getByRole("button", { name: /Copier dans le presse-papier/ }).click();
  await vi.waitFor(() => expect(items).toHaveLength(1));

  const enrichi = await lire(items[0]["text/html"]);
  const brut = await lire(items[0]["text/plain"]);
  expect(enrichi).toContain("BIDULE");
  expect(enrichi).toContain("Le témoin déclare.");
  expect(brut).toContain("BIDULE");
  expect(brut).toContain("Le témoin déclare.");
});

test("la copie presse-papier sans XML ne contient que la proposition", async () => {
  render(<SyntheseApp />);
  setPieces([await pdfSansPieceJointe()]);
  await new Promise((r) => setTimeout(r, 20));
  act(() => setHtml("<p>Le témoin déclare.</p>"));

  const items = pressePapierFactice();
  screen.getByRole("button", { name: /Copier dans le presse-papier/ }).click();
  await vi.waitFor(() => expect(items).toHaveLength(1));

  const enrichi = await lire(items[0]["text/html"]);
  expect(enrichi).toContain("Le témoin déclare.");
  expect(enrichi).not.toContain("Contexte de la procédure");
});

test("l'export PDF sans XML ne contient que la proposition", async () => {
  documentsPdf.length = 0;
  render(<SyntheseApp />);
  setPieces([await pdfSansPieceJointe()]);
  await new Promise((r) => setTimeout(r, 20));
  act(() => setHtml("<p>Le témoin déclare.</p>"));

  screen.getByRole("button", { name: /Exporter en PDF/ }).click();
  await vi.waitFor(() => expect(documentsPdf).toHaveLength(1));

  const contenu = texteDuPdf(documentsPdf[0].def);
  expect(contenu).toContain("Le témoin déclare.");
  expect(contenu).not.toContain("Personne entendue");
  // Sans identité connue, nom de fichier générique.
  expect(documentsPdf[0].nom).toBe("analyse-audition.pdf");
});

// --- Confirmation avant de vider ---------------------------------------------
// La modale s'appuie sur les composants Cunningham, qui exigent le contexte du
// design system : ces tests montent le même fournisseur que src/App.tsx.
function rendreAvecDesignSystem() {
  return render(
    <CunninghamProvider theme="dsfr-light">
      <SyntheseApp />
    </CunninghamProvider>
  );
}

// Pose une analyse rendue à l'écran, prête à être vidée.
function analyseAffichee() {
  rendreAvecDesignSystem();
  act(() => setHtml("<p>Le témoin déclare.</p>"));
}

test("Vider : le clic ouvre une confirmation et n'efface rien", () => {
  analyseAffichee();
  fireEvent.click(screen.getByRole("button", { name: "Vider" }));
  expect(lireEtat().html).toBe("<p>Le témoin déclare.</p>");
  expect(screen.getByText("Proposition")).toBeTruthy();
});

test("Vider : la confirmation nomme l'analyse perdue et ne promet aucune suppression serveur", () => {
  analyseAffichee();
  fireEvent.click(screen.getByRole("button", { name: "Vider" }));
  const message = screen.getByText(/Vider efface/);
  expect(message.textContent).toMatch(/analyse/i);
  expect(message.textContent).toMatch(/pièce/i);
});

test("Vider : confirmer efface l'analyse", () => {
  analyseAffichee();
  fireEvent.click(screen.getByRole("button", { name: "Vider" }));
  fireEvent.click(screen.getByRole("button", { name: "Vider l'analyse" }));
  expect(lireEtat().html).toBe("");
  expect(screen.queryByText("Proposition")).toBeNull();
});

test("Vider : annuler laisse l'analyse intacte et referme la confirmation", () => {
  analyseAffichee();
  fireEvent.click(screen.getByRole("button", { name: "Vider" }));
  fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
  expect(lireEtat().html).toBe("<p>Le témoin déclare.</p>");
  expect(screen.getByText("Proposition")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Vider l'analyse" })).toBeNull();
});
