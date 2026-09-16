import { describe, it, expect, vi } from "vitest";
import { runJobAsync } from "./runJobAsync";
import { fetchSeq } from "../test/fetchSeq";

describe("runJobAsync", () => {
  it("POST start puis poll jusqu'à done, résout le result", async () => {
    const fetchImpl = fetchSeq([
      { jobId: "j1" },
      { status: "running" },
      { status: "done", result: { texte: "ok" } },
    ]);
    const out = await runJobAsync("/api/synthese", { files: [] }, { intervalMs: 1, fetchImpl } as any);
    expect(out).toEqual({ texte: "ok" });
  });

  it("rejette si le job est en error", async () => {
    const fetchImpl = fetchSeq([{ jobId: "j2" }, { status: "error", error: "SYNTHESE_UPSTREAM" }]);
    await expect(
      runJobAsync("/api/synthese", {}, { intervalMs: 1, fetchImpl } as any),
    ).rejects.toThrow("SYNTHESE_UPSTREAM");
  });

  it("status 404 au poll → rejette JOB_INCONNU immédiatement (pas de timeout)", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return { ok: true, json: async () => ({ jobId: "j3" }) } as any;
      return { ok: false, status: 404, json: async () => ({ error: "JOB_INCONNU" }) } as any;
    });
    await expect(
      runJobAsync("/api/synthese", {}, { intervalMs: 1, timeoutMs: 50, fetchImpl } as any),
    ).rejects.toThrow("JOB_INCONNU");
    expect(calls).toBe(2);
  });

  it("réponse non-JSON / 5xx au start → rejette proprement (pas de SyntaxError)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError("Unexpected token < in JSON"); },
    })) as any;
    await expect(
      runJobAsync("/api/synthese", {}, { intervalMs: 1, fetchImpl } as any),
    ).rejects.toThrow("UPSTREAM");
  });

  it("réponse non-JSON au poll → rejette proprement", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return { ok: true, json: async () => ({ jobId: "j4" }) } as any;
      return {
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError("Unexpected token < in JSON"); },
      } as any;
    });
    await expect(
      runJobAsync("/api/synthese", {}, { intervalMs: 1, fetchImpl } as any),
    ).rejects.toThrow("UPSTREAM");
  });

  it("onStart reçoit le jobId dès le démarrage (pour persistance F5)", async () => {
    const fetchImpl = fetchSeq([{ jobId: "j-persist" }, { status: "done", result: { texte: "ok" } }]);
    const onStart = vi.fn();
    await runJobAsync("/api/synthese", {}, { intervalMs: 1, fetchImpl, onStart } as any);
    expect(onStart).toHaveBeenCalledWith("j-persist");
  });

  it("resumeJobId : reprend le polling sans POST de démarrage", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      // Aucun POST /api/synthese ne doit être émis : uniquement des GET /api/job/status.
      expect(String(url)).toContain("/api/job/status");
      return { ok: true, json: async () => ({ status: "done", result: { texte: "repris" } }) } as any;
    });
    const onStart = vi.fn();
    const out = await runJobAsync("/api/synthese", null, { intervalMs: 1, fetchImpl, resumeJobId: "j-existant", onStart } as any);
    expect(out).toEqual({ texte: "repris" });
    expect(onStart).toHaveBeenCalledWith("j-existant");
    // 1 seul appel (le poll), pas de POST start.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
