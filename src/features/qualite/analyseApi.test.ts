import { describe, it, expect, vi } from "vitest";
import { lancerAnalyse, MAX_SELECTION } from "./analyseApi";

const rapport = { fiches: [], resume: { total: 0, conformes: 0, non_conformes: 0, ecarts: 0, par_gravite: {}, rejets: 0 } };

describe("analyseApi", () => {
  it("poste la sélection puis suit le job jusqu'au rapport", async () => {
    const appels: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      appels.push(String(url));
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ frs_ids: [1, 2] });
        return { ok: true, status: 202, json: async () => ({ jobId: "J1" }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ status: "done", result: rapport }) } as Response;
    });
    const r = await lancerAnalyse([1, 2], { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(appels[0]).toBe("/api/rens/audit/analyse");
    expect(appels[1]).toContain("jobId=J1");
    expect(r.resume.total).toBe(0);
  });

  it("un job en erreur remonte le code, pas un rapport vide", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? ({ ok: true, status: 202, json: async () => ({ jobId: "J1" }) } as Response)
        : ({ ok: true, status: 200, json: async () => ({ status: "error", error: "SORTIE_ILLISIBLE" }) } as Response));
    await expect(lancerAnalyse([1], { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/SORTIE_ILLISIBLE/);
  });

  it("la borne de sélection est celle du serveur", () => {
    expect(MAX_SELECTION).toBe(20);
  });
});
