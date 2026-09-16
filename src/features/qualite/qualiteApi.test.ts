import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchRapport, fetchFicheAudit } from "./qualiteApi";

afterEach(() => vi.unstubAllGlobals());

const rep = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

describe("qualiteApi", () => {
  it("appelle /api/rens/audit/rapport avec jour et ggd", async () => {
    const spy = vi.fn(async (_url: string) => rep({ data: { run: { jour: "2026-08-04" }, synthese: {}, fiches: [] } }));
    vi.stubGlobal("fetch", spy);
    await fetchRapport("2026-08-04", "GGD 49");
    expect(spy.mock.calls[0][0]).toContain("/api/rens/audit/rapport?jour=2026-08-04&ggd=GGD+49");
  });

  it("omet le paramètre jour quand il est nul (dernier run)", async () => {
    const spy = vi.fn(async (_url: string) => rep({ data: { run: {}, synthese: {}, fiches: [] } }));
    vi.stubGlobal("fetch", spy);
    await fetchRapport(null, "");
    expect(spy.mock.calls[0][0]).not.toContain("jour=");
  });

  it("remonte le code d'erreur du BFF plutôt qu'un message générique", async () => {
    vi.stubGlobal("fetch", async () => rep({ error: { code: "no_run", message: "Aucun audit" } }, false, 404));
    await expect(fetchRapport("2026-08-04", "")).rejects.toThrow("no_run");
  });

  it("fetchFicheAudit passe jour et frs_id", async () => {
    const spy = vi.fn(async (_url: string) => rep({ data: { frs_id: 12, ecarts: [] } }));
    vi.stubGlobal("fetch", spy);
    const f = await fetchFicheAudit("2026-08-04", 12);
    expect(spy.mock.calls[0][0]).toContain("frs_id=12");
    expect(f.frs_id).toBe(12);
  });
});
