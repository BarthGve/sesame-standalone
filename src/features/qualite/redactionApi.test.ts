import { describe, it, expect, vi } from "vitest";
import { analyserTexte, enregistrerFiche, fetchReferentiel, fetchCommunes, type Brouillon } from "./redactionApi";

const brouillon: Brouillon = {
  titre: "Rassemblement", unite: "COB Segré", code_ggd: "GGD 49",
  departement: "Maine-et-Loire", commune: "Segré", texte: "Des faits.", mots_cles: ["rodéo"],
};

describe("redactionApi", () => {
  it("analyserTexte poste le brouillon puis attend le job", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: "j1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "done", result: { fiches: [], resume: {} } }) });
    const r = await analyserTexte(brouillon, { fetchImpl: fetchImpl as unknown as typeof fetch, intervalMs: 0 });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/rens/audit/analyse-texte");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).texte).toBe("Des faits.");
    expect(r).toEqual({ fiches: [], resume: {} });
  });

  it("enregistrerFiche rend l'identifiant créé", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ data: { id: 4213 } }) });
    const id = await enregistrerFiche(brouillon, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/rens/frs");
    expect(id).toBe(4213);
  });

  it("enregistrerFiche remonte le message du serveur, pas un code opaque", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: "bad_request", message: "Champ « commune » obligatoire" } }),
    });
    await expect(enregistrerFiche(brouillon, { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow("Champ « commune » obligatoire");
  });

  it("fetchReferentiel rend GGD, unités et mots-clés", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({
        data: {
          ggd: [{ code: "GGD 49", code_dept: "49", nom_departement: "Maine-et-Loire" }],
          unites: [{ code_ggd: "GGD 49", nom: "COB Segré" }],
          mots_cles: ["rodéo", "stupéfiants"],
        },
      }),
    });
    const r = await fetchReferentiel({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ggd).toHaveLength(1);
    expect(r.unites[0].nom).toBe("COB Segré");
    expect(r.mots_cles).toContain("rodéo");
  });

  it("fetchCommunes interroge le département", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: [{ code_insee: "49007", nom: "Angers", code_dept: "49" }] }),
    });
    const r = await fetchCommunes("49", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl.mock.calls[0][0]).toContain("code_dept=49");
    expect(r[0].nom).toBe("Angers");
  });
});
