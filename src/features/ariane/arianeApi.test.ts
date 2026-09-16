import { describe, it, expect, vi } from "vitest";
import { startAnalyse, fetchStatus } from "./arianeApi";

describe("arianeApi", () => {
  it("startAnalyse POST /api/ariane renvoie le jobId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobId: "j1" }) });
    const id = await startAnalyse([{ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }], fetchImpl as unknown as typeof fetch);
    expect(id).toBe("j1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/ariane");
    expect(JSON.parse(init.body).files).toHaveLength(1);
  });

  it("startAnalyse propage le code d'erreur du proxy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "FICHIERS_REQUIS" }) });
    await expect(startAnalyse([], fetchImpl as unknown as typeof fetch)).rejects.toThrow("FICHIERS_REQUIS");
  });

  it("fetchStatus GET renvoie le snapshot du job", async () => {
    const snap = { status: "done", progress: { done: 2, total: 2 }, result: { affaire: {}, parties: [] } };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => snap });
    const out = await fetchStatus("j1", fetchImpl as unknown as typeof fetch);
    expect(out.status).toBe("done");
    expect(fetchImpl.mock.calls[0][0]).toContain("jobId=j1");
  });
});
