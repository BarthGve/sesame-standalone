import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendRgpPrompt } from "./rgpApi";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function run<T>(promise: Promise<T>): Promise<T> {
  const guarded = promise.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e })
  );
  await vi.advanceTimersByTimeAsync(3000);
  const r = await guarded;
  if (!r.ok) throw r.e;
  return r.v;
}

describe("sendRgpPrompt", () => {
  it("poste le prompt et renvoie la réponse normalisée", async () => {
    let call = 0;
    const fake: typeof fetch = async (_url, init) => {
      call++;
      if (call === 1) {
        const body = JSON.parse((init!.body as string) ?? "{}");
        expect(body.prompt).toBe("crée un PV");
        return new Response(JSON.stringify({ jobId: "j" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          status: "done",
          result: { text: "raw", parsed: { data: { una: "15127/126/2026" } }, message: "Créée." },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };
    const out = await run(sendRgpPrompt("crée un PV", fake));
    expect(out.parsed).toEqual({ data: { una: "15127/126/2026" } });
    expect(out.message).toBe("Créée.");
  });

  it("erreur → throw avec le code", async () => {
    let call = 0;
    const fake: typeof fetch = async () => {
      call++;
      if (call === 1) return new Response(JSON.stringify({ jobId: "j" }), { status: 200 });
      return new Response(JSON.stringify({ status: "error", error: "IAKA_TIMEOUT" }), { status: 200 });
    };
    await expect(run(sendRgpPrompt("x", fake))).rejects.toThrow("IAKA_TIMEOUT");
  });
});
