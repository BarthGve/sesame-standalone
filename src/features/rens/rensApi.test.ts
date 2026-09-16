import { describe, it, expect, vi } from "vitest";
import {
  fetchFiches, fetchFicheById, fetchGgd, fetchReferentielListes, fetchCommunes, sendRensPrompt,
} from "./rensApi";

describe("fetchFiches", () => {
  it("construit la query string et renvoie data", async () => {
    let url = "";
    const fake: typeof fetch = async (u) => {
      url = String(u);
      return new Response(JSON.stringify({ data: [{ id: 1, date_redaction: "2026-03-04", titre: "T", unite: "U", code_ggd: "GGD 49", departement: "Maine-et-Loire", commune: "Cholet", mots_cles: ["rodéo"], texte: "x" }], total: 42 }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const out = await fetchFiches({
      date: "2026-03-04", ggd: "GGD 49", mots: ["rodéo", "deal"], limit: 20, offset: 20,
    }, fake);
    expect(url).toContain("/api/rens/fiches?");
    expect(url).toContain("date=2026-03-04");
    expect(url).toContain("ggd=GGD+49");
    expect(url).toMatch(/mot=rodéo|mot=rod%C3%A9o/);
    expect(url).toContain("mot=deal");
    expect(url).toContain("limit=20");
    expect(url).toContain("offset=20");
    expect(out.fiches).toHaveLength(1);
    expect(out.total).toBe(42);
    expect(out.fiches[0].mots_cles).toEqual(["rodéo"]);
  });

  it("erreur HTTP → throw le code", async () => {
    const fake: typeof fetch = async () => new Response(JSON.stringify({ error: "RENS_UPSTREAM" }), { status: 502 });
    await expect(fetchFiches({}, fake)).rejects.toThrow("RENS_UPSTREAM");
  });

  it("erreur HTTP avec enveloppe objet (rens-api) → throw le code, pas [object Object]", async () => {
    const fake: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: "unauthorized", message: "Token invalide" } }), { status: 401 });
    await expect(fetchFiches({}, fake)).rejects.toThrow("unauthorized");
  });
});

describe("fetchFicheById", () => {
  it("interroge /api/rens/fiche?id=", async () => {
    let url = "";
    const fake: typeof fetch = async (u) => {
      url = String(u);
      return new Response(JSON.stringify({
        data: {
          id: 12, date_redaction: "2026-08-07", titre: "T", unite: "COB X",
          code_ggd: "GGD 49", departement: "Maine-et-Loire", commune: "Angers",
          mots_cles: [], texte: "x",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const f = await fetchFicheById(12, fake);
    expect(url).toContain("/api/rens/fiche?id=12");
    expect(f.id).toBe(12);
    expect(f.titre).toBe("T");
  });
});

describe("fetchReferentielListes", () => {
  it("lit GGD et mots-clés depuis le référentiel", async () => {
    const fake: typeof fetch = async (u) => {
      expect(String(u)).toContain("/api/rens/referentiel");
      return new Response(JSON.stringify({
        data: {
          ggd: [{ code: "GGD 49", code_dept: "49", nom_departement: "Maine-et-Loire" }],
          unites: [{ code_ggd: "GGD 49", nom: "COB Angers" }],
          mots_cles: ["rodéo", "deal"],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const r = await fetchReferentielListes(fake);
    expect(r.ggd).toEqual([{ code: "GGD 49", code_dept: "49", nom_departement: "Maine-et-Loire" }]);
    expect(r.mots_cles).toEqual(["rodéo", "deal"]);
    expect(await fetchGgd(fake)).toEqual(r.ggd);
  });
});

describe("fetchCommunes", () => {
  it("passe code_dept, q et limit à l'API d'autocomplete", async () => {
    let url = "";
    const fake: typeof fetch = async (u) => {
      url = String(u);
      return new Response(JSON.stringify({
        data: [{ code_insee: "49331", nom: "Segré-en-Anjou Bleu", code_dept: "49" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const rows = await fetchCommunes({ codeDept: "49", q: "Segré", limit: 20, fetchImpl: fake });
    expect(url).toContain("/api/rens/referentiel/communes?");
    expect(url).toContain("code_dept=49");
    expect(url).toContain("q=Segr");
    expect(url).toContain("limit=20");
    expect(rows[0].nom).toBe("Segré-en-Anjou Bleu");
  });
});

describe("sendRensPrompt", () => {
  it("poste le prompt puis récupère le markdown via le job store", async () => {
    vi.useFakeTimers();
    let posted: { prompt: string } | undefined;
    const fake: typeof fetch = async (u, init) => {
      const url = String(u);
      if (url.includes("/api/rens/synthese")) {
        posted = JSON.parse(init!.body as string);
        return new Response(JSON.stringify({ jobId: "j1" }), { status: 202, headers: { "Content-Type": "application/json" } });
      }
      // /api/job/status?jobId=j1
      return new Response(JSON.stringify({ status: "done", result: { markdown: "## Synthèse" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const p = sendRensPrompt("synthèse du jour", fake);
    await vi.advanceTimersByTimeAsync(3000); // laisse le premier poll partir
    const md = await p;
    vi.useRealTimers();
    expect(md).toBe("## Synthèse");
    expect(posted?.prompt).toBe("synthèse du jour");
  });

  it("erreur au lancement → throw le code", async () => {
    // Le POST échoue (504) : runJobAsync propage le code d'erreur du démarrage.
    const fake: typeof fetch = async () => new Response(JSON.stringify({ error: "IAKA_TIMEOUT" }), { status: 504 });
    await expect(sendRensPrompt("x", fake)).rejects.toThrow("IAKA_TIMEOUT");
  });
});
