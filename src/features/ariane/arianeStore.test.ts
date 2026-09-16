import { describe, it, expect, vi, beforeEach } from "vitest";

describe("arianeStore", () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetModules(); vi.restoreAllMocks(); });

  function fakeFile(name: string): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
  }
  const dossier = { affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: null, fin: null }, nb_cotes: 1 }, synthese: "s", parties: [], evenements: [], actes: [], relations: [] };

  it("run : POST puis poll jusqu'à done → dossier rempli", async () => {
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn()
        .mockResolvedValueOnce({ status: "map", progress: { done: 0, total: 1 } })
        .mockResolvedValueOnce({ status: "done", progress: { done: 1, total: 1 }, result: dossier }),
    }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    const s = store.snapshotForTest();
    expect(s.dossier?.affaire.nature).toBe("Vol");
    expect(s.running).toBe(false);
    expect(s.error).toBeUndefined();
  });

  it("run : statut error → message mappé, pas de dossier", async () => {
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn().mockResolvedValue({ status: "error", progress: { done: 0, total: 1 }, error: "ARIANE_UPSTREAM" }),
    }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    const s = store.snapshotForTest();
    expect(s.dossier).toBeUndefined();
    expect(s.error).toMatch(/indisponible/i);
    expect(s.running).toBe(false);
  });

  it("run : les pièces écartées par le MAP sont conservées dans l'état", async () => {
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn().mockResolvedValue({
        status: "done", progress: { done: 2, total: 2 }, result: dossier,
        pieces_ignorees: [{ cote: "D2", raison: "ARIANE_TIMEOUT" }],
      }),
    }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf"), fakeFile("D2.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    expect(store.snapshotForTest().piecesIgnorees).toEqual([{ cote: "D2", raison: "ARIANE_TIMEOUT" }]);
  });

  it("run : les avertissements du BFF sont conservés dans l'état", async () => {
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn().mockResolvedValue({
        status: "done", progress: { done: 1, total: 1 }, result: dossier,
        avertissements: ["Type de piece inconnu : PVInconnu"],
      }),
    }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    expect(store.snapshotForTest().avertissements).toEqual(["Type de piece inconnu : PVInconnu"]);
  });

  it("run : les metadonnees XML d'une piece sont transmises au BFF", async () => {
    const envoyees: unknown[] = [];
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockImplementation((files: unknown[]) => { envoyees.push(...files); return Promise.resolve("j1"); }),
      fetchStatus: vi.fn().mockResolvedValue({ status: "done", progress: { done: 1, total: 1 }, result: dossier }),
    }));
    vi.doMock("../../lib/lrpgn/pdfXml", () => ({ extraireXmlPdf: vi.fn().mockResolvedValue("<Procedure/>") }));
    vi.doMock("../../lib/lrpgn/lrpgn", () => ({
      parseLrpgn: vi.fn().mockReturnValue({
        personnes: [{ nom: "BIDULE", prenom: "Marc", naissanceDate: "21/02/1985", naissanceLieu: "LORIGNE", implication: "VICTIME", nationalite: "" }],
        faits: [], procedure: { numero: "", annee: "", unite: "", typeEnquete: "", dateActe: "" }, enqueteurs: [],
      }),
    }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    expect(envoyees[0]).toMatchObject({
      meta: { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "1985-02-21", role: "victime" }] },
    });
  });

  it("run : les metadonnees de document accompagnent la piece", async () => {
    const envoyees: unknown[] = [];
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "20260210_1105_PVAudition_TEM_DUVAL_PATRICK.pdf" }),
      startAnalyse: vi.fn().mockImplementation((files: unknown[]) => { envoyees.push(...files); return Promise.resolve("j1"); }),
      fetchStatus: vi.fn().mockResolvedValue({ status: "done", progress: { done: 1, total: 1 }, result: dossier }),
    }));
    vi.doMock("../../lib/lrpgn/pdfXml", () => ({ extraireXmlPdf: vi.fn().mockResolvedValue("<Procedure/>") }));
    vi.doMock("../../lib/lrpgn/lrpgn", () => ({
      parseLrpgn: vi.fn().mockReturnValue({
        personnes: [{ nom: "DUVAL", prenom: "Patrick", naissanceDate: "", naissanceLieu: "", implication: "TEMOIN", nationalite: "" }],
        faits: [{ libelle: "VOL", natinf: "10832", debut: "", fin: "", localisation: "", commune: "", codePostal: "" }],
        procedure: { numero: "00059", annee: "2025", unite: "COB X", typeEnquete: "", dateActe: "mardi 10 février 2026" },
        enqueteurs: [{ nom: "Adjudant MALLIETTE", qualite: "OPJ" }],
      }),
    }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("20260210_1105_PVAudition_TEM_DUVAL_PATRICK.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    expect(envoyees[0]).toMatchObject({
      meta: {
        document: {
          type_piece: "Audition",
          date_acte: "mardi 10 février 2026",
          redacteur: "Adjudant MALLIETTE",
          unite: "COB X",
          procedure: "00059/2025",
          nature_fait: "VOL",
          natinf: "10832",
          personne_concernee: "Patrick DUVAL",
        },
      },
    });
  });

  it("run : un PDF sans XML part sans metadonnees, sans erreur", async () => {
    const envoyees: unknown[] = [];
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockImplementation((files: unknown[]) => { envoyees.push(...files); return Promise.resolve("j1"); }),
      fetchStatus: vi.fn().mockResolvedValue({ status: "done", progress: { done: 1, total: 1 }, result: dossier }),
    }));
    vi.doMock("../../lib/lrpgn/pdfXml", () => ({ extraireXmlPdf: vi.fn().mockResolvedValue(null) }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    expect((envoyees[0] as { meta?: unknown }).meta).toBeUndefined();
    expect(store.snapshotForTest().error).toBeUndefined();
  });

  it("run : une extraction XML qui leve n'interrompt pas l'analyse", async () => {
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn().mockResolvedValue({ status: "done", progress: { done: 1, total: 1 }, result: dossier }),
    }));
    vi.doMock("../../lib/lrpgn/pdfXml", () => ({ extraireXmlPdf: vi.fn().mockRejectedValue(new Error("boom")) }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    expect(store.snapshotForTest().dossier).toBeDefined();
    expect(store.snapshotForTest().error).toBeUndefined();
  });

  it("run : une défaillance RAG n'altère ni le dossier ni l'erreur du job", async () => {
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn().mockResolvedValue({
        status: "done", progress: { done: 1, total: 1 }, result: dossier,
        rag: { indexees: 0, total: 2, erreur: "ARIANE_RAG_INDISPONIBLE" },
      }),
    }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    const s = store.snapshotForTest();
    expect(s.dossier?.affaire.nature).toBe("Vol");
    expect(s.error).toBeUndefined();
    expect(s.rag).toEqual({ indexees: 0, total: 2, erreur: "ARIANE_RAG_INDISPONIBLE" });
  });

  it("setView / selectCote mettent à jour l'état", async () => {
    vi.doMock("./arianeApi", () => ({ encodePiece: vi.fn(), startAnalyse: vi.fn(), fetchStatus: vi.fn() }));
    const store = await import("./arianeStore");
    store.setView("reseau");
    store.selectCote("D5");
    const s = store.snapshotForTest();
    expect(s.view).toBe("reseau");
    expect(s.selectedCote).toBe("D5");
  });

  // vi.resetModules() donne un store neuf à chaque test : ask/viderTout/snapshotForTest
  // doivent venir du MÊME import dynamique, sinon ils viseraient deux singletons.
  describe("chat", () => {
    it("ask accumule les deltas dans le dernier message assistant", async () => {
      const store = await import("./arianeStore");
      await store.ask("Qui est mis en cause ?", {
        stream: async (_messages, onDelta) => { onDelta("Jean "); onDelta("DUPONT"); },
      });
      const { messages, streaming } = store.snapshotForTest();
      expect(messages).toEqual([
        { role: "user", content: "Qui est mis en cause ?" },
        { role: "assistant", content: "Jean DUPONT" },
      ]);
      expect(streaming).toBe(false);
    });

    it("ask transmet l'historique sans le message assistant vide", async () => {
      const store = await import("./arianeStore");
      let recus: unknown;
      await store.ask("premiere", { stream: async (_m, onDelta) => onDelta("reponse") });
      await store.ask("seconde", { stream: async (m, _onDelta) => { recus = m; } });
      expect(recus).toEqual([
        { role: "user", content: "premiere" },
        { role: "assistant", content: "reponse" },
        { role: "user", content: "seconde" },
      ]);
    });

    it("ask ignore une question vide", async () => {
      const store = await import("./arianeStore");
      let appelee = false;
      await store.ask("   ", { stream: async () => { appelee = true; } });
      expect(appelee).toBe(false);
      expect(store.snapshotForTest().messages).toEqual([]);
    });

    it("ask conserve le texte deja recu si le flux casse", async () => {
      const store = await import("./arianeStore");
      await store.ask("x", {
        stream: async (_messages, onDelta) => { onDelta("debut"); throw new Error("ARIANE_RAG_CHAT"); },
      });
      const { messages, error, streaming } = store.snapshotForTest();
      expect(messages[1].content).toBe("debut");
      expect(error).toBeTruthy();
      expect(streaming).toBe(false);
    });

    it("ask affiche le message dédié quand le corpus n'est pas configuré", async () => {
      const store = await import("./arianeStore");
      await store.ask("x", { stream: async () => { throw new Error("ARIANE_RAG_INDISPONIBLE"); } });
      expect(store.snapshotForTest().error).toMatch(/corpus non configuré/i);
    });

    it("resetChat vide la conversation", async () => {
      const store = await import("./arianeStore");
      await store.ask("x", { stream: async (_m, onDelta) => onDelta("reponse") });
      store.resetChat();
      const s = store.snapshotForTest();
      expect(s.messages).toEqual([]);
      expect(s.streaming).toBe(false);
    });

    // seedRagForTest est indispensable ici : viderTout ne purge que si rag.total > 0
    // (sinon un clic sur Vider sans RAG configuré déclencherait un 503 inutile), et
    // seul run() renseigne rag en vrai.
    it("viderTout purge le corpus avant de reinitialiser", async () => {
      const store = await import("./arianeStore");
      store.seedRagForTest({ indexees: 2, total: 2, erreur: null });
      const ordre: string[] = [];
      await store.viderTout({ purge: async () => { ordre.push("purge"); return 1; } });
      const s = store.snapshotForTest();
      expect(ordre).toEqual(["purge"]);
      expect(s.dossier).toBeUndefined();
      expect(s.rag).toEqual({ indexees: 0, total: 0, erreur: null });
    });

    it("viderTout ne purge pas quand aucune piece n'est indexee", async () => {
      const store = await import("./arianeStore");
      store.seedRagForTest({ indexees: 0, total: 0, erreur: null });
      let appelee = false;
      await store.viderTout({ purge: async () => { appelee = true; return 0; } });
      expect(appelee).toBe(false);
      expect(store.snapshotForTest().error).toBeUndefined();
    });

    it("viderTout n'efface pas l'ecran si la purge echoue", async () => {
      const store = await import("./arianeStore");
      store.seedRagForTest({ indexees: 2, total: 2, erreur: null });
      await store.ask("x", { stream: async (_m, onDelta) => onDelta("reponse") });
      await store.viderTout({ purge: async () => { throw new Error("ARIANE_RAG_PURGE"); } });
      const { messages, error } = store.snapshotForTest();
      expect(messages.length).toBe(2);
      expect(error).toBeTruthy();
    });
  });
});
