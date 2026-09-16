import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./identify", () => ({
  identifyObject: vi.fn(),
}));
vi.mock("./mockIdentify", () => ({
  mockIdentify: vi.fn(),
}));
vi.mock("./perquisitionApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./perquisitionApi")>();
  return {
    ...actual,
    getPerquisition: vi.fn(),
    savePerquisition: vi.fn(),
    addObjets: vi.fn(),
    updateObjet: vi.fn(),
    deleteObjet: vi.fn(),
    uploadPhoto: vi.fn(),
  };
});

import { getPerquisition, savePerquisition, uploadPhoto } from "./perquisitionApi";
import { mockIdentify } from "./mockIdentify";
import {
  addDemo,
  addFiles,
  backToHome,
  beginCreate,
  cancelCreate,
  getSaisiesState,
  openExisting,
  pickUna,
  removeItem,
  resetSaisiesForTests,
  submitSetup,
  validerTout,
} from "./saisiesStore";

describe("saisiesStore", () => {
  beforeEach(() => {
    resetSaisiesForTests();
    vi.clearAllMocks();
  });

  it("pickUna → écran una ; backToHome revient à home", () => {
    pickUna({ una: "1/2/2024" } as never);
    expect(getSaisiesState().screen).toBe("una");
    expect(getSaisiesState().selectedUna).toEqual({ una: "1/2/2024" });
    backToHome();
    expect(getSaisiesState().screen).toBe("home");
    expect(getSaisiesState().creating).toBe(false);
  });

  it("beginCreate / cancelCreate pilotent le flag creating", () => {
    pickUna({ una: "1/2/2024" } as never);
    beginCreate();
    expect(getSaisiesState().creating).toBe(true);
    cancelCreate();
    expect(getSaisiesState().creating).toBe(false);
  });

  it("submitSetup ouvre l'écran perq en mode create", () => {
    pickUna({ una: "15127/1/2024" } as never);
    beginCreate();
    submitSetup({
      una: "15127/1/2024",
      adresse: "1 rue",
      dateDebut: "2024-01-01",
      dateFin: "2024-01-01",
      intervenants: [],
      pieces: [],
    } as never);
    const s = getSaisiesState();
    expect(s.screen).toBe("perq");
    expect(s.perqMode).toBe("create");
    expect(s.creating).toBe(false);
    expect(s.perquisition?.una).toBe("15127/1/2024");
  });

  it("addFiles ajoute des items en staging", () => {
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    const list = { 0: file, length: 1, item: () => file } as unknown as FileList;
    // FileList-like iterable for Array.from
    Object.defineProperty(list, Symbol.iterator, {
      value: function* () { yield file; },
    });
    addFiles(list);
    const items = getSaisiesState().items;
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("staging");
    expect(items[0].file).toBe(file);
    removeItem(items[0].id);
    expect(getSaisiesState().items).toHaveLength(0);
  });

  it("addDemo marque done quand mockIdentify réussit", async () => {
    vi.mocked(mockIdentify).mockResolvedValue({
      categorie: "DIVERS",
      confiance: 0.9,
      champs: [],
    } as never);
    await addDemo();
    const it = getSaisiesState().items[0];
    expect(it.status).toBe("done");
    expect(it.draft?.categorie).toBe("DIVERS");
  });

  it("addDemo marque error quand mockIdentify échoue", async () => {
    vi.mocked(mockIdentify).mockRejectedValue(new Error("boom"));
    await addDemo();
    expect(getSaisiesState().items[0].status).toBe("error");
  });

  it("openExisting charge le détail et bascule en consult", async () => {
    vi.mocked(getPerquisition).mockResolvedValue({
      id: 9,
      objets: [],
    } as never);
    await openExisting(9);
    const s = getSaisiesState();
    expect(s.opened?.id).toBe(9);
    expect(s.perqMode).toBe("consult");
    expect(s.screen).toBe("perq");
    expect(s.saveState.status).toBe("idle");
  });

  it("openExisting pose saveState err si l'API échoue", async () => {
    vi.mocked(getPerquisition).mockRejectedValue(new Error("introuvable"));
    await openExisting(3);
    expect(getSaisiesState().saveState).toEqual({ status: "err", msg: "introuvable" });
  });

  it("validerTout en create enregistre la perquisition", async () => {
    vi.mocked(mockIdentify).mockResolvedValue({
      categorie: "DIVERS",
      confiance: 1,
      champs: [],
    } as never);
    vi.mocked(savePerquisition).mockResolvedValue({ id: 42 });
    vi.mocked(getPerquisition).mockResolvedValue({ id: 42, objets: [] } as never);

    pickUna({ una: "15127/1/2024" } as never);
    beginCreate();
    submitSetup({
      una: "15127/1/2024",
      adresse: "1 rue",
      dateDebut: "2024-01-01",
      dateFin: "2024-01-01",
      intervenants: [],
      pieces: [],
    } as never);
    await addDemo();
    await validerTout();

    expect(savePerquisition).toHaveBeenCalled();
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(getSaisiesState().perqMode).toBe("consult");
    expect(getSaisiesState().saveState.status).toBe("ok");
    expect(getSaisiesState().items).toHaveLength(0);
  });
});
